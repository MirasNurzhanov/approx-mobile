import { api } from './api';

// Picking a zone track out of the Apple Music catalogue.
//
// Nothing here talks to Apple. The catalogue needs a developer token signed
// with a private key that would be public the moment it shipped inside this
// app, so every call goes through Aura's own server, which holds the key and
// forwards the search (see users/applemusic.py).
//
// What a zone plays is Apple's 30-second preview, not the full song. That is
// not a shortcut: full playback needs MusicKit and the *listener's* own Apple
// Music subscription, and someone walking past your zone has neither. The
// picker says so rather than letting people discover it by pressing play.

export interface AppleSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Already sized — the server substitutes Apple's {w}x{h} template. */
  artwork: string;
  preview_url: string;
  duration_ms?: number | null;
}

/** The Apple half of the zone, as the zone endpoint reports it. */
export interface AppleZoneTrack {
  zone_apple_id?: string;
  zone_apple_title?: string;
  zone_apple_artist?: string;
  zone_apple_artwork?: string;
  zone_apple_preview_url?: string;
}

/** Why Apple Music is unusable, when it is.
 *
 *  These are not shades of the same thing. `not_configured` means variables
 *  are absent, `bad_key` means the .p8 will not sign, `rejected` means Apple
 *  refused a token that signed fine — three different places to go and look.
 *  They all arrive as HTTP 503, so the status cannot be what distinguishes
 *  them; this does. */
export type AppleMusicFault = 'not_configured' | 'bad_key' | 'rejected' | 'unavailable';

/** Thrown for anything the user should be told about in words. `fatal` marks
 *  the faults that no amount of retyping fixes — the screen stops offering a
 *  search box and explains instead. */
export class AppleMusicError extends Error {
  code: AppleMusicFault;
  fatal: boolean;
  constructor(message: string, code: AppleMusicFault, fatal: boolean) {
    super(message);
    this.code = code;
    this.fatal = fatal;
  }
}

function toError(e: any): AppleMusicError {
  const status = e?.response?.status;
  const data = e?.response?.data ?? {};
  const code: AppleMusicFault = data.code ?? (status === 503 ? 'not_configured' : 'unavailable');
  return new AppleMusicError(
    data.detail ?? 'The music catalogue could not be reached. Please try again.',
    code,
    status === 503,
  );
}

/** What the server says about its own Apple credentials, without needing a
 *  search to find out. Answers even when misconfigured — that is its job. */
export interface AppleMusicStatus {
  configured: boolean;
  code: AppleMusicFault | 'ok';
  /** Variable names, when that is the problem. Empty otherwise. */
  missing: string[];
  detail: string;
}

export async function appleMusicStatus(): Promise<AppleMusicStatus> {
  const r = await api.get<AppleMusicStatus>('/api/users/zone/apple-music/status/');
  return r.data;
}

/** Catalogue songs matching `term`. Empty for queries too short to be a search
 *  — the server answers those with an empty list, and this saves the trip. */
export async function searchAppleMusic(term: string, signal?: AbortSignal): Promise<AppleSong[]> {
  const q = term.trim();
  if (q.length < 2) return [];
  try {
    const r = await api.get<AppleSong[]>('/api/users/zone/apple-music/search/', {
      params: { q },
      signal,
    });
    return Array.isArray(r.data) ? r.data : [];
  } catch (e: any) {
    // An aborted request is the previous keystroke being cancelled, not a
    // failure anyone needs to read about.
    if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return [];
    throw toError(e);
  }
}

/** Put `song` in the zone. Only the id travels: the server reads the title,
 *  artwork and preview URL back from Apple, so this app can never name the
 *  file everyone else's player will load. Returns the whole zone state. */
export async function setAppleZoneTrack<T>(song: AppleSong): Promise<T> {
  try {
    const r = await api.post<T>('/api/users/zone/apple-music/', { song_id: song.id });
    return r.data;
  } catch (e: any) {
    throw toError(e);
  }
}

/** Take the Apple track out of the zone, leaving whatever the user picks next. */
export async function clearAppleZoneTrack<T>(): Promise<T> {
  try {
    const r = await api.delete<T>('/api/users/zone/apple-music/');
    return r.data;
  } catch (e: any) {
    throw toError(e);
  }
}

/** "3:42" from Apple's millisecond duration. Blank when it is missing, which
 *  reads better than "0:00" beside a track that plays fine. */
export function songLength(ms?: number | null): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
