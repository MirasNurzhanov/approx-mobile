import { api } from './api';
import { getCachedLocationSharing, type LocationSharing } from './privacy';

// The one place location leaves this device.
//
// Both callers (the map's tick and the background task) go through here so the
// user's Location sharing setting cannot be honoured in one and forgotten in
// the other.
//
// Layering, deliberately:
//   Paused       — nothing is sent at all. Not "sent and hidden".
//   Approximate  — coordinates are coarsened here, so full precision never
//                  leaves the phone, and the server then snaps them to its own
//                  ~500m grid before storing. The server does not trust this.
//   Live         — sent at the usual 6-decimal precision.

/** ~110m. Enough to stop the exact position ever being transmitted, while the
 * server's grid snap does the real fuzzing. */
const APPROX_DECIMALS = 3;
const LIVE_DECIMALS = 6;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

function round(value: number, decimals: number): number {
  return parseFloat(value.toFixed(decimals));
}

/**
 * The coordinates at the precision `mode` is willing to transmit.
 *
 * `paused` has no precision of its own because it transmits nothing:
 * `prepareCoordinates` rejects it before it ever reaches here, and the owner's
 * own map — which sends nothing either — keeps full precision so they can
 * still see themselves while invisible to everyone else.
 *
 * The owner's map draws their marker through this too, so an approximate
 * sharer is never shown a precise position we would not transmit. Otherwise
 * their own screen becomes the one place the exact value is still on display.
 */
export function atSharingPrecision(coords: Coordinates, mode: LocationSharing): Coordinates {
  const decimals = mode === 'approximate' ? APPROX_DECIMALS : LIVE_DECIMALS;
  return {
    latitude: round(coords.latitude, decimals),
    longitude: round(coords.longitude, decimals),
  };
}

/** What we are willing to transmit, or null when sharing is paused. */
export async function prepareCoordinates(coords: Coordinates): Promise<Coordinates | null> {
  const mode = await getCachedLocationSharing();
  if (mode === 'paused') return null;
  return atSharingPrecision(coords, mode);
}

/**
 * Send a position update, honouring the user's sharing mode. Resolves to false
 * when nothing was sent.
 *
 * `speed` is the platform's own estimate in m/s, passed straight through. It
 * rides this request rather than getting one of its own, and the server buckets
 * it into a coarse class and discards the figure — no numeric speed is ever
 * stored or served. Omitted entirely when paused, along with everything else.
 */
export async function reportLocation(
  coords: Coordinates,
  speed?: number | null,
): Promise<boolean> {
  const payload = await prepareCoordinates(coords);
  if (!payload) return false;
  // Absent rather than null when there is no estimate: the server treats a
  // missing speed as "no new information" and leaves the previous class alone,
  // which is the honest reading of a fix that could not measure it.
  const body = speed == null || speed < 0 ? payload : { ...payload, speed };
  await api.patch('/api/proximity/location/', body);
  return true;
}
