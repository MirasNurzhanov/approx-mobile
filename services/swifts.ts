import { api } from './api';

/**
 * Swifts — short-form vertical video.
 *
 * ## The location rule, on the client side
 *
 * The server never puts a coordinate in a feed or detail payload (see
 * `swifts/serializers.py`). This module is the client half of the same
 * guarantee, and it holds it with the type system rather than with discipline:
 *
 * **`Swift` has no latitude, longitude or place fields, and must never grow
 * one.** The only shape carrying a coordinate is `SwiftLocation`, returned by
 * `revealSwiftLocation` and by nothing else. So a component cannot read a
 * position off a feed item, because there is no property to read — a mistake
 * is a compile error rather than a leak.
 *
 * The second half is just as important and is about *timing*: a revealed
 * location is returned to the caller and **is not written back into the feed
 * list**. If it were, scrolling away and back would leave the coordinate in
 * memory attached to a card that is no longer showing it, prefetch would carry
 * it, and "don't preload coordinates" would quietly stop being true. The sheet
 * that asked for it owns it, and it goes when the sheet does.
 */

export interface SwiftAuthor {
  id: number;
  username: string;
  profile_picture?: string | null;
}

export interface SwiftTrackCredit {
  id: number | null;
  title: string;
  artist: string;
  artwork_url: string;
  /**
   * Where the audio is. Empty when the catalogue row is gone — a track pulled
   * for a lapsed licence stops playing but keeps its credit, which is the
   * whole reason the attribution is stored flat beside the relation. See
   * `SwiftVideo.track` on the backend.
   *
   * Optional for the same reason the capture fields below are: a server older
   * than this build sends a credit without it, and the right outcome there is
   * a Swift that plays its own sound rather than one that crashes the card.
   */
  audio_url?: string;
  duration_ms?: number;
}

/** One emoji placed over the video, positioned in fractions of the frame. */
export interface SwiftStickerPlacement {
  emoji: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/** A tag on a Swift. `display` is for showing, `name` for matching. */
export interface SwiftHashtag {
  name: string;
  display: string;
}

/** Somebody named in a Swift. `username` is what the caption says. */
export interface SwiftMention {
  user_id: number;
  username: string;
}

/**
 * A Swift as the feed and the detail endpoint send it.
 *
 * Note what is absent: every location field. `location_available` is a
 * *boolean about this viewer* — "would pressing the reveal button work" — and
 * not "does this row have coordinates". The difference is argued in
 * `swifts/visibility.py::location_available_for`; a flag derived from column
 * nullity would tell a viewer which Swifts are hiding something from them
 * specifically.
 */
/**
 * Where a Swift is on its way to being public, as told to its author.
 *
 * Not the server's `moderation` column. That column answers a question about
 * enforcement — has this been taken down — and this answers a question about
 * progress: can I show this to anybody yet. The mapping happens server-side in
 * `SwiftSerializer.get_review_state`, so the app never learns the enforcement
 * vocabulary and a new internal state does not become an App Store release.
 *
 * Only the author is ever told anything but `published`. For every other
 * viewer the server sends `published` unconditionally, because a Swift in any
 * other state is one `swifts.visibility.live_q` has already made invisible to
 * them.
 */
export type SwiftReviewState =
  /** The file is still being uploaded or transcoded. */
  | 'processing'
  /** Stored, screened by nothing yet, and visible to nobody but the author. */
  | 'reviewing'
  /** Live. The only state in which anybody else can watch it. */
  | 'published'
  /** Held back for a human to look at. Not an accusation — see
   *  `components/swifts/SwiftReviewNotice`. */
  | 'needs_review';

export interface Swift {
  id: number;
  author: SwiftAuthor;
  caption: string;

  video_url: string;
  thumbnail_url: string;
  duration_ms: number;
  width: number;
  height: number;
  aspect_ratio: number | null;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  /** Author-facing progress state. `published` for every other viewer. */
  review_state: SwiftReviewState;

