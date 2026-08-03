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
 *  wants. `toLatLng` is the only place that conversion should happen.
 *
 *  Longitudes are *unwrapped*, matching regions/geometry.py on the server: a
 *  region crossing the ±180 meridian carries values past 180 rather than
 *  jumping from +179.9 to -179.9. `ringsForDisplay` is what turns that back
 *  into something a map can draw. */
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
// Two ways to arrive at a region, and they end at the same place.
//
// Tracing is the primary one: it asks the server what contains your position,
// so it cannot name anywhere you are not. Search is the fallback for when
// tracing finds nothing — usually because Nominatim's address hierarchy did not
// name your area in a way the lookup could resolve, even though somebody has
// already cached the region itself.
//
// Search does *not* relax the rule that a zone covers a place you are in. The
// server enforces that on save regardless of how the region was found, so the
// screen filters results it can already tell will be refused rather than
// letting someone pick a city across the world and meet a 400.

/** How a lookup ended. These are the server's coverage categories, and the
 *  screen shows a different thing for each:
 *
 *  - `resolved`          a stored polygon or the address hierarchy answered it
 *  - `resolved_fallback` a name search or a direct boundary-relation query did
 *  - `ambiguous`         several places fit; the user picks
 *  - `rejected`          polygons were found, none trustworthy enough to assume
 *  - `unmapped`          OpenStreetMap has no boundary here at this size
 */
export type LookupOutcome =
  | 'resolved'
  | 'resolved_fallback'
  | 'ambiguous'
  | 'rejected'
  | 'unmapped';

/** One ranked choice, when the server declines to pick on its own.
 *
 *  `reasons` is what makes a picker usable rather than a coin toss — "sits
 *  inside Dar es Salaam", "admin level 7 is primary for tz". Without them two
 *  names sit side by side with nothing to tell them apart. */
export interface RegionCandidate {
  region: RegionSummary;
  score: number;
  reasons: string[];
  stage: string;
}

/** What a "where am I" lookup produced.
 *
 *  `region` is set only when the server was confident. Otherwise `candidates`
 *  carries the ranked alternatives — deliberately, because a low-confidence
 *  guess here does not fail once, it gets stored and becomes the answer for
 *  everyone who stands there afterwards.
 *
 *  `cityName` survives a miss, because the server reads the place's name out
 *  of the address hierarchy even when no boundary is mapped for it. It is what
 *  lets the screen say which city it searched rather than just "not found". */
export interface RegionLookup {
  outcome: LookupOutcome;
  region: RegionSummary | null;
  candidates: RegionCandidate[];
  cityName: string | null;
  detail: string | null;
}

/** The place containing a point, at the size asked for.
 *
 * Never silently substitutes one size for another: asking for a district and
 * receiving the whole city would widen a zone by orders of magnitude without
 * the user choosing it.
 *
 * Three response shapes, told apart by what is present. A resolved answer
 * carries the region's own fields at the top level — the shape this endpoint
 * has always had — so the discriminator is `id`. */
export async function regionForPoint(
  latitude: number,
  longitude: number,
  level: 'city' | 'district' = 'city',
): Promise<RegionLookup> {
  try {
    const { data } = await api.get<any>('/api/regions/for-point/', {
      params: { lat: latitude, lon: longitude, level },
    });
    if (data?.id) {
      return {
        outcome: data.outcome ?? 'resolved',
        region: data as RegionSummary,
        candidates: [],
        cityName: null,
        detail: null,
      };
    }
    return {
      outcome: data?.outcome ?? 'rejected',
      region: null,
      candidates: Array.isArray(data?.candidates) ? data.candidates : [],
      cityName: data?.city_name ?? null,
      detail: data?.detail ?? null,
    };
  } catch (e: any) {
    if (e?.response?.status === 404) {
      return {
        outcome: e.response.data?.outcome ?? 'unmapped',
        region: null,
        candidates: [],
        cityName: e.response.data?.city_name ?? null,
        detail: e.response.data?.detail ?? null,
      };
    }
    throw e;
  }
}

/** Places matching a typed query, narrowed to the two sizes a zone can be.
 *
 * The `kinds` filter matters: without it the cache happily answers with a
 * province or a country, and one of those is a legal zone as far as the
 * containment rule is concerned — you *are* inside your country. */
export async function searchRegions(query: string): Promise<RegionSummary[]> {
  const { data } = await api.get<RegionSummary[]>('/api/regions/search/', {
    params: { q: query, kinds: 'city,district' },
  });
  return Array.isArray(data) ? data : [];
}

/** "City" / "District" — the size label shown beside a place's name. */
export function kindLabel(kind: RegionKind): string {
  if (kind === 'city') return 'City';
  if (kind === 'district') return 'District';
  return 'Area';
}

// ─── Geometry ─────────────────────────────────────────────────────────────────
// Longitude here is *unwrapped*, exactly as regions/geometry.py stores it: a
// region crossing the ±180 meridian runs past 180 rather than jumping to -179.
// Read wrapped, that jump is not a short hop over the dateline but a sweep
// right around the planet, and it widens the bounding box to the whole world.
//
// Query points arrive in the ordinary ±180 range, so `alignLon` moves one into
// whichever window its region is expressed in before anything is compared. For
// a region that does not cross — which is every region outside a handful of
// Pacific and far-eastern places — the shift is zero and nothing here behaves
// any differently than it did before.

