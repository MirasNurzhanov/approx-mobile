import { api } from './api';
import type { SwiftTrack } from './swiftTracks';
import type { CloudinaryVideo } from './swiftUpload';

/**
 * A Swift being made: what the composer holds between steps, and what it
 * finally sends.
 *
 * The shape follows one decision, made in `swifts/media.py` on the backend and
 * worth restating here because it is why this file looks the way it does:
 * **nothing on the phone re-encodes video.** The editor manipulates
 * parameters; the finished file is a Cloudinary delivery transformation built
 * from them. So a draft is a source URI plus a handful of numbers, and
 * publishing is one upload of the untouched recording followed by one JSON
 * POST.
 *
 * What that buys: editing is instant and free, a trim is reversible after
 * publishing, and no video-processing native module has to exist. What it
 * costs: the composer's preview is an approximation — the local player applies
 * the trim and the volumes, but the text overlay is drawn as a React view over
 * the video rather than being in it. The preview step says so.
 */

export type SwiftSource = 'camera' | 'library';

export interface SwiftDraft {
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
  /** Frame used as the poster, in ms from the start of the *source*. */
  coverMs: number | null;
  /** 0–100. Zero is the mute; there is no separate boolean, so the two
   *  cannot disagree. */
  originalVolume: number;
  musicVolume: number;
  overlayText: string;
  overlayPosition: 'top' | 'middle' | 'bottom';

  // ── Music ──────────────────────────────────────────────────────────────────
  track: SwiftTrack | null;
  /** Where in the song the Swift starts. */
  trackOffsetMs: number;

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
  uri: null,
  source: null,
  durationMs: 0,
  width: 0,
  height: 0,

  trimStartMs: 0,
  trimEndMs: null,
  coverMs: null,
  originalVolume: 100,
  musicVolume: 70,
  overlayText: '',
  overlayPosition: 'middle',

  track: null,
  trackOffsetMs: 0,

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

// ── Limits, mirrored from swifts/media.py ────────────────────────────────────
// The server enforces these too. These exist so the creator finds out before
// spending a transfer, not because the client is trusted.
export const MIN_SWIFT_MS = 1_000;
export const MAX_SWIFT_MS = 60_000;
export const MAX_CAPTION = 300;
export const MAX_OVERLAY = 80;

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

// ── Publishing ───────────────────────────────────────────────────────────────
export interface PublishedSwift {
  id: number;
  video_url: string;
  thumbnail_url: string;
  status: string;
  location_available: boolean;
}

/**
 * Turn an uploaded asset plus a draft into a Swift.
 *
 * The coordinates here are a *proposal*. `swifts.views._position_for` runs
 * them through the creator's own location-sharing mode and may snap them to a
 * ~500m grid or drop them entirely — a paused creator's Swift carries no
 * location whatever this sends, which is the point.
 */
export async function publishSwift(
  draft: SwiftDraft,
  asset: CloudinaryVideo,
): Promise<PublishedSwift> {
  const usesOriginal = draft.originalVolume > 0;
  const body: Record<string, unknown> = {
    video_url: asset.secure_url,
    media_id: asset.public_id,
    duration_ms: keptDurationMs(draft),
    width: asset.width ?? draft.width,
    height: asset.height ?? draft.height,
    status: 'ready',

    caption: draft.caption.trim(),

    trim_start_ms: Math.round(draft.trimStartMs),
    trim_end_ms: draft.trimEndMs === null ? null : Math.round(draft.trimEndMs),
    cover_ms: draft.coverMs === null ? null : Math.round(draft.coverMs),
    original_volume: Math.round(draft.originalVolume),
    music_volume: Math.round(draft.musicVolume),
    overlay_text: draft.overlayText.trim(),
    overlay_position: draft.overlayPosition,

    uses_original_audio: usesOriginal,
    visibility: draft.visibility,
    allow_comments: draft.allowComments,
    allow_reposts: draft.allowReposts,
  };

  if (draft.track) {
    body.track = draft.track.id;
    // The flat fields are the attribution snapshot: they are what a viewer
    // reads, and they survive the track being withdrawn from the catalogue.
    body.audio_title = draft.track.title;
    body.audio_artist = draft.track.artist;
    body.audio_artwork_url = draft.track.artwork_url;
  }

  if (draft.shareLocation && draft.latitude !== null && draft.longitude !== null) {
    body.latitude = draft.latitude;
    body.longitude = draft.longitude;
    body.place_name = draft.placeName;
    body.location_shared = true;
  }

  const { data } = await api.post<PublishedSwift>('/api/swifts/', body);
  return data;
}
