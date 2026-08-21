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

  track: SwiftTrackCredit | null;
  audio_title: string;
  audio_artist: string;
  uses_original_audio: boolean;

  visibility: 'public' | 'friends' | 'private';
  allow_comments: boolean;
  allow_reposts: boolean;

  like_count: number;
  comment_count: number;
  repost_count: number;
  view_count: number;
  viewer_liked: boolean;
  viewer_reposted: boolean;
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
