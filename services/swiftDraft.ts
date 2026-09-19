/**
 * A Swift being made: what the composer holds between steps.
 *
 * The shape follows one decision, made in `swifts/media.py` on the backend and
 * worth restating here because it is why this file looks the way it does:
 * **nothing on the phone re-encodes video, and nothing on the server does
 * either.** R2 is a plain object store — it cannot decode, mix or re-encode
 * video the way Cloudinary's delivery transformations used to, so a draft's
 * parameters are applied at *playback* time instead of baked into a rendered
 * file:
 *
 *   * trim, speed, rotation and the colour effect are applied by the player,
 *     the same way the editor already previewed them — see
 *     `components/swifts/SwiftCard`;
 *   * the text overlay and the stickers are drawn as layers over the video by
 *     the client, both while editing and while watching — never burned into
 *     pixels;
 *   * a music bed is a **second audio stream played alongside the video**,
 *     not a mix — which is the one thing here that a viewer could tell apart
 *     from a real encode: a Swift saved out as a file carries only its own
 *     recorded sound, because that is what the file is.
 *
 * What that buys: editing is instant and free, every choice is reversible
 * after publishing, and no video-processing native module has to exist.
 *
 * ## Speed is the one parameter that changes what "duration" means
 *
 * Every other setting leaves the clip's length alone. Speed does not, and the
 * sixty-second ceiling is on what a viewer *watches* — so a 90-second
 * recording at 2× is a legal 45-second Swift and a 20-second one at 0.5× is an
 * illegal 40-second one. `keptDurationMs` returns the played length for
 * exactly that reason, and `recordableMs` is the inverse the camera needs in
 * order to stop itself at the right moment. Both mirror `swifts/capture.py`.
 */

export type SwiftSource = 'camera' | 'library';

/** A quarter turn, clockwise, applied at playback. */
export type SwiftRotation = 0 | 90 | 180 | 270;

/**
 * One emoji placed over the video.
 *
 * `x`/`y` are fractions of the frame (0–1, the sticker's centre) rather than
 * pixels, so an arrangement made on a small phone lands in the same place on a
 * large one — and on every other screen the Swift is ever played on.
 */
export interface SwiftSticker {
  /** A stable key for React and for the drag gesture; never sent to the server. */
  id: string;
  emoji: string;
  x: number;
  y: number;
  scale: number;
  /** Degrees. */
  rotation: number;
}

/** The music bed, as the picker resolved it. */
export interface SwiftTrackChoice {
  id: number;
  title: string;
  artist: string;
  artworkUrl: string;
  /** Where the audio actually is. Without it there is nothing to play. */
  audioUrl: string;
  durationMs: number;
}

export interface SwiftDraft {
  /** Assigned once when a take is captured/imported; retained through retries. */
  idempotencyKey: string | null;
  /** Local file:// (camera) or content:// (library) URI of the recording. */
  uri: string | null;
  source: SwiftSource | null;
  /**
   * The **source** length as reported by the camera or the picker, in
   * milliseconds — before speed. `keptDurationMs` is what a viewer watches.
   */
  durationMs: number;
  width: number;
  height: number;

  // ── Capture ────────────────────────────────────────────────────────────────
  /** Playback speed as a percentage: 50 is half speed, 200 is double. */
  speedPercent: number;
  rotationDeg: SwiftRotation;
  /** A key from `constants/swiftEffects`; '' is untouched. */
  effect: string;
  /** 0–100. How strongly `effect` is applied. */
  effectIntensity: number;
  /**
   * Whether the camera records audio at all.
   *
   * Distinct from `originalVolume`, and the difference is the point: muting is
   * a playback parameter a viewer's client applies, so the sound is still *in
   * the file*. Turning the mic off means it was never captured. Somebody
   * filming in a room where they do not want to record what is being said
   * needs the second one, and only the second one is honest about it.
   */
  micEnabled: boolean;
  /** Seconds to count down before recording starts. 0 is no countdown. */
  countdownS: number;
  /**
   * The self-imposed ceiling on this take, in played milliseconds, or null for
   * the full sixty. Never above `MAX_SWIFT_MS` — see `recordLimitMs`.
   */
  limitMs: number | null;

