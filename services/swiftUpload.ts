import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

import { BASE_URL } from './api';
import type { SwiftReviewState } from './swifts';
import { keptDurationMs, MAX_UPLOAD_BYTES, type SwiftDraft } from './swiftDraft';

/**
 * Publishing a Swift, after the R2 migration.
 *
 * One multipart POST straight to Django — not a signed upload to Cloudinary
 * followed by a separate JSON POST of what it returned. There is only one
 * place left to send the file to, so there is only one request: the video
 * (and every edit parameter) goes to `/api/swifts/` in the same form.
 *
 * Two properties carried over from the old signed-upload flow, because the
 * reasons for them had nothing to do with Cloudinary:
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
 * bar and `abort()` for the cancel button.
 *
 * What is new: this goes through raw XHR rather than the shared `api` axios
 * instance, so it carries its own `Authorization` header rather than axios's
 * interceptor attaching one — a single large transfer with its own retry loop
 * has no need for axios's 401-refresh-and-retry behaviour racing this one.
 */

export type UploadStage = 'idle' | 'uploading' | 'done' | 'error';

export interface UploadProgress {
  stage: UploadStage;
  /** 0–1 across the transfer. */
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
  readonly status?: number;
  /** Whatever the server said, unedited. Kept off `message`, which has to
   *  stay short enough for an alert. */
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

export interface PublishedSwift {
  id: number;
  video_url: string;
  thumbnail_url: string;
  status: string;
  /**
   * Where the Swift is on its way to being public. With AI video moderation
   * switched on this is `reviewing` at the moment the 201 comes back — the row
   * exists, the file is stored, and nobody but the author can watch it yet.
   *
   * That is why the composer navigates to the permalink rather than announcing
   * a successful publish: `/swifts/[id]` is the screen that can show the
   * creator what state their Swift is actually in, and keep showing them until
   * it changes.
   */
  review_state?: SwiftReviewState;
  location_available: boolean;
}

/**
 * Turn a draft into the form Django expects.
 *
 * The coordinates here are a *proposal*. `swifts.views._position_for` runs
 * them through the creator's own location-sharing mode and may snap them to a
 * ~500m grid or drop them entirely — a paused creator's Swift carries no
 * location whatever this sends, which is the point.
 */
export function buildForm(draft: SwiftDraft): FormData {
  const form = new FormData();
  form.append('video', {
    uri: draft.uri as string,
    type: 'video/mp4',
    name: 'swift.mp4',
  } as any);

  form.append('duration_ms', String(keptDurationMs(draft)));
  if (draft.width) form.append('width', String(draft.width));
  if (draft.height) form.append('height', String(draft.height));
  form.append('caption', draft.caption.trim());

  form.append('trim_start_ms', String(Math.round(draft.trimStartMs)));
  if (draft.trimEndMs !== null) {
    form.append('trim_end_ms', String(Math.round(draft.trimEndMs)));
  }
  form.append('original_volume', String(Math.round(draft.originalVolume)));
  form.append('overlay_text', draft.overlayText.trim());
  form.append('overlay_position', draft.overlayPosition);
  form.append('uses_original_audio', String(draft.originalVolume > 0));

  form.append('visibility', draft.visibility);
  form.append('allow_comments', String(draft.allowComments));
  form.append('allow_reposts', String(draft.allowReposts));

  if (draft.shareLocation && draft.latitude !== null && draft.longitude !== null) {
    // `swifts.models.Swift.latitude/longitude` are DecimalField(max_digits=9,
    // decimal_places=6). A raw GPS fix has full double precision — sending it
    // unrounded overflows max_digits and the publish is rejected with "Ensure
    // that there are no more than 9 digits in total." services/location.ts
    // rounds to the same 6 places before a position ever leaves the phone.
    form.append('latitude', draft.latitude.toFixed(6));
    form.append('longitude', draft.longitude.toFixed(6));
    form.append('place_name', draft.placeName);
    form.append('location_shared', 'true');
  }
  return form;
}

/** The first validation message in a DRF error body, whatever shape it took —
 *  `{"detail": "..."}` or `{"field": ["...", ...]}`. */
function serverErrorReason(responseText: string): string {
  try {
    const body = JSON.parse(responseText);
    if (typeof body?.detail === 'string') return body.detail;
    for (const value of Object.values(body ?? {})) {
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
      if (typeof value === 'string') return value;
    }
  } catch {
    // Not JSON — nothing to extract.
  }
  return '';
}

/** What to put in front of the creator. A 401/403 here means the session
 *  expired mid-upload, which is the account's problem to fix by signing in
 *  again, not the video's. */
function uploadFailureMessage(status: number, reason: string): string {
  if (status >= 500 || status === 0) return 'The upload failed. Check your connection.';
  if (status === 401 || status === 403) return 'Please sign in again and try publishing.';
  return reason
    ? `This video was rejected: ${reason}`
    : `This video was rejected (HTTP ${status}).`;
}

interface TransferOptions {
  draft: SwiftDraft;
  token: string | null;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

/** One attempt at posting the Swift. */
function transfer({ draft, token, onProgress, signal }: TransferOptions): Promise<PublishedSwift> {
  return new Promise((resolve, reject) => {
    const form = buildForm(draft);
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
          finish(() => resolve(JSON.parse(xhr.responseText) as PublishedSwift));
        } catch {
          finish(() => reject(new UploadError('The server sent something unreadable.')));
        }
        return;
      }
      // 4xx is a rejected request — a bad field, a file over the ceiling —
      // and retrying sends the same thing again.
      const retryable = xhr.status >= 500 || xhr.status === 0;
      const reason = serverErrorReason(xhr.responseText);
      console.warn(
        `[Swifts] publish rejected — HTTP ${xhr.status}${reason ? `: ${reason}` : ''}`,
      );
      finish(() => reject(new UploadError(
        uploadFailureMessage(xhr.status, reason),
        retryable,
        { status: xhr.status, detail: reason },
      )));
    };

    xhr.onerror = () => finish(() => reject(new UploadError('The upload failed. Check your connection.')));
    xhr.ontimeout = () => finish(() => reject(new UploadError('The upload timed out.')));
    // Generous: 200MB on a slow connection is a long transfer, and a timeout
    // that fires mid-upload wastes everything already sent.
    xhr.timeout = 10 * 60 * 1000;

    xhr.open('POST', `${BASE_URL}/api/swifts/`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
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

export interface PublishOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

/**
 * Publish a draft. Retries transient failures up to `MAX_ATTEMPTS`; a
 * rejection (bad field, oversized file) is not retried — sending the
 * identical request again would waste the user's data to get the same answer.
 */
export async function publishSwift(
  draft: SwiftDraft,
  { onProgress, signal }: PublishOptions = {},
): Promise<PublishedSwift> {
  if (!draft.uri) throw new UploadError('Nothing to publish.', false);

  const file = inspectFile(draft.uri);
  if (file.size > 0 && file.size > MAX_UPLOAD_BYTES) {
    const limitMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    throw new UploadError(`That video is too large (limit ${limitMb}MB).`, false);
  }

  const token = await AsyncStorage.getItem('access_token');

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new UploadCancelled();
    try {
      await wait(RETRY_DELAY_MS[attempt - 1], signal);
      onProgress?.({ stage: 'uploading', ratio: 0, attempt });
      return await transfer({
        draft,
        token,
        signal,
        onProgress: (ratio) => onProgress?.({ stage: 'uploading', ratio, attempt }),
      });
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
