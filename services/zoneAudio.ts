import { api } from './api';

// What a zone track is *called*.
//
// The server sends a bare `zone_audio_url` and nothing else — no title, no
// artist. That is enough to play, but a player that says
// "audio_1e543c3d50.mp3" is a file browser, not a track. So the name is
// resolved here, in one place, for both the map's friend card and the owner's
// zone setup screen:
//
//   preset URL  → the preset's own name ("Rain", "Café")
//   upload      → the filename, cleaned up ("nocturne_04_ab12cd.mp3" → "Nocturne 04")

export interface ZonePreset {
  id: string;
  name: string;
  emoji?: string;
  url?: string;
}

/** Matches users/presets.py. Used until the real list arrives, and if it never
 *  does — the ids are what the API accepts, the names are only shown. */
export const FALLBACK_PRESETS: ZonePreset[] = [
  { id: 'rain',      name: 'Rain'        },
  { id: 'cafe',      name: 'Café'        },
  { id: 'forest',    name: 'Forest'      },
  { id: 'ocean',     name: 'Ocean Waves' },
  { id: 'fireplace', name: 'Fireplace'   },
  { id: 'lofi',      name: 'Lo-fi Beats' },
];

// Module-level cache: the preset list is a constant on the server, and the map
// would otherwise refetch it on every mount.
let cached: ZonePreset[] | null = null;
let inFlight: Promise<ZonePreset[]> | null = null;

export function cachedZonePresets(): ZonePreset[] {
  return cached ?? FALLBACK_PRESETS;
}

export async function loadZonePresets(): Promise<ZonePreset[]> {
  if (cached) return cached;
  if (!inFlight) {
    inFlight = api
      .get<ZonePreset[] | { presets: ZonePreset[] }>('/api/users/zone/presets/')
      .then((r) => {
        const raw = r.data;
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.presets) ? raw.presets : [];
        cached = list.length > 0 ? list : FALLBACK_PRESETS;
        return cached;
      })
      .catch(() => FALLBACK_PRESETS)
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/** Signing and cache-busting query strings differ between responses for the
 *  same file, so URLs are compared without them. */
function bareUrl(url: string): string {
  return url.split('?')[0].split('#')[0];
}

export function presetForUrl(url?: string | null, presets: ZonePreset[] = cachedZonePresets()): ZonePreset | null {
  if (!url) return null;
  const bare = bareUrl(url);
  return presets.find((p) => p.url && bareUrl(p.url) === bare) ?? null;
}

/** "…/zones/nocturne_04_ab12cd.mp3" → "Nocturne 04". Cloudinary appends a
 *  random suffix to raw uploads, which is noise in a track title. */
export function fileTitle(url: string): string {
  let name = '';
  try {
    name = decodeURIComponent(bareUrl(url).split('/').pop() ?? '');
  } catch {
    name = bareUrl(url).split('/').pop() ?? '';
  }
  const cleaned = name
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/_[a-z0-9]{6,}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Zone audio';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function trackTitle(url?: string | null, presets: ZonePreset[] = cachedZonePresets()): string {
  if (!url) return 'Zone audio';
  return presetForUrl(url, presets)?.name ?? fileTitle(url);
}

/** mm:ss, for a player's own timings. Undefined length reads as "--:--" rather
 *  than 0:00, which would look like a track that never plays. */
export function fmtTime(millis?: number | null): string {
  if (millis == null || !Number.isFinite(millis) || millis < 0) return '--:--';
  const total = Math.floor(millis / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function fmtRadius(m?: number | null): string {
  if (!m || m <= 0) return '—';
  return m >= 1000 ? `${(m / 1000) % 1 === 0 ? m / 1000 : (m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
