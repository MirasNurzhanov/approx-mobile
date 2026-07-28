import { useSyncExternalStore } from 'react';

import type { MotionClass } from './presence';

// The owner's own motion state.
//
// Speed comes straight from `expo-location`'s `coords.speed`, which is the
// platform's fused estimate — not a delta between successive coordinates.
// Deriving it ourselves would pick up every GPS jitter and make the state (and
// the trail it drives) strobe.
//
// This is the user's own state, computed and used entirely on device. Nothing
// here is a privacy surface: what leaves the phone is the raw speed on the
// existing location PATCH, which the server buckets and discards.

/**
 * Asymmetric thresholds, in m/s. Entering a state takes more than leaving it,
 * so somebody sitting at the boundary — stuck in traffic, waiting at lights —
 * does not flip class on every fix.
 *
 * ~8.0 m/s is 29 km/h and ~2.2 m/s is 8 km/h; the exit values sit a comfortable
 * margin below each so the band is genuinely wide rather than nominal.
 */
const ENTER_FAST = 8.0;
const EXIT_FAST = 5.5;
const ENTER_MOVING = 2.2;
const EXIT_MOVING = 1.2;

/** Consecutive qualifying fixes before the state changes. The watcher fires on
 * every 10m of movement, so this is a second or two, not a poll cycle. */
const FIXES_TO_CHANGE = 2;

let current: MotionClass = 'stationary';
let pending: MotionClass | null = null;
let pendingCount = 0;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Which class a raw speed implies, given where we already are. */
function classify(speed: number, from: MotionClass): MotionClass {
  if (from === 'fast') return speed >= EXIT_FAST ? 'fast' : speed >= EXIT_MOVING ? 'moving' : 'stationary';
  if (from === 'moving') {
    if (speed >= ENTER_FAST) return 'fast';
    return speed >= EXIT_MOVING ? 'moving' : 'stationary';
  }
  if (speed >= ENTER_FAST) return 'fast';
  return speed >= ENTER_MOVING ? 'moving' : 'stationary';
}

/**
 * Feed a fix from the location watcher. Returns the stabilised class.
 *
 * `speed` is expo-location's value: null, or -1, when the platform has no
 * estimate. That is not the same claim as "measured as zero", so it leaves the
 * state alone rather than resetting it to stationary.
 */
export function recordSpeed(speed: number | null | undefined): MotionClass {
  if (speed == null || speed < 0) return current;

  const candidate = classify(speed, current);

  if (candidate === current) {
    pending = null;
    pendingCount = 0;
    return current;
  }

  if (candidate === pending) {
    pendingCount += 1;
  } else {
    pending = candidate;
    pendingCount = 1;
  }

  if (pendingCount >= FIXES_TO_CHANGE) {
    current = candidate;
    pending = null;
    pendingCount = 0;
    emit();
  }

  return current;
}

export function getOwnMotion(): MotionClass {
  return current;
}

/** True when the user is moving fast enough that we should stop competing for
 * their attention. See `shouldQuietPrompts`. */
export function isDriving(): boolean {
  return current === 'fast';
}

/**
 * Whether ambient prompts should be held back right now.
 *
 * Someone doing 40km/h is either driving or a passenger, and we cannot tell
 * which. Notifying a driver that a stranger with shared interests is 200m away
 * is asking them to look at their phone — so the prompt is *deferred* rather
 * than dropped, and delivered when they stop. Nothing is lost; it just arrives
 * when it can be acted on.
 */
export function shouldQuietPrompts(): boolean {
  return isDriving();
}

export function resetOwnMotion(): void {
  current = 'stationary';
  pending = null;
  pendingCount = 0;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOwnMotion(): MotionClass {
  return useSyncExternalStore(subscribe, getOwnMotion);
}
