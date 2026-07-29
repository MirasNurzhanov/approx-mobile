import { useEffect, useRef, useState } from 'react';

import type { MotionClass } from '@/services/presence';

// Speed trails for fast-moving people on the map.
//
// The trail is built only from positions we have actually observed, in order.
// It therefore always sits *behind* the marker and never ahead of it: on a 10s
// poll the newest point is already stale, and drawing a predicted position in
// front of it would assert a precision the data does not have.
//
// The server sends a coarse class and no bearing at all. Direction comes from
// this observation history instead, which means no heading has to cross the
// wire to orient the effect.

/** Points kept per person. Four segments is enough to read as a direction
 * without the tail lagging so far back that it describes an old turn. */
const TRAIL_POINTS = 5;

/** Ignore sub-metre jitter so a parked phone does not accumulate a smudge of
 * near-identical points that renders as a stuck trail. */
const MIN_STEP_DEG = 0.00002; // ~2m

/**
 * Hysteresis. Deliberately asymmetric: slow to appear, slower to disappear.
 * Someone hovering at the speed boundary would otherwise flicker on and off
 * every poll, and a trail that blinks is worse than no trail.
 */
const POLLS_TO_START = 2;
const POLLS_TO_STOP = 3;

/** Ceiling on simultaneous trails. Each one is a handful of native polyline
 * overlays; this bounds the work no matter how busy the map gets. Nearest
 * first, since those are the ones the user is actually looking at. */
const MAX_TRAILS = 12;

export interface TrailPoint {
  latitude: number;
  longitude: number;
}

interface TrackedUser {
  id: number;
  latitude: number;
  longitude: number;
  motion_class?: MotionClass | null;
  distance_km?: number;
}

interface TrackState {
  path: TrailPoint[];
  /** Consecutive polls seen fast / not fast, for the hysteresis above. */
  fastRun: number;
  slowRun: number;
  showing: boolean;
}

function movedEnough(a: TrailPoint, b: TrailPoint): boolean {
  return (
    Math.abs(a.latitude - b.latitude) > MIN_STEP_DEG ||
    Math.abs(a.longitude - b.longitude) > MIN_STEP_DEG
  );
}

/**
 * Trail paths for the people who should currently show one, keyed by user id.
 *
 * A user with no `motion_class` in the payload never gets an entry — that key
 * is absent precisely when motion is not ours to show (stranger, blocked,
 * approximate location, paused sharing), so "absent" has to mean "no trail"
 * rather than "assume stationary".
 */
export function useMotionTrails(users: TrackedUser[]): Map<number, TrailPoint[]> {
  const tracks = useRef(new Map<number, TrackState>());
  const [trails, setTrails] = useState<Map<number, TrailPoint[]>>(new Map());

  useEffect(() => {
    const seen = new Set<number>();
    const next = new Map<number, TrailPoint[]>();

    const candidates: { id: number; distance: number; path: TrailPoint[] }[] = [];

    for (const user of users) {
      if (user.latitude == null || user.longitude == null) continue;
      const id = Number(user.id);
      seen.add(id);

      let track = tracks.current.get(id);
      if (!track) {
        track = { path: [], fastRun: 0, slowRun: 0, showing: false };
        tracks.current.set(id, track);
      }

      const point = { latitude: user.latitude, longitude: user.longitude };
      const last = track.path[track.path.length - 1];
      if (!last || movedEnough(last, point)) {
        track.path.push(point);
        if (track.path.length > TRAIL_POINTS) track.path.shift();
      }

      const fast = user.motion_class === 'fast';
      if (fast) {
        track.fastRun += 1;
        track.slowRun = 0;
      } else {
        track.slowRun += 1;
        track.fastRun = 0;
      }

      if (!track.showing && track.fastRun >= POLLS_TO_START) track.showing = true;
      else if (track.showing && track.slowRun >= POLLS_TO_STOP) track.showing = false;

      // Two points is the minimum that describes a direction.
      if (track.showing && track.path.length >= 2) {
        candidates.push({
          id,
          distance: user.distance_km ?? Infinity,
          path: [...track.path],
        });
      }
    }

    // Drop anyone who left the map, so the history does not grow without bound
    // across a long session.
    for (const id of tracks.current.keys()) {
      if (!seen.has(id)) tracks.current.delete(id);
    }

    candidates.sort((a, b) => a.distance - b.distance);
    for (const c of candidates.slice(0, MAX_TRAILS)) next.set(c.id, c.path);

    setTrails(next);
  }, [users]);

  return trails;
}
