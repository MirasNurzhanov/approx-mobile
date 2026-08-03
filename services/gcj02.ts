// Display-only coordinate shift for mainland China basemaps.
//
// Everything Aura stores, sends, and reasons about is WGS-84 — raw GPS, OSM
// geometry, every containment test. That does not change, and nothing in this
// file is allowed to leak into it.
//
// What does change is what a *basemap tile* means. Chinese law requires
// published maps to use GCJ-02, a deliberately obfuscated datum offset from
// WGS-84 by a few hundred metres in a way that varies by location. Google
// serves GCJ-02 tiles for mainland China, so a WGS-84 polygon drawn over them
// lands in the wrong street — the border of a district can sit a block or two
// off the roads it actually follows.
//
// The transform below is the widely-used reconstruction of that offset. It is
// an approximation of an unpublished government algorithm: good to roughly ten
// metres in practice, but not something to treat as exact and never something
// to store.
//
// ── Where this is applied, and where it is not ───────────────────────────────
// Applied: the zone-area preview, which is a static, non-interactive map that
// renders exactly one shape and reads nothing back. Every element on it can be
// shifted together, so the result is self-consistent.
//
// NOT applied: the main map. Shifting the zone polygon there without also
// shifting every marker, cluster, trail and circle would make the polygon
// disagree with the viewer's own dot, which is worse than a uniform offset —
// the one question the outline exists to answer is "am I inside it?". Doing it
// completely means threading a second coordinate space through the marker
// layout and clustering maths, which is a much larger change than this one.
// The main map instead tells the user the basemap is offset. See
// `MAINLAND_CHINA_NOTICE`.

const PI = Math.PI;
/** Krasovsky 1940 semi-major axis, which is what the GCJ-02 offset is defined against. */
const A = 6378245.0;
/** Krasovsky eccentricity squared. */
const EE = 0.00669342162296594323;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Shown when the viewer is somewhere the basemap and real positions disagree. */
export const MAINLAND_CHINA_NOTICE =
  'Map tiles in mainland China are shifted by a few hundred metres from real GPS positions. Zones are still measured from your true location, so what you see may not line up with the streets.';

// ─── Region test ──────────────────────────────────────────────────────────────
// The usual published test for "is this in China" is a bounding box —
// 72.004E to 137.8347E, 0.8293N to 55.8271N — and it is not usable here. That
// box reaches 700km into Kazakhstan and swallows Almaty, this app's home city,
// along with Bishkek, Hanoi, Seoul, Kathmandu and Ulaanbaatar. Shifting any of
// those would introduce the exact error this file exists to remove.
//
// So the test is a coarse outline instead: about sixty points around the
// mainland, plus Hainan. It is accurate to a few tens of kilometres, which is
// far more than enough to separate a neighbouring capital from the border, and
// deliberately not more than that — this decides whether to nudge a polygon on
// a preview map, not where a frontier lies.

type Ring = [number, number][];

/** Mainland China, coarsely, as [lon, lat] going clockwise from the north. */
const MAINLAND: Ring = [
  [124.0, 53.5], [126.0, 52.8], [130.7, 48.9], [135.1, 48.4], [133.0, 45.5],
  [131.3, 44.9], [131.0, 42.9], [128.1, 42.0], [126.0, 41.5], [124.4, 40.0],
  [122.1, 39.4], [121.8, 38.7], [118.0, 38.9], [119.2, 37.1], [122.7, 37.4],
  [120.3, 35.9], [120.9, 32.0], [121.9, 31.0], [121.6, 29.9], [120.5, 27.5],
  [119.6, 25.4], [117.5, 23.7], [114.5, 22.5], [113.5, 22.0], [110.8, 21.4],
  [109.7, 21.4], [108.5, 21.5], [106.7, 22.0], [104.8, 22.7], [103.3, 22.5],
  [101.8, 21.2], [100.1, 21.5], [97.8, 23.9], [97.5, 25.4], [98.7, 27.5],
  [96.2, 29.0], [92.0, 27.7], [88.8, 27.3], [86.0, 28.1], [82.0, 30.2],
  [79.0, 32.3], [78.2, 34.5], [76.0, 35.6], [74.5, 37.0], [73.5, 39.3],
  [75.0, 40.5], [76.8, 41.0], [80.2, 42.8], [82.6, 45.2], [85.0, 47.0],
  [87.4, 48.0], [90.5, 47.8], [95.5, 44.0], [96.4, 42.8], [100.0, 42.6],
  [105.0, 41.8], [110.0, 42.5], [112.5, 43.8], [115.5, 45.4], [119.6, 46.7],
  [120.0, 50.3], [121.0, 53.4],
];

