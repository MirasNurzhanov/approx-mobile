import { api } from './api';
import type { SwiftTrackChoice } from './swiftDraft';
import type { Swift } from './swifts';

/**
 * The composer's supporting endpoints: music, tags and private sends.
 *
 * One module rather than three, because all three are small, all three are
 * only ever called from the composer, and the alternative is three files whose
 * combined content is shorter than the note explaining why they are separate.
 *
 * None of these touch the publish itself — that is `services/swiftUpload`.
 */

// ── Music ────────────────────────────────────────────────────────────────────

/** A catalogue track, as `swifts.serializers.SwiftTrackSerializer` sends it. */
export interface SwiftTrack {
  id: number;
  title: string;
  artist: string;
  genre: string;
  audio_url: string;
  artwork_url: string;
  duration_ms: number;
  attribution: string;
}

export interface TrackPage {
  count: number;
  results: SwiftTrack[];
}

/**
 * Search Approx's own catalogue.
 *
 * Approx's own, and never a music provider's API directly — see
 * `swifts/music/base.py` for why that is structural rather than incidental: a
 * picker that called a partner on every keystroke would be slow, would burn a
 * rate limit on people scrolling, and would go dark during composition, which
 * is the worst possible moment for it to.
 */
export async function searchTracks(params: {
  q?: string;
  genre?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<TrackPage> {
  const { data } = await api.get<TrackPage>('/api/swifts/tracks/', { params });
  return data;
}

/** The genre chips above the track list, derived from what is published. */
export async function trackGenres(): Promise<string[]> {
  const { data } = await api.get<{ results: string[] }>('/api/swifts/tracks/genres/');
  return data.results ?? [];
}

/** A catalogue row reduced to what the draft and the player need. */
export function toTrackChoice(track: SwiftTrack): SwiftTrackChoice {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    artworkUrl: track.artwork_url,
    audioUrl: track.audio_url,
    durationMs: track.duration_ms,
  };
}

// ── Hashtags ─────────────────────────────────────────────────────────────────

export interface HashtagSuggestion {
  name: string;
  /** The tag as somebody first wrote it; shown, never compared. */
  display: string;
  swift_count: number;
}

/**
 * Tag suggestions: matching a prefix, or what is busiest when nothing is typed.
 *
 * Failure returns an empty list rather than throwing. A suggestion list is an
 * assist, and a creator who is mid-caption should not meet an error dialog
 * because a lookup timed out — they can type the tag themselves, and the
 * server parses the caption on publish regardless.
 */
export async function suggestHashtags(q = '', limit = 20): Promise<HashtagSuggestion[]> {
  try {
    const { data } = await api.get<{ results: HashtagSuggestion[] }>(
      '/api/swifts/hashtags/',
      { params: { q, limit } },
    );
    return data.results ?? [];
  } catch {
    return [];
  }
}

export interface HashtagPage {
  tag: { name: string; display: string };
  count: number;
  results: Swift[];
}

/**
 * Everything under one tag, newest first.
 *
 * The `count` is what *this viewer* can see, not the tag's total — the server
 * deliberately does not publish the denormalised figure, because the
 * difference between the two is a measure of how much is being withheld from
 * you. See `SwiftHashtagFeedView`.
 *
 * A tag that does not exist, or one a moderator has switched off, is a 404 and
 * throws like any other missing resource.
 */
export async function fetchHashtagSwifts(
  name: string,
  params: { limit?: number; offset?: number } = {},
): Promise<HashtagPage> {
  const { data } = await api.get<HashtagPage>(
    `/api/swifts/hashtags/${encodeURIComponent(name)}/`,
    { params },
  );
  return data;
}

// ── People ───────────────────────────────────────────────────────────────────

export interface Person {
  id: number;
  username: string;
  profile_picture?: string | null;
}

/**
 * Everyone this account may send a Swift to.
 *
 * Friends and accepted Hi's both, deduplicated — the DM rules treat an
 * accepted Hi as a writable conversation (`friends.views._are_connected`), so
 * a sheet that only listed friends would hide people the send would in fact
 * reach.
 */
export async function sendablePeople(): Promise<Person[]> {
  const { data } = await api.get<{ friends: Person[]; connections: Person[] }>(
    '/api/friends/list/',
  );
  const seen = new Set<number>();
  const out: Person[] = [];
  for (const person of [...(data.friends ?? []), ...(data.connections ?? [])]) {
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    out.push(person);
  }
  return out;
}

// ── Sending a Swift privately ────────────────────────────────────────────────

export interface SendResult {
  sent: { user_id: number; message_id: number }[];
  refused: { user_id: number; reason: string }[];
}

/**
 * Forward a Swift into people's DMs.
 *
 * **Partial success is normal and is reported, not thrown.** Sending to five
 * people where one has since blocked you must reach the other four, so the
 * server answers with both lists and this returns them unchanged. A caller
 * that treats a non-empty `refused` as a failure is getting it wrong; what it
 * should do is say which sends did not go and why.
 *
 * The one case that does throw is the whole call failing — a 404 for a Swift
 * this account cannot watch, or no recipients at all.
 */
export async function sendSwiftTo(
  swiftId: number,
  userIds: number[],
): Promise<SendResult> {
  const { data } = await api.post<SendResult>(
    `/api/swifts/${swiftId}/send/`,
    { user_ids: userIds },
  );
  return { sent: data.sent ?? [], refused: data.refused ?? [] };
}
