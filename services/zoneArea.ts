import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from './api';

// The *shape* of a zone: a circle you size yourself, or a real place whose
// borders it follows.
//
// A region outline is ~1500 points, so it never rides along with the nearby
// poll — that payload carries a `zone_region_id` and nothing more, and the
// outline is resolved here, once per region, however many people share it.
// Two people in the same city cost one fetch between them, and a returning
// user costs none: the disk cache survives a restart, and a city border does
// not move.

// ─── Types ────────────────────────────────────────────────────────────────────
export type ZoneMode = 'radius' | 'region';

/** The two sizes a region zone comes in. `other` exists because the cache also
 *  holds things that are neither — a province, a country — reachable by search
 *  but never by the two buttons. */
export type RegionKind = 'city' | 'district' | 'other';

/** A region without its geometry — enough to list and label, not to draw. */
export interface RegionSummary {
  id: number;
  name: string;
  display_name: string;
  country_code: string;
  kind: RegionKind;
  admin_level: number | null;
  min_lat: number;
  min_lon: number;
  max_lat: number;
  max_lon: number;
  centroid_lat: number;
  centroid_lon: number;
  point_count: number;
}

/** `rings` is a list of closed rings of `[lon, lat]` pairs — GeoJSON's order,
 *  which is the reverse of the `{latitude, longitude}` react-native-maps
 *  wants. `toLatLng` is the only place that conversion should happen. */
export interface Region extends RegionSummary {
  rings: [number, number][][];
}

export const RADIUS_MIN_M = 50;
export const RADIUS_MAX_M = 5000;

// ─── Cache ────────────────────────────────────────────────────────────────────
const STORAGE_PREFIX = 'aura:region:';

/** Survives the session; the disk copy survives the app. Regions are immutable
 *  once fetched — a city border is not something that changes under us — so
 *  neither copy is ever invalidated on a timer. */
const memory = new Map<number, Region>();
/** In-flight fetches, so a map frame that asks for the same region from five
 *  markers at once issues one request rather than five. */
const inFlight = new Map<number, Promise<Region | null>>();

function storageKey(id: number): string {
  return `${STORAGE_PREFIX}${id}`;
}

/** A region's outline, from memory, then disk, then the server.
 *
 * Never throws: a missing outline means the map draws no zone for that person,
 * which is a far better outcome than a render that fails. */
export async function getRegion(id: number): Promise<Region | null> {
  const cached = memory.get(id);
  if (cached) return cached;

  const pending = inFlight.get(id);
  if (pending) return pending;

  const request = (async (): Promise<Region | null> => {
    try {
      const stored = await AsyncStorage.getItem(storageKey(id));
      if (stored) {
        const region = JSON.parse(stored) as Region;
        memory.set(id, region);
        return region;
      }
    } catch {
      // A corrupt entry is not worth failing over — refetch it.
    }

    try {
      const { data } = await api.get<Region>(`/api/regions/${id}/`);
      memory.set(id, data);
      AsyncStorage.setItem(storageKey(id), JSON.stringify(data)).catch(() => {});
      return data;
    } catch {
      return null;
    } finally {
      inFlight.delete(id);
    }
  })();

  inFlight.set(id, request);
  return request;
}

/** The synchronous read the map render needs. Returns null until the async
 *  fetch above has landed, which is the cue to draw nothing yet. */
export function peekRegion(id: number): Region | null {
  return memory.get(id) ?? null;
}

// ─── Lookup ───────────────────────────────────────────────────────────────────
export async function searchRegions(query: string): Promise<RegionSummary[]> {
  const { data } = await api.get<RegionSummary[]>('/api/regions/search/', {
    params: { q: query },
  });
  return Array.isArray(data) ? data : [];
}