  // ── Applied at playback, not baked into `video_url` ──────────────────────
  // R2 only stores and serves bytes — it cannot trim, mix or overlay text the
  // way Cloudinary's delivery transformations used to. `video_url` is the raw
  // upload; a player has to seek within [trim_start_ms, trim_end_ms], set its
  // own volume from `original_volume`, and draw `overlay_text` as a layer over
  // the video itself. See `components/swifts/SwiftCard`.
  trim_start_ms: number;
  /** Null means "to the end of the source". */
  trim_end_ms: number | null;
  /** 0–100. */
  original_volume: number;
  overlay_text: string;
  overlay_position: 'top' | 'middle' | 'bottom';
  // ── Optional, and deliberately so ────────────────────────────────────────
  // Every field below was added after the first Swifts shipped, and a phone
  // can be running a build newer than the API it is pointed at — an app-store
  // update racing a deploy is the ordinary case, not an edge one. Marking them
  // optional is what makes that a Swift which plays unfiltered rather than a
  // crash on `.map` of undefined, and every read of them in this app is
  // defaulted accordingly.
  stickers?: SwiftStickerPlacement[];

  /** Playback speed as a percentage: 50 is half, 200 is double. */
  speed_percent?: number;
  /** A quarter turn clockwise, applied by the player. */
  rotation_deg?: 0 | 90 | 180 | 270;
  /** A key from `constants/swiftEffects`; '' is untouched. */
  effect?: string;
  effect_intensity?: number;

  track: SwiftTrackCredit | null;
  audio_title: string;
  audio_artist: string;
  uses_original_audio: boolean;
  /** 0–100, for the bed against the recording's own sound. */
  music_volume?: number;
  /** Where in the track the bed starts. */
  music_start_ms?: number;

  hashtags?: SwiftHashtag[];
  mentions?: SwiftMention[];

  visibility: 'public' | 'friends' | 'private';
  allow_comments: boolean;
  allow_reposts: boolean;

  like_count: number;
  comment_count: number;
  repost_count: number;
  view_count: number;
  viewer_liked: boolean;
  viewer_reposted: boolean;
  /** On this viewer's shortlist. Private: there is no matching count,
   *  because a saved-by number would leak a list nobody may read. */
  viewer_saved: boolean;
  viewer_viewed: boolean;

  /** Whether to draw the reveal button. Never a coordinate. */
  location_available: boolean;