const TURN = 360;

/** Express `lon` in the same window as a region spanning min..max.
 *
 *  Picks the whole-turn shift landing nearest the middle of the window, which
 *  is the only representation that can fall inside it. */
export function alignLon(lon: number, minLon: number, maxLon: number): number {
  const shift = Math.round(((minLon + maxLon) / 2 - lon) / TURN);
  return shift === 0 ? lon : lon + shift * TURN;
}

/** Whether a region's stored window runs over the dateline. */
export function crossesAntimeridian(region: Pick<RegionSummary, 'min_lon' | 'max_lon'>): boolean {
  return region.max_lon > 180 || region.min_lon < -180;
}

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
  if (latitude < region.min_lat || latitude > region.max_lat) return false;

  const lon = alignLon(longitude, region.min_lon, region.max_lon);
  if (lon < region.min_lon || lon > region.max_lon) return false;

  let inside = false;
  for (const ring of region.rings) {
    if (ringContains(ring, latitude, lon)) inside = !inside;
  }
  return inside;
}

/** The bounding-box half of the test, for a summary with no geometry.
 *
 * Search results carry a box but not the rings, and a box test is necessary
 * but not sufficient — a point outside it is certainly outside the region, a
 * point inside it merely might be. That is enough to grey out results the
 * server would refuse, without fetching an outline per row. */
export function regionBoxContains(
  region: Pick<RegionSummary, 'min_lat' | 'min_lon' | 'max_lat' | 'max_lon'>,
  latitude: number,
  longitude: number,
): boolean {
  if (latitude < region.min_lat || latitude > region.max_lat) return false;
  const lon = alignLon(longitude, region.min_lon, region.max_lon);
  return lon >= region.min_lon && lon <= region.max_lon;
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

// ─── Drawing ──────────────────────────────────────────────────────────────────
/** Clip a ring to one side of a vertical line, Sutherland–Hodgman.
 *
 * Only ever used to cut a ring at the antimeridian, where the clip region is a
 * half-plane and the result stays a single simple ring. */
function clipRing(
  ring: [number, number][],
  boundary: number,
  keepBelow: boolean,
): [number, number][] {
  const inside = (lon: number) => (keepBelow ? lon <= boundary : lon >= boundary);
  const out: [number, number][] = [];

  for (let i = 0; i < ring.length; i++) {
    const current = ring[i];
    const previous = ring[(i - 1 + ring.length) % ring.length];
    const currentIn = inside(current[0]);
    const previousIn = inside(previous[0]);

    if (currentIn !== previousIn) {
      // Crossing the line: emit the point sitting exactly on it.
      const span = current[0] - previous[0];
      const t = span === 0 ? 0 : (boundary - previous[0]) / span;
      out.push([boundary, previous[1] + t * (current[1] - previous[1])]);
    }
    if (currentIn) out.push(current);
  }
  return out;
}

/** One unwrapped ring → the pieces a map can actually draw.
 *
 * A ring that stays inside ±180 comes back untouched, as one piece. A ring
 * that runs past it is cut at the meridian and the far piece slid back a whole
 * turn, giving two polygons that meet at the edge of the map. Handing the
 * unwrapped coordinates straight to Google Maps instead draws the shape the
 * long way around the world — a band across every longitude rather than an
 * island group. */
export function splitRingAtAntimeridian(ring: [number, number][]): [number, number][][] {
  if (ring.length < 3) return [];

  // GeoJSON closes its rings by repeating the first point; the clipper walks
  // edges cyclically and would treat the duplicate as a zero-length one.
  const open =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  if (open.length < 3) return [];

  const lons = open.map(([lon]) => lon);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  if (minLon >= -180 && maxLon <= 180) return [open];

  // Normalise so the overhang is always on the +180 side, so there is one case
  // to cut rather than two.
  const shifted: [number, number][] =
    minLon < -180 ? open.map(([lon, lat]) => [lon + TURN, lat]) : open;

  const near = clipRing(shifted, 180, true);
  const far = clipRing(shifted, 180, false).map(
    ([lon, lat]) => [lon - TURN, lat] as [number, number],
  );

  return [near, far].filter((piece) => piece.length >= 3);
}

/** Every ring of a region, ready to hand to a `<Polygon>`.
 *
 * The one place a screen should get drawing coordinates from: it applies the
 * antimeridian split and, optionally, the mainland-China display shift, so no
 * screen has to remember either. */
export function ringsForDisplay(
  region: Region,
  transform?: (points: { latitude: number; longitude: number }[]) => {
    latitude: number;
    longitude: number;
  }[],
): { latitude: number; longitude: number }[][] {
  const pieces: { latitude: number; longitude: number }[][] = [];
  for (const ring of region.rings) {
    for (const piece of splitRingAtAntimeridian(ring)) {
      const points = toLatLng(piece);
      pieces.push(transform ? transform(points) : points);
    }
  }
  return pieces;
}

/** A region's box as a map region, padded so the outline is not flush with the
 *  screen edge.
 *
 *  The deltas come from the unwrapped bounds, so a region crossing the dateline
 *  frames as the four degrees wide it really is rather than as the whole
 *  planet. The centroid is already wrapped back into ±180 by the server, which
 *  is what a map wants for a centre. */
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
