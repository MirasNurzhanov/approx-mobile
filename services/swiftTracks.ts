import { api } from './api';

/**
 * Aura's own music catalogue.
 *
 * **Every track here comes from `/api/swifts/tracks/`, which serves only rows
 * an operator has published after reading their licence.** There is no other
 * source, and there is deliberately no code path in this app that can turn a
 * URL from a streaming service into a Swift's soundtrack — not Spotify, not
 * Apple Music, not TikTok, not a scraper. The picker can only offer what the
 * catalogue contains.
 *
 * Worth stating explicitly because Aura *does* already integrate Apple Music,
 * for zone playback (`services/appleMusic.ts`). That is a different act under
 * different terms: a zone streams Apple's own 30-second preview to a listener,
 * where a Swift bakes audio into a file that Aura then redistributes. The two
 * must not be wired together, and the catalogue exists so they never need to
 * be.
 */

export interface SwiftTrack {
  id: number;
  title: string;
  artist: string;
  genre: string;
  /** Streamed for the in-picker preview. The final mix happens server-side. */
  audio_url: string;
  artwork_url: string;
  duration_ms: number;
  /** The credit line a licence may require. Shown wherever the track is named. */
  attribution: string;
  use_count: number;
}

export interface TrackPage {
  count: number;
  results: SwiftTrack[];
}

export const TRACK_PAGE_SIZE = 20;

export interface TrackQuery {
  q?: string;
  genre?: string;
  limit?: number;
  offset?: number;
}

export async function fetchTracks(query: TrackQuery = {}): Promise<TrackPage> {
  const { data } = await api.get<TrackPage>('/api/swifts/tracks/', {
    params: {
      q: query.q || undefined,
      genre: query.genre || undefined,
      limit: query.limit ?? TRACK_PAGE_SIZE,
      offset: query.offset ?? 0,
    },
  });
  return { count: data?.count ?? 0, results: data?.results ?? [] };
}

export async function fetchTrackGenres(): Promise<string[]> {
  const { data } = await api.get<{ results: string[] }>('/api/swifts/tracks/genres/');
  return data?.results ?? [];
}

/** "3:07". Used under the title in the picker, so it has to be compact. */
export function formatTrackDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The window of a track that will play under a Swift of `swiftMs`.
 *
 * Clamped so the chosen start can never run past the end of the song: a track
 * started four seconds before it finishes leaves the rest of the Swift silent,
 * and the server would render exactly that without complaining.
 */
export function clampTrackOffset(offsetMs: number, trackMs: number, swiftMs: number): number {
  if (trackMs <= 0) return 0;
  const latest = Math.max(0, trackMs - swiftMs);
  return Math.min(Math.max(0, Math.round(offsetMs)), latest);
}