  is_mine: boolean;
  created_at: string;
  updated_at: string;
}

export interface SwiftPage {
  count: number;
  results: Swift[];
}

/**
 * Where a Swift was made.
 *
 * **The only type in the app that carries a Swift's coordinate.** It exists
 * for exactly as long as the sheet showing it, is never persisted, never
 * merged into a `Swift`, and never passed as a navigation parameter — a route
 * param is serialized into navigation state, which outlives the screen and is
 * dumped verbatim by every debugging tool that touches it.
 */
export interface SwiftLocation {
  latitude: number | null;
  longitude: number | null;
  place_name: string;
  captured_at: string;
  /** 'exact', or 'approximate' when the creator shares a fuzzed position. The
   *  sheet draws a circle rather than a pin for the second — a pin over a
   *  ~500m cell would state a precision nobody granted. */
  precision: 'exact' | 'approximate';
}

// ── Feed ─────────────────────────────────────────────────────────────────────
export const FEED_PAGE_SIZE = 10;

/**
 * One page of the ranked feed.
 *
 * `cursor` replaces the offset the feed used to page by, and the difference is
 * not cosmetic. The server ranks once per session and pages are slices of that
 * one ranking; an offset into a list that is re-ranked per request would show
 * the same Swift twice and skip others silently. The cursor names the session,
 * so the sequence is stable for as long as the viewer keeps scrolling.
 *
 * `sources` says which candidate source won each slot. It is carried back on
 * the signals this client reports, which is what lets the server tell "people
 * watch what their friends post" from "people watch whatever is at the top".
 */
export interface SwiftFeedPage {
  results: Swift[];
  cursor: string | null;
  hasMore: boolean;
  sources: Record<string, string>;
}

export async function fetchSwiftFeed(cursor?: string | null): Promise<SwiftFeedPage> {
  const { data } = await api.get<{
    results?: Swift[];
    next_cursor?: string | null;
    has_more?: boolean;
    sources?: Record<string, string>;
  }>('/api/swifts/feed/', {
    params: { limit: FEED_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
  });
  return {
    results: data?.results ?? [],
    cursor: data?.next_cursor ?? null,
    // Falls back to "there is more if we got a full page", so a server that
    // has not been deployed yet still pages instead of stopping after one.
    hasMore: data?.has_more ?? (data?.results?.length ?? 0) >= FEED_PAGE_SIZE,
    sources: data?.sources ?? {},
  };
}

/**
 * The unranked feed, newest first.
 *
 * Kept reachable because "is the recommender doing this" is a question worth
 * being able to answer from the app, and because a ranked feed that fails
 * should be able to fall back to one that cannot.
 */
export async function fetchSwiftFeedChronological(offset = 0): Promise<SwiftPage> {
  const { data } = await api.get<SwiftPage>('/api/swifts/feed/', {
    params: { limit: FEED_PAGE_SIZE, offset, chrono: 1 },
  });
  return { count: data?.count ?? 0, results: data?.results ?? [] };
}

export async function fetchSwift(id: number): Promise<Swift> {
  const { data } = await api.get<Swift>(`/api/swifts/${id}/`);
  return data;
}

// ── Engagement ───────────────────────────────────────────────────────────────
export async function setSwiftLiked(id: number, liked: boolean): Promise<number> {
  const { data } = liked
    ? await api.post<{ like_count: number }>(`/api/swifts/${id}/like/`)
    : await api.delete<{ like_count: number }>(`/api/swifts/${id}/like/`);
  return data?.like_count ?? 0;
}

export async function setSwiftReposted(id: number, reposted: boolean): Promise<number> {
  const { data } = reposted
    ? await api.post<{ repost_count: number }>(`/api/swifts/${id}/repost/`)
    : await api.delete<{ repost_count: number }>(`/api/swifts/${id}/repost/`);
  return data?.repost_count ?? 0;
}

/**
 * Put a Swift on the viewer's shortlist, or take it off.
 *
 * Returns nothing but the new state, because there is nothing else to return:
 * saving moves no public counter, unlike a like or a repost. That is the whole
 * difference between a bookmark and a signal.
 *
 * Safe to call twice. The server holds one row per (swift, viewer) — a unique
 * constraint, not a check — so a double tap, a retry on a flaky connection, or
 * the same Swift saved from the feed and from its detail screen all collapse to
 * one entry. Callers do not need to guard against it.
 */
export async function setSwiftSaved(id: number, saved: boolean): Promise<boolean> {
  const { data } = saved
    ? await api.post<{ saved: boolean }>(`/api/swifts/${id}/save/`)
    : await api.delete<{ saved: boolean }>(`/api/swifts/${id}/save/`);
  return data?.saved ?? saved;
}

/**
 * Take a Swift down for everyone.
 *
 * Author only — the server answers 404 to anybody else rather than 403, so a
 * stranger cannot even learn the Swift exists. The client still gates the menu
 * on `is_mine`, which is about not offering an action that would fail, not
 * about enforcement.
 *
 * A soft delete server-side: the row survives so the location-reveal audit,
 * the comments and the likes outlive it — the audit especially is worth more
 * after a Swift comes down than before. Every read path filters it out, so it
 * is gone from the product, and there is no undo in the app.
 */
export async function deleteSwift(id: number): Promise<void> {
  await api.delete(`/api/swifts/${id}/`);
}

/**
 * The viewer's shortlist, newest save first.
 *
 * Shorter than what was saved, sometimes: a Swift made private or taken down
 * since it was saved drops out. The bookmark survives on the server — nothing
 * is deleted from under anyone — but the list only ever shows what can still
 * be watched.
 */
export async function fetchSavedSwifts(limit = 20, offset = 0): Promise<SwiftPage> {
  const { data } = await api.get<SwiftPage>('/api/swifts/saved/', {
    params: { limit, offset },
  });
  return { count: data?.count ?? 0, results: data?.results ?? [] };
}

/**
 * Tell the server this Swift was watched.
 *
 * Idempotent server-side — one row per (swift, viewer) forever — so a card that
 * remounts cannot inflate anything. It matters for more than counting: this is
 * the *only* thing that makes a location reveal possible later, and it has to
 * be a real request rather than a flag the client sets, because the server
 * reads its own row and trusts nothing else.
 */
export async function recordSwiftView(
  id: number,
  opts: { watchMs?: number; completed?: boolean } = {},
): Promise<void> {
  await api.post(`/api/swifts/${id}/view/`, {
    watch_ms: Math.max(0, Math.round(opts.watchMs ?? 0)),
    completed: !!opts.completed,
  });
}

// ── Location ─────────────────────────────────────────────────────────────────
/** Why a reveal did not happen, in words the sheet can show. */
export class SwiftLocationUnavailable extends Error {
  readonly kind: 'not_found' | 'throttled' | 'offline';
  constructor(kind: 'not_found' | 'throttled' | 'offline', message: string) {
    super(message);
    this.name = 'SwiftLocationUnavailable';
    this.kind = kind;
  }
}

/**
 * Ask where a Swift was made.
 *
 * **Called only from a press.** Never on render, never on mount, never from a
 * prefetch, never speculatively for the next card — that is the whole point of
 * the design and `services/__tests__/swiftLocationPrivacy.test.ts` asserts it.
 *
 * The server decides eligibility on its own terms: it checks a `SwiftView` row
 * it wrote itself, so there is no parameter here that could influence the
 * answer, and there is deliberately nothing to add.
 */
export async function revealSwiftLocation(id: number): Promise<SwiftLocation> {
  try {
    const { data } = await api.post<SwiftLocation>(`/api/swifts/${id}/reveal-location/`);
    return data;
  } catch (e: any) {
    const status = e?.response?.status;
    if (status === 429) {
      throw new SwiftLocationUnavailable(
        'throttled', 'Too many location lookups. Try again in a little while.',
      );
    }
    if (status === 404) {
      // Deliberately the same message for every refusal the server makes,
      // because the server deliberately gives the same 404 for all of them —
      // restating that distinction here would undo it.
      throw new SwiftLocationUnavailable(
        'not_found', 'This location isn’t available.',
      );
    }
    throw new SwiftLocationUnavailable(
      'offline', 'Couldn’t load the location. Check your connection.',
    );
  }
}

/** "1.2K" for counts under a 24pt icon, which have no room to grow. */
export function formatCount(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1_000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}K`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)}M`;
}

// ── Comments ─────────────────────────────────────────────────────────────────
export interface SwiftComment {
  id: number;
  author: SwiftAuthor;
  parent: number | null;
  text: string;
  reply_count: number;
  is_mine: boolean;
  created_at: string;
}

export interface SwiftCommentPage {
  count: number;
  results: SwiftComment[];
}

export const COMMENT_PAGE_SIZE = 20;

export async function fetchSwiftComments(
  swiftId: number,
  offset = 0,
): Promise<SwiftCommentPage> {
  const { data } = await api.get<SwiftCommentPage>(
    `/api/swifts/${swiftId}/comments/`,
    { params: { limit: COMMENT_PAGE_SIZE, offset } },
  );
  return { count: data?.count ?? 0, results: data?.results ?? [] };
}

export async function postSwiftComment(
  swiftId: number,
  text: string,
): Promise<SwiftComment> {
  const { data } = await api.post<SwiftComment>(
    `/api/swifts/${swiftId}/comments/`, { text },
  );
  return data;
}

/** The comment's author or the Swift's author may remove it. The server
 *  decides; a refusal is the same 404 as a comment that never existed. */
export async function deleteSwiftComment(commentId: number): Promise<void> {
  await api.delete(`/api/swifts/comments/${commentId}/`);
}
