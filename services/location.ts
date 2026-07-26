import { api } from './api';
import { getCachedLocationSharing } from './privacy';

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

/** What we are willing to transmit, or null when sharing is paused. */
export async function prepareCoordinates(coords: Coordinates): Promise<Coordinates | null> {
  const mode = await getCachedLocationSharing();
  if (mode === 'paused') return null;

  const decimals = mode === 'approximate' ? APPROX_DECIMALS : LIVE_DECIMALS;
  return {
    latitude: round(coords.latitude, decimals),
    longitude: round(coords.longitude, decimals),
  };
}

/** Send a position update, honouring the user's sharing mode. Resolves to
 * false when nothing was sent. */
export async function reportLocation(coords: Coordinates): Promise<boolean> {
  const payload = await prepareCoordinates(coords);
  if (!payload) return false;
  await api.patch('/api/proximity/location/', payload);
  return true;
}