  // ── The edit ───────────────────────────────────────────────────────────────
  trimStartMs: number;
  /** Null means "to the end of the source". */
  trimEndMs: number | null;
  /** 0–100. Zero is the mute. Applied as the player's volume, not baked in. */
  originalVolume: number;
  overlayText: string;
  overlayPosition: 'top' | 'middle' | 'bottom';
  stickers: SwiftSticker[];

  /** The attached bed, or null. */
  track: SwiftTrackChoice | null;
  /** 0–100. How loud the bed plays against the recording's own sound. */
  musicVolume: number;
  /** Where in the track the bed starts, in ms from its beginning. */
  musicStartMs: number;

  // ── Details ────────────────────────────────────────────────────────────────
  caption: string;
  visibility: 'public' | 'friends' | 'private';
  allowComments: boolean;
  allowReposts: boolean;
  /** Tags added outside the caption. The caption's own are parsed server-side. */
  hashtags: string[];
  /** Usernames named outside the caption, same arrangement. */
  mentions: string[];
  /**
   * Friends to send this to privately once it publishes.
   *
   * Held on the draft rather than sent with the publish because the share is a
   * separate request against a Swift that has to exist first — see
   * `services/swiftShare`.
   */
  sendTo: number[];

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

  speedPercent: 100,
  rotationDeg: 0,
  effect: '',
  effectIntensity: 100,
  micEnabled: true,
  countdownS: 0,
  limitMs: null,

  trimStartMs: 0,
  trimEndMs: null,
  originalVolume: 100,
  overlayText: '',
  overlayPosition: 'middle',
  stickers: [],

  track: null,
  musicVolume: 70,
  musicStartMs: 0,

  caption: '',
  visibility: 'public',
  allowComments: true,
  allowReposts: true,
  hashtags: [],
  mentions: [],
  sendTo: [],

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

/** A sticker id. Same generator, same reasoning — local only. */
export function createStickerId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ── Limits, mirrored from swifts/media.py and swifts/capture.py ──────────────
// The server enforces these too. These exist so the creator finds out before
// spending a transfer, not because the client is trusted.
export const MIN_SWIFT_MS = 1_000;
export const MAX_SWIFT_MS = 60_000;
export const MAX_CAPTION = 300;
export const MAX_OVERLAY = 80;
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const MAX_STICKERS = 30;
export const MAX_HASHTAGS = 15;
export const MAX_MENTIONS = 10;
export const MIN_SPEED_PERCENT = 30;
export const MAX_SPEED_PERCENT = 300;

/** The speeds the picker offers, slowest first. */
export const SPEED_CHOICES = [30, 50, 100, 200, 300] as const;

/** The self-imposed ceilings the timer offers, in played milliseconds. */
export const DURATION_CHOICES = [15_000, 30_000, 60_000] as const;

/** The countdowns the timer offers, in seconds. 0 is off. */
export const COUNTDOWN_CHOICES = [0, 3, 10] as const;

/**
 * How long a recording *plays* for, given how long it was recorded.
 *
 * The direction the sixty-second ceiling cares about. Mirrors
 * `swifts.capture.played_ms`.
 */
export function playedMs(recordedMs: number, speedPercent: number): number {
  return Math.round((recordedMs * 100) / clampSpeed(speedPercent));
}

/**
 * The inverse: how much source is needed to fill a given screen time.
 *
 * What the camera needs in order to stop itself at the right moment — at 50%
 * the recorder may only run for thirty seconds, because those thirty seconds
 * become a sixty-second Swift.
 */
export function recordedMs(played: number, speedPercent: number): number {
  return Math.round((played * clampSpeed(speedPercent)) / 100);
}

function clampSpeed(speedPercent: number): number {
  if (!Number.isFinite(speedPercent)) return 100;
  return Math.min(MAX_SPEED_PERCENT, Math.max(MIN_SPEED_PERCENT, speedPercent));
}

/**
 * How long the camera may roll for this take, in **source** milliseconds.
 *
 * Two ceilings fold together here: the creator's own choice from the timer,
 * and the sixty-second maximum nobody can raise. Both are expressed as played
 * time, so both convert the same way, and the smaller wins.
 */
export function recordLimitMs(draft: SwiftDraft): number {
  const played = Math.min(draft.limitMs ?? MAX_SWIFT_MS, MAX_SWIFT_MS);
  return recordedMs(played, draft.speedPercent);
}

/** The kept length of a draft as a viewer experiences it, honouring the trim. */
export function keptDurationMs(draft: SwiftDraft): number {
  const end = draft.trimEndMs ?? draft.durationMs;
  return playedMs(Math.max(0, end - draft.trimStartMs), draft.speedPercent);
}

/** The kept length in *source* milliseconds, which is what the player seeks in. */
export function keptSourceMs(draft: SwiftDraft): number {
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
  if (draft.stickers.length > MAX_STICKERS) {
    problems.push({
      field: 'stickers',
      message: `You can add up to ${MAX_STICKERS} stickers.`,
    });
  }
  if (draft.hashtags.length > MAX_HASHTAGS) {
    problems.push({
      field: 'hashtags',
      message: `You can add up to ${MAX_HASHTAGS} hashtags.`,
    });
  }
  if (draft.mentions.length > MAX_MENTIONS) {
    problems.push({
      field: 'mentions',
      message: `You can mention up to ${MAX_MENTIONS} people.`,
    });
  }
  if (draft.shareLocation && (draft.latitude === null || draft.longitude === null)) {
    problems.push({
      field: 'location',
      message: 'We could not get a location to attach.',
    });
  }
  return problems;
}

// ── Tags, as the composer and the caption both write them ────────────────────
// Mirrors `swifts/tagging.py`, which is the authority: the server parses the
// caption again on publish, so these two must agree about what a tag *is* or
// the creator sees one set of tags in the composer and a different set on the
// published Swift.

/** A hashtag in running text. Unicode-aware, never digits alone. */
const HASHTAG_RE = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)/gu;

