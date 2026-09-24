import type { Region } from 'react-native-maps';
import { isDrawable, type GeoPoint } from './markerLayout';

/**
 * Which venue, if any, the place picker's cursor is sitting on.
 *
 * The picker is a fixed cursor over a moving map. When a venue slides under it
 * the cursor becomes that venue; slide off, or cancel, and it is a cursor
 * again. Two radii, not one: the cursor has to come within SNAP_ENTER of a
 * venue to take it, but only lets go past SNAP_LEAVE. With a single edge a
 * finger resting on the boundary would flicker between the two states.
 *
 * Distances are in screen points, not metres, so "on the venue" means the same
 * thing at every zoom: close enough that the cursor covers the venue's disc.
 */
export const SNAP_ENTER = 26;
export const SNAP_LEAVE = 44;

export interface SnapState {
  /** The venue the cursor has become. */
  snappedId: number | null;
  /** A venue the user just cancelled. It is not offered again until the cursor
   *  has left it, or cancelling would be undone by the very next frame. */
  dismissedId: number | null;
}

export const FREE_CURSOR: SnapState = { snappedId: null, dismissedId: null };

/** Screen-point distance from the region's centre to `point`, for a map `size`
 *  points across. Linear in the deltas, which is exact enough at the street
 *  zooms a picker is used at. */
export function pointsFromCenter(point: GeoPoint, region: Region, size: { width: number; height: number }): number {
  const dx = ((point.longitude - region.longitude) / region.longitudeDelta) * size.width;
  const dy = ((point.latitude - region.latitude) / region.latitudeDelta) * size.height;
  return Math.hypot(dx, dy);
}

export function nextSnap<T extends GeoPoint & { id: number }>(
  venues: T[],
  region: Region,
  size: { width: number; height: number },
  current: SnapState,
): SnapState {
  // No layout yet, or a degenerate region: nothing can be under the cursor.
  if (!size.width || !size.height || !(region.latitudeDelta > 0) || !(region.longitudeDelta > 0)) {
    return current.snappedId === null ? current : { ...current, snappedId: null };
  }
  const drawable = venues.filter(isDrawable);
  const distanceTo = (id: number | null) => {
    const venue = id === null ? undefined : drawable.find(v => v.id === id);
    return venue ? pointsFromCenter(venue, region, size) : Infinity;
  };

  const dismissedId = distanceTo(current.dismissedId) > SNAP_LEAVE ? null : current.dismissedId;

  if (current.snappedId !== null && distanceTo(current.snappedId) <= SNAP_LEAVE) {
    return { snappedId: current.snappedId, dismissedId };
  }

  let snappedId: number | null = null;
  let best = SNAP_ENTER;
  for (const venue of drawable) {
    if (venue.id === dismissedId) continue;
    const distance = pointsFromCenter(venue, region, size);
    if (distance <= best) { best = distance; snappedId = venue.id; }
  }
  return { snappedId, dismissedId };
}

/** Cancel: back to a cursor, and keep this venue from snapping straight back. */
export function dismissSnap(current: SnapState): SnapState {
  return { snappedId: null, dismissedId: current.snappedId ?? current.dismissedId };
}
