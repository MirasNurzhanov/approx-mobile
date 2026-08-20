// Coordinates arriving from the API, forced to numbers.
//
// Django REST Framework renders a `DecimalField` as a JSON *string* by default
// (`COERCE_DECIMAL_TO_STRING`), so `/api/map/nearby/` sends story and meetup
// positions as `"43.238000"` while nearby users — assembled by hand and left as
// raw `Decimal`s for the renderer — come through as real numbers. The two
// shapes have always disagreed; only the New Architecture made it fatal.
//
// Under the old renderer a string coordinate reached AIRMapMarker as a
// `ReadableMap` and Android's lenient `getDouble` parsed it. Fabric types props
// strictly and throws instead:
//
//   Error while updating property 'coordinate' of a view managed by:
//   AIRMapMarker — Value for latitude cannot be cast from String to double
//
// which is a redbox on mount, not a warning. So coordinates are coerced here,
// at the boundary, once — every consumer downstream (markers, distance maths,
// clustering) then gets the `number` its type has always claimed.
//
// This stays even if the backend is later taught to send numbers (see the
// FloatField note in the accompanying report). It is the client's guarantee,
// not a workaround for one serializer: phones run old builds against new
// servers and new builds against old ones, and both have to survive.
//
// Two different questions, deliberately kept apart:
//   * this module — is the value a *real coordinate*? (±90 / ±180)
//   * `isDrawable` in map.tsx — can Google's Mercator projection *place* it?
//     (±85). A story at 87°N is a real place the map still cannot draw, so both
//     gates apply and neither replaces the other.

/** Latitude bounds. Beyond these the value is not a position on Earth. */
const LAT_MIN = -90;
const LAT_MAX = 90;
/** Longitude bounds, inclusive — ±180 is the antimeridian, a real meridian. */
const LON_MIN = -180;
const LON_MAX = 180;

/**
 * A finite number, or null for anything that cannot honestly become one.
 *
 * Note what is *not* used here: bare `Number(value)`, which answers 1 for
 * `true`, 0 for `null`, 0 for `''` and 0 for `[]` — four different ways to
 * invent a coordinate off the coast of Ghana. Only numbers and non-blank
 * numeric strings are accepted; every other type is rejected outright.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    // A blank or whitespace-only string is `Number('') === 0`. Reject before
    // coercing rather than after.
    if (value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  // booleans, null, undefined, objects, arrays, symbols, bigints.
  return null;
}

/** A finite number inside `[min, max]`, or null. */
function inRange(value: unknown, min: number, max: number): number | null {
  const n = toFiniteNumber(value);
  if (n === null || n < min || n > max) return null;
  return n;
}

/** A usable latitude, or null. */
export function toLatitude(value: unknown): number | null {
  return inRange(value, LAT_MIN, LAT_MAX);
}

/** A usable longitude, or null. */
export function toLongitude(value: unknown): number | null {
  return inRange(value, LON_MIN, LON_MAX);
}

/** What `withNumericCoords` hands back: the row, with its coordinates typed. */
export type Placed<T> = Omit<T, 'latitude' | 'longitude'> & {
  latitude: number;
  longitude: number;
};

/**
 * A copy of `item` with numeric, in-range `latitude`/`longitude`, or null when
 * either is missing, unparseable or off the planet.
 *
 * Dropping the row is deliberate: a marker is a claim about where something is,
 * and there is no honest position to draw for a record whose coordinates did
 * not survive the trip. Falling back to 0,0 would put it in the Gulf of Guinea
 * — a confident marker 5,000km from anything, which is worse than no marker.
 *
 * The input is never mutated; callers hold on to API responses and cached rows,
 * and a normaliser that edited them in place would be rewriting the cache.
 */
export function withNumericCoords<T extends { latitude?: unknown; longitude?: unknown }>(
  item: T,
): Placed<T> | null {
  if (!item || typeof item !== 'object') return null;
  const latitude = toLatitude(item.latitude);
  const longitude = toLongitude(item.longitude);
  if (latitude === null || longitude === null) return null;
  return { ...item, latitude, longitude };
}

/**
 * `withNumericCoords` over a list, skipping the rows it cannot place.
 *
 * Returns a new array; neither the input array nor its items are touched.
 */
export function withNumericCoordsList<T extends { latitude?: unknown; longitude?: unknown }>(
  items: readonly T[] | null | undefined,
): Placed<T>[] {
  if (!Array.isArray(items)) return [];
  const out: Placed<T>[] = [];
  for (const item of items) {
    const placed = withNumericCoords(item);
    if (placed) out.push(placed);
  }
  return out;
}
