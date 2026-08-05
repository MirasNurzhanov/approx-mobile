import { useState } from 'react';

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

interface TrailState {
  /** The `users` array this snapshot was folded from. Identity comparison
   *  against the next one is what decides whether there is a new poll to
   *  process, so a plain re-render costs nothing. */
  source: TrackedUser[] | null;
  tracks: Map<number, TrackState>;
  trails: Map<number, TrailPoint[]>;
}

const EMPTY_STATE: TrailState = { source: null, tracks: new Map(), trails: new Map() };

/**
 * Fold one poll's positions into the running history.
 *
 * Deliberately pure — it copies rather than mutates. That is what lets it be
 * called during render: React may invoke a render twice in development, and a
 * version that incremented the hysteresis counters in place would count every
 * poll twice under it, making trails appear a poll early and linger a poll late.
 */
function advance(prev: TrailState, users: TrackedUser[]): TrailState {
  const tracks = new Map<number, TrackState>();
  const candidates: { id: number; distance: number; path: TrailPoint[] }[] = [];

  for (const user of users) {
    if (user.latitude == null || user.longitude == null) continue;
    const id = Number(user.id);

    const before = prev.tracks.get(id);
    const path = before ? [...before.path] : [];
    let fastRun = before?.fastRun ?? 0;
    let slowRun = before?.slowRun ?? 0;
    let showing = before?.showing ?? false;

    const point = { latitude: user.latitude, longitude: user.longitude };
    const last = path[path.length - 1];
    if (!last || movedEnough(last, point)) {
      path.push(point);
      if (path.length > TRAIL_POINTS) path.shift();
    }

    if (user.motion_class === 'fast') {
      fastRun += 1;
      slowRun = 0;
    } else {
      slowRun += 1;
      fastRun = 0;
    }

    if (!showing && fastRun >= POLLS_TO_START) showing = true;
    else if (showing && slowRun >= POLLS_TO_STOP) showing = false;

    tracks.set(id, { path, fastRun, slowRun, showing });

    // Two points is the minimum that describes a direction.
    if (showing && path.length >= 2) {
      candidates.push({ id, distance: user.distance_km ?? Infinity, path });
    }
  }

  // Anyone absent from this poll is dropped by simply not being carried over,
  // so the history cannot grow without bound across a long session.
  candidates.sort((a, b) => a.distance - b.distance);
  const trails = new Map<number, TrailPoint[]>();
  for (const c of candidates.slice(0, MAX_TRAILS)) trails.set(c.id, c.path);

  return { source: users, tracks, trails };
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
  const [state, setState] = useState<TrailState>(() => advance(EMPTY_STATE, users));

  // Folded during render rather than in an effect. The old version drew one
  // frame of stale trails on every poll — the markers had already moved to
  // their new positions while the tails were still those of the previous fetch,
  // which on a fast walker is a visible detachment.
  //
  // `users` is a memoized list, so an ordinary re-render compares equal here
  // and does no work.
  if (state.source !== users) {
    const next = advance(state, users);
    setState(next);
    return next.trails;
  }

  return state.trails;
}
