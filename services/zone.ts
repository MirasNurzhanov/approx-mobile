import { api } from './api';

// How far this user sees, and how to say it in a sentence.
//
// The zone is the *viewer's* reach: their circle, or the outline of the
// district or city they picked. It replaced a fixed 500m radius for stranger
// discovery, and screens that still name a fixed number are describing a rule
// the server stopped following — which is why the description lives here
// rather than being written out wherever it happens to be needed.
//
// Not to be confused with the *music* zone, which has its own radius and never
// inherits this one. See services/backgroundLocation.ts.

export interface SelfZone {
  zone_active?: boolean;
  zone_radius?: number;
  zone_mode?: 'radius' | 'region';
  zone_region_detail?: { name: string } | null;
  /** A city or district zone whose boundary has not loaded, so discovery is
   *  using the `zone_radius` circle instead. */
  zone_boundary_missing?: boolean;
  /** The place that zone covers, or should — '' when not known. */
  zone_place_name?: string;
}

/** The server's own fallback when nobody has chosen a radius. */
export const DEFAULT_ZONE_RADIUS_M = 500;

/**
 * The zone as a short noun phrase: `500 m`, `5 km`, or a place name.
 *
 * Used on its own as the Zone size row's value, and inside a sentence on the
 * nearby screen, so it stays a phrase rather than growing punctuation.
 */
export function describeZone(zone: SelfZone): string {
  if (zone.zone_mode === 'region' && zone.zone_region_detail?.name) {
    return zone.zone_region_detail.name;
  }
  const m = zone.zone_radius && zone.zone_radius > 0 ? zone.zone_radius : DEFAULT_ZONE_RADIUS_M;
  return m < 1000 ? `${m} m` : `${(m / 1000) % 1 === 0 ? m / 1000 : (m / 1000).toFixed(1)} km`;
}

/**
 * How far this viewer reaches, phrased for an empty state.
 *
 * A region zone reads "in <place>" and a circle "within <n> km", because "in
 * Almaty" and "within Almaty" are not the same claim and only one of them is
 * true of a city outline.
 */
export function describeZoneReach(zone: SelfZone | null): string {
  if (!zone) return 'nearby';
  if (zone.zone_mode === 'region' && zone.zone_region_detail?.name) {
    return `in ${zone.zone_region_detail.name}`;
  }
  return `within ${describeZone(zone)}`;
}

export type BoundaryRetryResult<T> =
  | { status: 'landed' | 'missing'; zone: T }
  | { status: 'too_soon' | 'failed' };

/**
 * Ask the server to fetch the missing city or district boundary now.
 *
 * Unlike re-reading the zone, this makes the server go to the map service. It
 * is limited server-side to one attempt every few seconds, which comes back
 * as `too_soon`.
 */
export async function retryZoneBoundary<T extends SelfZone = SelfZone>(): Promise<BoundaryRetryResult<T>> {
  try {
    const { data } = await api.post<T>('/api/users/zone/boundary/');
    return { status: data.zone_boundary_missing ? 'missing' : 'landed', zone: data };
  } catch (e: any) {
    return { status: e?.response?.status === 429 ? 'too_soon' : 'failed' };
  }
}

export async function fetchSelfZone(): Promise<SelfZone> {
  const { data } = await api.get<SelfZone>('/api/users/zone/');
  return data;
}
