/**
 * A Swift being made: what the composer holds between steps.
 *
 * The shape follows one decision, made in `swifts/media.py` on the backend and
 * worth restating here because it is why this file looks the way it does:
 * **nothing on the phone re-encodes video, and nothing on the server does
 * either any more.** R2 is a plain object store — it cannot decode, mix or
 * re-encode video the way Cloudinary's delivery transformations used to, so a
 * draft's parameters are applied at *playback* time instead of baked into a
 * rendered file:
 *
 *   * trim and the original-audio volume are applied by the player, the same
 *     way the editor already previewed them — see `components/swifts/SwiftCard`;
 *   * the text overlay is drawn as a layer over the video by the client,
 *     both while editing and while watching — never burned into pixels;
 *   * a music bed can no longer be mixed in at all — see `services/swiftUpload`
 *     — so this draft carries no track.
 *
 * What that buys: editing is instant and free, a trim is reversible after
 * publishing, and no video-processing native module has to exist. What it
 * drops, for now: a poster frame. Extracting one from a timestamp was also
 * Cloudinary's job, and there is no client-side capture wired up to replace
 * it yet — a Swift publishes with no thumbnail until there is.
 */

export type SwiftSource = 'camera' | 'library';

export interface SwiftDraft {
  /** Assigned once when a take is captured/imported; retained through retries. */
  idempotencyKey: string | null;
  /** Local file:// (camera) or content:// (library) URI of the recording. */
  uri: string | null;
  source: SwiftSource | null;
  /** As reported by the camera or the picker, in milliseconds. */
  durationMs: number;
  width: number;
  height: number;

  // ── The edit ───────────────────────────────────────────────────────────────
  trimStartMs: number;
  /** Null means "to the end of the source". */
  trimEndMs: number | null;
  /** 0–100. Zero is the mute. Applied as the player's volume, not baked in. */
  originalVolume: number;
  overlayText: string;
  overlayPosition: 'top' | 'middle' | 'bottom';

  // ── Details ────────────────────────────────────────────────────────────────
  caption: string;
  visibility: 'public' | 'friends' | 'private';
  allowComments: boolean;
  allowReposts: boolean;

  /** A location is attached only when the creator says so, per Swift. */
  shareLocation: boolean;
  latitude: number | null;
  longitude: number | null;
  placeName: string;
}

export const EMPTY_DRAFT: SwiftDraft = {
  idempotencyKey: null,
  uri: null,
  source: null,
  durationMs: 0,
  width: 0,
  height: 0,

  trimStartMs: 0,
  trimEndMs: null,
  originalVolume: 100,
  overlayText: '',
  overlayPosition: 'middle',

  caption: '',
  visibility: 'public',
  allowComments: true,
  allowReposts: true,

  // Off by default, and deliberately so — see `swifts/visibility.py` on the
  // backend. A Swift is permanent where the live map is session-scoped, so
  // attaching a place has to be a decision rather than the default.
  shareLocation: false,
  latitude: null,
  longitude: null,
  placeName: '',
};

/** An opaque take label, following the device-id convention; never a credential. */
export function createTakeKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 3) | 8).toString(16);
  });
}

// ── Limits, mirrored from swifts/media.py ────────────────────────────────────
// The server enforces these too. These exist so the creator finds out before
// spending a transfer, not because the client is trusted.
export const MIN_SWIFT_MS = 1_000;
export const MAX_SWIFT_MS = 60_000;
export const MAX_CAPTION = 300;
export const MAX_OVERLAY = 80;
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** The kept length of a draft, honouring the trim. */
export function keptDurationMs(draft: SwiftDraft): number {
  const end = draft.trimEndMs ?? draft.durationMs;
  return Math.max(0, end - draft.trimStartMs);
}

export interface DraftProblem {
  field: string;
  message: string;
}

/**
 * What still stands between this draft and a publishable Swift.
 *
 * Returns every problem rather than the first, so the composer can disable a
 * step and say why instead of failing one reason at a time.
 */
export function validateDraft(draft: SwiftDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!draft.uri) {
    problems.push({ field: 'uri', message: 'Record or choose a video first.' });
    return problems;
  }
  const kept = keptDurationMs(draft);
  if (kept < MIN_SWIFT_MS) {
    problems.push({ field: 'trim', message: 'A Swift has to be at least 1 second.' });
  }
  if (kept > MAX_SWIFT_MS) {
    problems.push({ field: 'trim', message: 'A Swift can be at most 60 seconds.' });
  }
  if (draft.caption.length > MAX_CAPTION) {
    problems.push({ field: 'caption', message: `Captions are capped at ${MAX_CAPTION}.` });
  }
  if (draft.overlayText.length > MAX_OVERLAY) {
    problems.push({ field: 'overlayText', message: `Text is capped at ${MAX_OVERLAY}.` });
  }
  if (draft.shareLocation && (draft.latitude === null || draft.longitude === null)) {
    problems.push({
      field: 'location',
      message: 'We could not get a location to attach.',
    });
  }
  return problems;
}
