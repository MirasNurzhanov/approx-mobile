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

/** A finite number, or null for anything that cannot honestly become one. */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Return `item` with numeric `latitude`/`longitude`, or null when either is
 * missing or unparseable.
 *
 * Dropping the row is deliberate: a marker is a claim about where something is,
 * and there is no honest position to draw for a record whose coordinates did
 * not survive the trip. Rendering it at 0,0 would put it in the Gulf of Guinea.
 */
export function withNumericCoords<T extends { latitude: unknown; longitude: unknown }>(
  item: T,
): (Omit<T, 'latitude' | 'longitude'> & { latitude: number; longitude: number }) | null {
  const latitude = toFiniteNumber(item.latitude);
  const longitude = toFiniteNumber(item.longitude);
  if (latitude === null || longitude === null) return null;
  return { ...item, latitude, longitude };
}

/** `withNumericCoords` over a list, skipping the rows it cannot place. */
export function withNumericCoordsList<T extends { latitude: unknown; longitude: unknown }>(
  items: T[] | null | undefined,
): (Omit<T, 'latitude' | 'longitude'> & { latitude: number; longitude: number })[] {
  if (!items) return [];
  const out: (Omit<T, 'latitude' | 'longitude'> & { latitude: number; longitude: number })[] = [];
  for (const item of items) {
    const fixed = withNumericCoords(item);
    if (fixed) out.push(fixed);
  }
  return out;
}