/** Hainan, which the mainland coastline necessarily leaves out. */
const HAINAN: Ring = [
  [108.6, 19.9], [109.2, 20.1], [110.6, 20.15], [111.05, 19.6], [110.5, 18.4],
  [109.2, 18.2], [108.6, 19.3],
];

/** Places inside that outline which Google still serves in WGS-84.
 *
 * Macau sits on the mainland coast and the outline cannot exclude it; Hong
 * Kong and Taiwan are handled by the coastline itself, and are named here as
 * well because their exclusion is a deliberate choice rather than an accident
 * of where the coast happens to fall.
 *
 * Rectangles around complicated coastlines, so approximate in both directions.
 * Hong Kong's northern New Territories and the offshore islands of Kinmen and
 * Matsu fall on the wrong side of these — a few square kilometres each, and
 * knowingly left imprecise. */
const WGS84_ENCLAVES = [
  { minLat: 22.15, maxLat: 22.5, minLon: 113.83, maxLon: 114.44 }, // Hong Kong
  { minLat: 22.06, maxLat: 22.23, minLon: 113.52, maxLon: 113.61 }, // Macau
  { minLat: 21.85, maxLat: 25.36, minLon: 119.3, maxLon: 122.11 },  // Taiwan, Penghu
];

/** Even-odd ray cast, east from the point. Local to this file on purpose: the
 *  transform must not depend on anything that could grow a region-shaped
 *  meaning of its own. */
function inRing(ring: Ring, latitude: number, longitude: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    if ((y1 > latitude) !== (y2 > latitude)) {
      const xAt = x1 + ((latitude - y1) * (x2 - x1)) / (y2 - y1);
      if (longitude < xAt) inside = !inside;
    }
  }
  return inside;
}

/** Whether a WGS-84 point falls where Google's tiles are GCJ-02.
 *
 * The only gate on the transform. A point outside this is returned untouched,
 * which is what keeps the rest of the world — and every test elsewhere in the
 * app — completely unaffected by this file. */
export function isInMainlandChina(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (
    WGS84_ENCLAVES.some(
      (box) =>
        latitude >= box.minLat && latitude <= box.maxLat &&
        longitude >= box.minLon && longitude <= box.maxLon,
    )
  ) {
    return false;
  }
  return inRing(MAINLAND, latitude, longitude) || inRing(HAINAN, latitude, longitude);
}

// ─── The offset ───────────────────────────────────────────────────────────────
function transformLat(x: number, y: number): number {
  let ret =
    -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return ret;
}

function transformLon(x: number, y: number): number {
  let ret =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return ret;
}

/** WGS-84 → GCJ-02, for drawing on a Chinese basemap and nothing else.
 *
 * Outside mainland China this is the identity, so it is safe to call
 * unconditionally on anything headed for a map. */
export function wgs84ToGcj02(latitude: number, longitude: number): LatLng {
  if (!isInMainlandChina(latitude, longitude)) return { latitude, longitude };

  // The offset is defined relative to a point near the centre of the country.
  const x = longitude - 105.0;
  const y = latitude - 35.0;

  let dLat = transformLat(x, y);
  let dLon = transformLon(x, y);

  const radLat = (latitude / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  // Metres of offset → degrees, at this latitude.
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);

  return { latitude: latitude + dLat, longitude: longitude + dLon };
}

/** The same shift over a list of already-converted map points. */
export function shiftForDisplay(points: LatLng[]): LatLng[] {
  if (!points.length) return points;
  // One test for the whole shape: a polygon does not straddle the edge of the
  // country in any case that matters, and testing per-point could otherwise
  // shift half a border and leave the other half, tearing it in two.
  const [first] = points;
  if (!isInMainlandChina(first.latitude, first.longitude)) return points;
  return points.map((p) => wgs84ToGcj02(p.latitude, p.longitude));
}
