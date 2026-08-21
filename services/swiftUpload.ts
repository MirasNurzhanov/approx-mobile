import { File } from 'expo-file-system';

import { api } from './api';

/**
 * Getting a recorded video from the phone to Cloudinary, and back as a Swift.
 *
 * Three properties this module exists to hold, all of which are easy to lose:
 *
 * **The video never enters JS memory.** The file is handed to `FormData` as a
 * `{ uri }` descriptor, and the native networking layer streams it off disk.
 * Reading it with `FileSystem.readAsStringAsync` — the obvious way to "get the
 * file" — would materialise a base64 string roughly 1.37× the file size in the
 * JS heap, which for a 60-second 1080p clip is well over 100MB and an
 * out-of-memory crash on a mid-range Android.
 *
 * **Progress and cancellation are real.** `fetch` in React Native reports
 * neither, so this uses `XMLHttpRequest` directly: `upload.onprogress` for the
 * bar and `abort()` for the cancel button. Axios would work too — it wraps XHR
 * on this platform — but the raw object is one fewer layer between the byte
 * count and the screen.
 *
 * **Retries reuse the signature.** A signature is valid for an hour, so a
 * failed attempt on a flaky connection retries against the same one rather
 * than round-tripping to Django again. Only a genuinely expired signature
 * costs a new request.
 */

// ── The contract with the backend ────────────────────────────────────────────
export interface UploadSignature {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  signature: string;
  public_id: string;
  /** Exactly the parameters the server put through SHA-1, verbatim.
   *
   *  The form used to hardcode that list, which meant the two ends could
   *  disagree without either one being obviously wrong — and a form that does
   *  not match the signed set is a 401 from Cloudinary with no explanation of
   *  which parameter it was. Echoing the server's own dict makes the set
   *  changeable in one place. */
  params?: Record<string, string>;
  /** @deprecated Pre-`params` shape, still read so an installed build keeps
   *  working against either backend. */
  folder?: string;
  /** @deprecated See `folder`. */
  image_metadata?: string;
  upload_url: string;
  max_bytes: number;
  max_duration_ms: number;
}

/** The form fields that have to match what was signed, whichever shape the
 *  server answered in. */
function signedParams(signature: UploadSignature): Record<string, string> {
  if (signature.params) return signature.params;
  const legacy: Record<string, string> = {
    timestamp: String(signature.timestamp),
    public_id: signature.public_id,
  };
  if (signature.folder) legacy.folder = signature.folder;
  if (signature.image_metadata) legacy.image_metadata = signature.image_metadata;
  return legacy;
}

/** Cloudinary answers a rejection with `{"error":{"message":"..."}}` — the
 *  only place the actual reason exists. Discarding it, which this module used
 *  to do, turns every 4xx into the same dead end on screen. */
function cloudinaryReason(responseText: string): string {
  try {
    const message = JSON.parse(responseText)?.error?.message;
    return typeof message === 'string' ? message.trim() : '';
  } catch {
    return '';
  }
}

export interface CloudinaryVideo {
  public_id: string;
  secure_url: string;
  duration?: number;
  width?: number;
  height?: number;
  bytes?: number;
}

export type UploadStage = 'idle' | 'signing' | 'uploading' | 'saving' | 'done' | 'error';

export interface UploadProgress {
  stage: UploadStage;
  /** 0–1 across the transfer only; the signing and saving steps are quick. */
  ratio: number;
  attempt: number;
}

/** Thrown when the user cancelled. Callers treat it as "nothing happened". */
export class UploadCancelled extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'UploadCancelled';
  }
}

export class UploadError extends Error {
  readonly retryable: boolean;
  /** HTTP status, when the failure came back as one. */
  readonly status?: number;
  /** Whatever the upload service said, unedited. Kept off `message`, which has
   *  to stay short enough for an alert. */
  readonly detail?: string;
  constructor(
    message: string,
    retryable = true,
    extra?: { status?: number; detail?: string },
  ) {
    super(message);
    this.name = 'UploadError';
    this.retryable = retryable;
    this.status = extra?.status;
    this.detail = extra?.detail;
  }
}

// ── Preflight ────────────────────────────────────────────────────────────────
/**
 * What we can learn about the file before spending a byte of the user's data.
 *
 * Worth doing: a rejected upload after a two-minute transfer on mobile data is
 * the single most annoying failure this flow can produce, and the size is
 * knowable for free.
 */
export function inspectFile(uri: string): { exists: boolean; size: number } {
  try {
    // SDK 57's `File` is the current API and it is synchronous; the
    // `getInfoAsync` most examples still show is the legacy path and now warns.
    const file = new File(uri);
    return { exists: file.exists, size: file.size ?? 0 };
  } catch {
    // A URI the file system cannot stat is not necessarily broken — a
    // content:// URI from the Android picker often is not statable and uploads
    // perfectly well. Let the upload be the judge rather than refusing here.
    return { exists: true, size: 0 };
  }
}

/**
 * Delete a recording we are finished with.
 *
 * The camera writes into the app's cache directory and nothing there is ever
 * reclaimed on our behalf; a creator who records ten takes has ten full-size
 * videos sitting on their device. Best-effort by design — failing to tidy up
 * must never fail a publish that has already succeeded.
 */
export function discardTempFile(uri?: string | null): void {
  // Only our own recordings. A content:// URI points at the user's library and
  // deleting one would destroy a video they chose from their own gallery.
  if (!uri || !uri.startsWith('file://')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing to do about it and nothing worth telling the user.
  }
}

