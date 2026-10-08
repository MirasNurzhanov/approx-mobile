import { api } from './api';
import type { Coordinates } from './location';
import { getCachedGhostMode } from './privacy';

// Asking "who is near me", from whichever anchor this user has.
//
// There are two, and which one applies is decided by the same setting that
// decides everything else about location here:
//
//   sharing (Live/Approximate) — the server already holds a position for us,
//     the same one other people are being shown. A plain GET; the anchor is
//     read from the row.
//
//   Paused — the server holds nothing, deliberately: choosing Paused deletes
//     the stored position and the update endpoint refuses to write a new one
//     (403). So the anchor travels with the request instead, is used to answer
//     it, and is discarded. It is never stored, never broadcast, and does not
//     make the caller visible to anybody — see proximity.views.NearbyQueryView,
//     which is where that is enforced rather than promised.
//
// The invariant this module exists to keep on the client side:
//
//     a public location update requires sharing to be on
//     a private nearby query does not, and never turns it on
//
// Nothing in here reports a location. `services/location.ts` is the only place
// that does, it is the only caller of the update endpoint, and it already
// refuses to send anything while paused.

/** Sent at full precision, and only on the private path.
 *
 * Not coarsened, because coarsening would degrade the caller's own results for
 * no privacy gain: this coordinate answers their query and is then gone.
 * Fuzzing happens where the point is stored and shown to *other* people, which
 * is a different case and the one worth blurring. */
function queryBody(coords: Coordinates) {
  return { latitude: coords.latitude, longitude: coords.longitude };
}

/**
 * Whether to ask with our own anchor instead of the stored one.
 *
 * A ghost has a position on file — it still answers their clubs and region —
 * but the server will not use it to place them or to answer them, because
 * Ghost Mode is mutual. So the private query is the path that still works, and
 * it returns nothing, which is the correct answer rather than an error.
 */
async function usesPrivateQuery(): Promise<boolean> {
  return await getCachedGhostMode();
}

/** Sharing is on, but no position has reached the server yet. */
export const LOCATION_NOT_AVAILABLE = 'location_not_available';
/** Ghost Mode is on. Not a transient state and not something to wait out. The
 *  wire value still reads `paused`; the server kept it stable for older
 *  clients that branch on the string. */
export const SHARING_PAUSED = 'location_sharing_paused';

/**
 * True when the server said it has no position for us *yet*.
 *
 * Keyed on the code the server sends, never on the 400 alone. A bare status
 * check would swallow every other 400 the endpoint can produce — a malformed
 * body, a validation error, a future condition nobody has thought of — and
 * quietly retry them through the private query, which would turn a real bug
 * into a silent one.
 *
 * Expected, and briefly, every time somebody resumes sharing: choosing Paused
 * deletes the stored position, so between switching back and the first report
 * landing there is genuinely nothing on file.
 */
export function isLocationNotAvailable(e: any): boolean {
  return e?.response?.data?.code === LOCATION_NOT_AVAILABLE;
}

/**
 * True when the server refused because the caller is off the map.
 *
 * The counterpart to the code above, and the distinction matters at the call
 * site: `location_not_available` resolves itself once a fix lands, so "try
 * again" is honest advice. This one never does — sharing is off until the user
 * turns it on — so anything that offers a retry for it is telling the user to
 * repeat something that cannot work.
 *
 * Returned by the surfaces that publish or consume a position: the map's own
 * anchored endpoints, and reacting to a story that is a pin on that map.
 *
 * Not by posting a story. That used to be refused while paused and no longer
 * is — a story is something you show your friends, and only the pin under it
 * ever depended on being visible. See stories/visibility.py on the server.
 */
export function isSharingPaused(e: any): boolean {
  return e?.response?.data?.code === SHARING_PAUSED;
}

/**
 * Everything the map draws: people, stories and club meetups.
 *
 * `coords` is only consulted on the paused path; a sharing caller is answered
 * from the position already on file. Resolves to null when paused with no fix
 * yet, since there is nothing to anchor on and a request would only 400.
 */
export async function fetchMapNearby<T>(coords: Coordinates | null): Promise<T | null> {
  if (await usesPrivateQuery()) {
    if (!coords) return null;
    const { data } = await api.post<T>('/api/map/nearby/query/', queryBody(coords));
    return data;
  }
  try {
    const { data } = await api.get<T>('/api/map/nearby/');
    return data;
  } catch (e) {
    // Resuming, and our position has not been reported yet. The private query
    // answers the same question from the fix we already have, so the map fills
    // in immediately instead of waiting out a tick. Read-only either way, and
    // the report going out alongside this will settle the stored anchor.
    if (!isLocationNotAvailable(e) || !coords) throw e;
    const { data } = await api.post<T>('/api/map/nearby/query/', queryBody(coords));
    return data;
  }
}

/** The people half on its own, for the list view. Same rules. */
export async function fetchNearbyUsers<T>(coords: Coordinates | null): Promise<T[]> {
  if (await usesPrivateQuery()) {
    if (!coords) return [];
    const { data } = await api.post<T[]>('/api/proximity/nearby/query/', queryBody(coords));
    return data;
  }
  try {
    const { data } = await api.get<T[]>('/api/proximity/nearby/');
    return data;
  } catch (e) {
    if (!isLocationNotAvailable(e) || !coords) throw e;
    const { data } = await api.post<T[]>('/api/proximity/nearby/query/', queryBody(coords));
    return data;
  }
}
