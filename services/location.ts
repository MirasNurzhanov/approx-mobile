import { api } from './api';
import { hasAcknowledgedLocationDisclosure } from './locationDisclosure';
import { getCachedGhostMode } from './privacy';
import { handleZoneMusic } from './zoneMusicAuto';

// The one place location leaves this device.
//
// Both callers (the map's tick and the background task) go through here so the
// two gates below cannot be honoured in one and forgotten in the other:
//
//   Ghost Mode        nothing is sent at all. Not "sent and hidden".
//   Not yet disclosed nothing is sent either, until the person has been shown
//                     what being on the map means. See
//                     services/locationDisclosure.ts — a client that has not
//                     shown that screen reports no position, and a row with no
//                     position is on nobody's map, which is what keeps the
//                     migration from publishing anyone unannounced.
//
// What is *not* here any more is coarsening. Coordinates used to be rounded to
// ~110m before transmission for an Approximate sharer, so full precision never
// left the phone. Friends are entitled to the precise point now, and the phone
// cannot know who is asking, so it sends the truth and the server decides per
// viewer what to show — see users.visibility.coordinates_for. That is a real
// widening of what leaves the device, and it is the price of the friends-see-
// precisely half of the model.

const COORD_DECIMALS = 6;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

function round(value: number, decimals: number): number {
  return parseFloat(value.toFixed(decimals));
}

/**
 * Coordinates at the precision this device transmits and draws.
 *
 * One precision for both, which is the simplification the relationship model
 * bought: the owner's own marker and the value on the wire are the same
 * number, so their screen cannot disagree with what the server holds.
 */
export function atSharingPrecision(coords: Coordinates): Coordinates {
  return {
    latitude: round(coords.latitude, COORD_DECIMALS),
    longitude: round(coords.longitude, COORD_DECIMALS),
  };
}

/** What we are willing to transmit, or null when we must send nothing. */
export async function prepareCoordinates(coords: Coordinates): Promise<Coordinates | null> {
  if (await getCachedGhostMode()) return null;
  if (!(await hasAcknowledgedLocationDisclosure())) return null;
  return atSharingPrecision(coords);
}

/**
 * Send a position update, honouring both gates above. Resolves to false when
 * nothing was sent.
 *
 * `speed` is the platform's own estimate in m/s, passed straight through. It
 * rides this request rather than getting one of its own, and the server buckets
 * it into a coarse class and discards the figure — no numeric speed is ever
 * stored or served. Omitted entirely when nothing is sent, along with
 * everything else.
 */
export async function reportLocation(
  coords: Coordinates,
  speed?: number | null,
  accuracy?: number | null,
  measuredAt?: number,
): Promise<boolean> {
  const payload = await prepareCoordinates(coords);
  if (!payload) return false;
  // Do not turn a cached fix into a fresh server position on every map tick.
  if (measuredAt !== undefined && (!Number.isFinite(measuredAt) ||
    Date.now() - measuredAt > 120_000 || measuredAt > Date.now() + 5_000)) return false;
  // Absent rather than null when there is no estimate: the server treats a
  // missing speed as "no new information" and leaves the previous class alone,
  // which is the honest reading of a fix that could not measure it.
  const body: Record<string, unknown> = { ...payload };
  if (measuredAt !== undefined) body.measured_at = new Date(measuredAt).toISOString();
  if (speed != null && speed >= 0) body.speed = speed;
  // How well the phone knows where it is. Unlike speed this is stored, because
  // club visibility turns on which district somebody is standing in and a fix
  // with a two-kilometre radius cannot answer that. It says nothing about
  // *where* they are.
  if (accuracy !== undefined) {
    body.accuracy = typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null;
  }
  const response = await api.patch('/api/proximity/location/', body);
  // The answer names the friend's zone track playing where we now stand, if
  // any. Played or stopped from here so the map's tick and the background task
  // both honour it. Never allowed to fail the report.
  try {
    await handleZoneMusic(response?.data?.zone_music);
  } catch {}
  return true;
}