/** A mention in running text. ASCII, matching what a username may contain. */
const MENTION_RE = /(?<![\p{L}\p{N}_])@([A-Za-z0-9_.]{1,150})/gu;

/** A tag reduced to its identity, or '' if it is not one. */
export function normaliseTag(raw: string): string {
  const tag = (raw ?? '').trim().replace(/^#+/, '').trim().toLowerCase().slice(0, 64);
  if (!tag) return '';
  // Re-check the shape: a value typed straight into the tag field never went
  // through the pattern on its own, and '2024' is not a tag however it arrived.
  return new RegExp(`^${HASHTAG_RE.source}$`, 'u').test(`#${tag}`) ? tag : '';
}

/** Every distinct tag in a caption, in the order they appear. */
export function parseHashtags(text: string): string[] {
  const out: string[] = [];
  for (const match of (text ?? '').matchAll(HASHTAG_RE)) {
    const tag = normaliseTag(match[1]);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Every distinct handle in a caption, lowercased, in order. */
export function parseMentions(text: string): string[] {
  const out: string[] = [];
  for (const match of (text ?? '').matchAll(MENTION_RE)) {
    const handle = match[1].replace(/\.+$/, '').toLowerCase();
    if (handle && !out.includes(handle)) out.push(handle);
  }
  return out;
}

/**
 * Every tag this Swift will publish with: the caption's, then the field's.
 *
 * The composer shows this rather than just `draft.hashtags`, because a creator
 * who typed `#astana` into the caption has tagged their Swift and the UI would
 * be lying if the chip row did not say so.
 */
export function effectiveHashtags(draft: SwiftDraft): string[] {
  const out = parseHashtags(draft.caption);
  for (const tag of draft.hashtags) {
    const clean = normaliseTag(tag);
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out.slice(0, MAX_HASHTAGS);
}

/** The same, for mentions. */
export function effectiveMentions(draft: SwiftDraft): string[] {
  const out = parseMentions(draft.caption);
  for (const handle of draft.mentions) {
    const clean = handle.trim().replace(/^@+/, '').toLowerCase();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out.slice(0, MAX_MENTIONS);
}