// ── Signing ──────────────────────────────────────────────────────────────────
export async function getUploadSignature(): Promise<UploadSignature> {
  try {
    const { data } = await api.get<UploadSignature>('/api/swifts/upload-signature/');
    return data;
  } catch (e: any) {
    if (e?.response?.data?.code === 'not_configured') {
      throw new UploadError('Video uploads are unavailable right now.', false);
    }
    throw new UploadError('Could not start the upload.');
  }
}

// ── The transfer ─────────────────────────────────────────────────────────────
interface TransferOptions {
  uri: string;
  signature: UploadSignature;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

/**
 * One attempt at pushing the file to Cloudinary.
 *
 * Deliberately not `fetch`. Every parameter here is one the signature covers,
 * so Cloudinary rejects the upload outright if any of them is altered in
 * flight — which is exactly why the set is taken from the server's response
 * rather than written out again here.
 */
function transfer({ uri, signature, onProgress, signal }: TransferOptions): Promise<CloudinaryVideo> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    // The descriptor, not the bytes. See the module note.
    form.append('file', {
      uri,
      type: 'video/mp4',
      name: 'swift.mp4',
    } as any);
    for (const [key, value] of Object.entries(signedParams(signature))) {
      form.append(key, value);
    }
    // Neither of these is part of the signed payload — Cloudinary excludes
    // `api_key`, `signature`, `file` and `resource_type` when it recomputes.
    form.append('api_key', signature.api_key);
    form.append('signature', signature.signature);

    const xhr = new XMLHttpRequest();
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    function onAbort() {
      try {
        xhr.abort();
      } catch {
        // Already finished; the reject below is what matters.
      }
      finish(() => reject(new UploadCancelled()));
    }

    if (signal?.aborted) {
      reject(new UploadCancelled());
      return;
    }
    signal?.addEventListener('abort', onAbort);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          finish(() => resolve(JSON.parse(xhr.responseText) as CloudinaryVideo));
        } catch {
          finish(() => reject(new UploadError('The upload service sent something unreadable.')));
        }
        return;
      }
      // 4xx from Cloudinary is a rejected request — a bad signature, a file
      // over the account limit — and retrying sends the same thing again.
      const retryable = xhr.status >= 500 || xhr.status === 0;
      const reason = cloudinaryReason(xhr.responseText);
      // Logged as well as shown. "This video was rejected" on its own is
      // unactionable: the difference between an invalid signature, a file over
      // the account's ceiling and an unsupported codec is the whole of what a
      // creator or whoever they report it to needs, and it only exists here.
      console.warn(
        `[Swifts] upload rejected — HTTP ${xhr.status}${reason ? `: ${reason}` : ''}`,
      );
      finish(() => reject(new UploadError(
        retryable
          ? 'The upload failed. Check your connection.'
          : reason
            ? `This video was rejected: ${reason}`
            : `This video was rejected (HTTP ${xhr.status}).`,
        retryable,
        { status: xhr.status, detail: reason },
      )));
    };

    xhr.onerror = () => finish(() => reject(new UploadError('The upload failed. Check your connection.')));
    xhr.ontimeout = () => finish(() => reject(new UploadError('The upload timed out.')));
    // Generous: 200MB on a slow connection is a long transfer, and a timeout
    // that fires mid-upload wastes everything already sent.
    xhr.timeout = 10 * 60 * 1000;

    xhr.open('POST', signature.upload_url);
    xhr.send(form);
  });
}

/** Backoff between attempts. Short enough not to feel stuck, long enough that
 *  a connection changing hands (wifi → cellular) has time to settle. */
const RETRY_DELAY_MS = [0, 1500, 4000];
export const MAX_ATTEMPTS = RETRY_DELAY_MS.length;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new UploadCancelled());
    }
    signal?.addEventListener('abort', onAbort);
  });
}

export interface UploadOptions {
  uri: string;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  /** Reuse a signature from an earlier attempt rather than asking again. */
  signature?: UploadSignature;
}

/**
 * Upload a local video and return what Cloudinary stored.
 *
 * Retries transient failures up to `MAX_ATTEMPTS` against the same signature.
 * A rejection (bad signature, oversized file) is not retried — sending the
 * identical request again would waste the user's data to get the same answer.
 */
export async function uploadSwiftVideo({
  uri,
  onProgress,
  signal,
  signature: existing,
}: UploadOptions): Promise<{ asset: CloudinaryVideo; signature: UploadSignature }> {
  onProgress?.({ stage: 'signing', ratio: 0, attempt: 1 });
  const signature = existing ?? (await getUploadSignature());

  const file = inspectFile(uri);
  if (file.size > 0 && file.size > signature.max_bytes) {
    const limitMb = Math.round(signature.max_bytes / (1024 * 1024));
    throw new UploadError(`That video is too large (limit ${limitMb}MB).`, false);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new UploadCancelled();
    try {
      await wait(RETRY_DELAY_MS[attempt - 1], signal);
      onProgress?.({ stage: 'uploading', ratio: 0, attempt });
      const asset = await transfer({
        uri,
        signature,
        signal,
        onProgress: (ratio) => onProgress?.({ stage: 'uploading', ratio, attempt }),
      });
      return { asset, signature };
    } catch (e) {
      if (e instanceof UploadCancelled) throw e;
      if (e instanceof UploadError && !e.retryable) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new UploadError('The upload failed after several attempts.');
}