/** What a "where am I" lookup produced. `region` is null when nothing of the
 *  requested size covers the point — at sea, in unmapped territory, or, for a
 *  district lookup, in a city with no mapped subdivisions.
 *
 *  `cityName` survives a miss, because the server reads the place's name out
 *  of the address hierarchy even when no boundary is mapped for it. It is what
 *  lets the screen say which city it searched rather than just "not found". */
export interface RegionLookup {
  region: RegionSummary | null;
  cityName: string | null;
}

/** The place containing a point, at the size asked for.
 *
 * Never silently substitutes one size for another: asking for a district and
 * receiving the whole city would widen a zone by orders of magnitude without
 * the user choosing it. */
export async function regionForPoint(
  latitude: number,
  longitude: number,
  level: 'city' | 'district' = 'city',
): Promise<RegionLookup> {
  try {
    const { data } = await api.get<RegionSummary>('/api/regions/for-point/', {
      params: { lat: latitude, lon: longitude, level },
    });
    return { region: data ?? null, cityName: null };
  } catch (e: any) {
    if (e?.response?.status === 404) {
      return { region: null, cityName: e.response.data?.city_name ?? null };
    }
    throw e;
  }
}

/** "City" / "District" — the size label shown beside a place's name. */
export function kindLabel(kind: RegionKind): string {
  if (kind === 'city') return 'City';
  if (kind === 'district') return 'District';
  return 'Area';
}

// ─── Geometry ─────────────────────────────────────────────────────────────────
/** GeoJSON `[lon, lat]` → the `{latitude, longitude}` react-native-maps takes.
 *  Getting this backwards puts every city in the wrong hemisphere, so it lives
 *  in exactly one place. */
export function toLatLng(ring: [number, number][]) {
  return ring.map(([longitude, latitude]) => ({ latitude, longitude }));
}

/** Whether a point falls inside a region.
 *
 * Mirrors `Region.contains` on the server: bounding box first, then even-odd
 * ray casting across every ring, so a hole in the polygon flips the result
 * back out without needing a second pass. The client repeats the test rather
 * than asking because it runs on every marker of every poll. */
export function regionContains(region: Region, latitude: number, longitude: number): boolean {
  if (
    latitude < region.min_lat || latitude > region.max_lat ||
    longitude < region.min_lon || longitude > region.max_lon
  ) {
    return false;
  }

  let inside = false;
  for (const ring of region.rings) {
    if (ringContains(ring, latitude, longitude)) inside = !inside;
  }
  return inside;
}

function ringContains(ring: [number, number][], lat: number, lon: number): boolean {
  if (ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    // Picks exactly one of the two edges meeting at a vertex, so a ray passing
    // straight through a vertex is not counted twice.
    if ((y1 > lat) !== (y2 > lat)) {
      const xAt = x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1);
      if (lon < xAt) inside = !inside;
    }
  }
  return inside;
}

/** A region's box as a map region, padded so the outline is not flush with the
 *  screen edge. */
export function regionViewport(region: RegionSummary, padding = 0.15) {
  const latDelta = Math.max(region.max_lat - region.min_lat, 0.01) * (1 + padding);
  const lonDelta = Math.max(region.max_lon - region.min_lon, 0.01) * (1 + padding);
  return {
    latitude: region.centroid_lat,
    longitude: region.centroid_lon,
    latitudeDelta: latDelta,
    longitudeDelta: lonDelta,
  };
}

/** "500 m" / "2.5 km". The unit switch is at 1000m so a zone never reads as
 *  "0.4 km", which is harder to picture than the metres it came from. */
export function formatRadius(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return `${km % 1 === 0 ? km : km.toFixed(1)} km`;
}

/** Clears every cached outline. Called on sign-out: the regions themselves are
 *  not private, but a device handed to the next account should not carry the
 *  previous one's cities. */
export async function resetRegionCache(): Promise<void> {
  memory.clear();
  inFlight.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(STORAGE_PREFIX));
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    // Best effort — a stale outline is shared public geometry, not a leak.
  }
}
