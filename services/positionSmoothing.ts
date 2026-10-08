import { useSyncExternalStore } from 'react';

/**
 * The owner's own position, moved continuously instead of in jumps.
 *
 * ## The problem this exists for
 *
 * `hooks/useMapLocation` watches with `distanceInterval: 10`, so the OS hands
 * us a fix only once the phone has moved ten metres. Standing still that is
 * exactly right and costs nothing. In a car it is the bug: at 60 km/h a fix
 * lands roughly every six-tenths of a second and the marker is somewhere
 * completely different each time, so the dot — and, in follow mode, the entire
 * map under it — teleports along the road in discrete hops rather than
 * driving down it.
 *
 * Lowering `distanceInterval` does not fix this. It buys smaller hops at a
 * direct cost in battery, and the hops are still hops: the marker is only ever
 * drawn at positions the GPS actually reported. What is missing is the motion
 * *between* two fixes, and that is not something the OS can be asked for — it
 * has to be drawn.
 *
 * ## What it does
 *
 * Holds the last fix as a **target** and glides the displayed point toward it,
 * emitting a new position on a timer. The glide takes about as long as the gap
 * between fixes actually is (measured, not assumed), so the dot arrives at
 * each fix just as the next one lands and the movement reads as continuous.
 *
 * The displayed point therefore *trails* the truth by up to one fix interval —
 * around a second in a car. That is the trade, and it is the right way round:
 * a marker sliding a second behind reads as the vehicle it is; a marker
 * teleporting to the exact truth reads as broken. Nothing is transmitted from
 * here, so the lag is a drawing decision and never a claim about where anybody
 * is — what goes on the wire is still the raw fix, from services/location.
 *
 * ## Why it is a store and not a hook's state
 *
 * Interpolating means a new position ten-odd times a second. Held in
 * `useMapLocation`, every one of those would re-render the entire map screen —
 * every marker, every overlay, the layout pass — to move one dot. Held here,
 * only what actually subscribes re-renders: the self marker, and (through a
 * plain callback, with no React involved at all) the follow camera. The raw
 * fix cadence still drives everything else, which is what keeps the expensive
 * marker layout running once per fix rather than once per frame.
 *
 * Same shape as services/ownMotion, and for the same reason.
 */

export interface SmoothPoint {
  latitude: number;
  longitude: number;
}

/**
 * How often a new interpolated position is emitted, in ms.
 *
 * ~15 per second. Chosen from what the eye actually needs rather than from the
 * display's refresh rate: at street zoom a 10 m hop is roughly 20 px, so
 * splitting it fifteen ways puts each step comfortably under 2 px, which is
 * below the threshold where stepping is visible. Going to 60 Hz would be four
 * times the work to move the dot by a quarter of a pixel more smoothly.
 */
const FRAME_MS = 66;

/**
 * Bounds on how long one glide may take, in ms.
 *
 * The duration is normally the measured gap between the last two fixes, so the
 * dot is still moving when the next one arrives. The clamps catch the two ends
 * where that measurement stops meaning anything: a burst of fixes arriving
 * together (glide too short to see, so it may as well snap), and a long gap
 * because the user stopped walking (a 30-second glide would have the dot
 * creeping along the road minutes after they parked).
 */
const MIN_GLIDE_MS = 120;
const MAX_GLIDE_MS = 2_500;

/** Assumed gap before two fixes have been seen — one `watchPositionAsync`
 *  interval at walking pace, near enough for the first glide. */
const DEFAULT_CADENCE_MS = 1_000;

/**
 * Past this many metres, jump rather than glide.
 *
 * A gap this size is not travel, it is the GPS finding itself again: a first
 * lock, a fix after a tunnel, or the app coming back from a background spell
 * during which the phone genuinely moved across a city. Animating those would
 * send the marker sliding across the map — and, in follow mode, take the
 * camera with it — narrating a journey that did not happen at that speed.
 */
const TELEPORT_M = 400;

/** Below this, the glide is over. Roughly a centimetre of latitude: far below
 *  what any zoom can draw, so continuing to tick would be work nobody sees. */
const ARRIVED_DEG = 1e-7;

interface Glide {
  from: SmoothPoint;
  to: SmoothPoint;
  startedAt: number;
  durationMs: number;
}

let shown: SmoothPoint | null = null;
let glide: Glide | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let lastFixAt: number | null = null;
let lastSampleAt: number | null = null;
let cadenceMs = DEFAULT_CADENCE_MS;
/** Set by the map from the OS accessibility flag. When on, every fix snaps —
 *  Reduce Motion means "do not animate", and this is animation. */
let reduceMotion = false;
let active = true;

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

/** Metres between two points, near enough for a threshold test. Equirectangular
 *  rather than haversine on purpose: this is only ever asked about distances of
 *  a few hundred metres, where the two agree to well under a metre, and it is
 *  called on every fix. `services/directions` has the exact one. */
function roughMeters(a: SmoothPoint, b: SmoothPoint): number {
  const dLat = (b.latitude - a.latitude) * 111_320;
  const dLon =
    longitudeDelta(a.longitude, b.longitude) * 111_320
    * Math.cos(((a.latitude + b.latitude) * Math.PI) / 360);
  return Math.hypot(dLat, dLon);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Cross the date line by the short path, not through Greenwich. */
function longitudeDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function wrapLongitude(value: number): number {
  return ((value + 540) % 360) - 180;
}

function samePoint(a: SmoothPoint, b: SmoothPoint): boolean {
  return Math.abs(a.latitude - b.latitude) < ARRIVED_DEG
    && Math.abs(longitudeDelta(a.longitude, b.longitude)) < ARRIVED_DEG;
}

function publish(point: SmoothPoint): void {
  if (shown && shown.latitude === point.latitude && shown.longitude === point.longitude) return;
  // Snapshots must not change behind useSyncExternalStore or retain a caller's
  // mutable GPS object. Coordinates are primitives, so a shallow freeze suffices.
  shown = Object.freeze({ latitude: point.latitude, longitude: point.longitude });
  emit();
}

/**
 * Advance the glide one step.
 *
 * Linear, deliberately. An eased curve would have the dot accelerate away from
 * each fix and brake into the next one — which is what easing is *for*, and it
 * is wrong here: a car between two GPS samples is going at a steady speed, and
 * easing would animate fifteen little accelerations a second that the vehicle
 * is not making. Constant velocity between fixes is both simpler and truer.
 */
function step(): void {
  if (!glide) {
    stopTimer();
    return;
  }

  // Wall time can jump when the phone synchronizes its clock. Drawing uses
  // monotonic elapsed time; GPS timestamps only order fixes and measure cadence.
  const elapsed = performance.now() - glide.startedAt;
  const t = glide.durationMs <= 0 ? 1 : Math.max(0, Math.min(1, elapsed / glide.durationMs));

  const next = {
    latitude: lerp(glide.from.latitude, glide.to.latitude, t),
    longitude: wrapLongitude(glide.from.longitude
      + longitudeDelta(glide.from.longitude, glide.to.longitude) * t),
  };

  if (t >= 1) {
    const target = glide.to;
    glide = null;
    stopTimer();
    publish(target);
    return;
  }
  publish(next);
}

function startTimer(): void {
  if (timer !== null || !active || reduceMotion || listeners.size === 0) return;
  timer = setInterval(step, FRAME_MS);
}

function stopTimer(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

/** Put the marker somewhere with no animation, and stop any glide in progress. */
function snapTo(point: SmoothPoint): void {
  glide = null;
  stopTimer();
  publish(point);
}

/**
 * Hand the smoother a fix from the location watcher.
 *
 * Called from `useMapLocation`'s single `watchPositionAsync` callback and from
 * nowhere else — the smoother has no subscription of its own, deliberately, so
 * there is still exactly one GPS consumer on this screen.
 * Returns false for invalid coordinates or a non-increasing sample timestamp;
 * callers can then keep the same rejected fix out of the raw map state too.
 */
export function pushFix(point: SmoothPoint, timestampMs?: number): boolean {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)
    || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) return false;
  if (timestampMs !== undefined && (!Number.isFinite(timestampMs) || timestampMs < 0
    || (lastSampleAt !== null && timestampMs <= lastSampleAt))) return false;
  const target = { latitude: point.latitude, longitude: point.longitude };
  const now = performance.now();

  // Measure the real cadence before anything else uses it. Two fixes are
  // needed for a gap, so the first one only starts the clock.
  if (lastFixAt !== null) {
    const gap = timestampMs !== undefined && lastSampleAt !== null
      ? timestampMs - lastSampleAt : now - lastFixAt;
    // Smoothed rather than taken raw: fixes arrive unevenly, and letting one
    // late sample set the next glide makes the dot visibly change pace.
    // A tunnel or long stop is not the cadence of the next few moving fixes.
    // Bound the input as well as the final glide so one gap cannot poison the
    // moving average for the next dozen updates.
    cadenceMs = gap > MAX_GLIDE_MS * 2 ? DEFAULT_CADENCE_MS
      : cadenceMs * 0.6 + Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, gap)) * 0.4;
  }
  lastFixAt = now;
  if (timestampMs !== undefined) lastSampleAt = timestampMs;

  // Nothing on screen yet, or motion is off: be where the fix says.
  if (!shown || reduceMotion || !active || listeners.size === 0) {
    snapTo(target);
    return true;
  }

  // Not travel — a re-lock, or a return from the background. See TELEPORT_M.
  if (roughMeters(shown, target) > TELEPORT_M) {
    snapTo(target);
    return true;
  }

  // Duplicate target fixes must not keep restarting an unfinished glide.
  if (glide && samePoint(glide.to, target)) return true;

  // Already there. Common when standing still, where the platform still
  // reports the odd fix as the estimate wobbles; re-arming a glide for it
  // would run the timer for nothing.
  if (samePoint(shown, target)) {
    // A correction back to the displayed point cancels the old destination.
    snapTo(target);
    return true;
  }

  glide = {
    // From where the dot *is*, not from the previous fix. A glide interrupted
    // half way — which is every glide, if fixes ever arrive early — has to
    // continue from the position on screen, or the marker jumps backwards to
    // pick up the new leg.
    from: shown,
    to: target,
    startedAt: now,
    durationMs: Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, cadenceMs)),
  };
  startTimer();
  return true;
}

/** Focus, foreground and permission are owned by useMapLocation. Suspending
 * drawing lands the latest known fix; resuming never replays an old journey. */
export function setSmoothingActive(next: boolean): void {
  if (active === next) return;
  active = next;
  lastFixAt = null;
  cadenceMs = DEFAULT_CADENCE_MS;
  if (!next && glide) snapTo(glide.to);
  if (!next) stopTimer();
}

/** Whether the marker should animate at all. The map mirrors the OS setting
 *  into this; see `useReduceMotion`. */
export function setSmoothingReduceMotion(off: boolean): void {
  reduceMotion = off;
  if (off && glide) snapTo(glide.to);
}

export function getSmoothedPosition(): SmoothPoint | null {
  return shown;
}

/** Start a new acquisition clock without clearing the displayed position or
 * interrupting a glide. The owner calls this on tracking restart/clock change;
 * callbacks from the previous acquisition generation must already be excluded. */
export function resetPositionSampleClock(): void {
  lastFixAt = null;
  lastSampleAt = null;
  cadenceMs = DEFAULT_CADENCE_MS;
}

export function subscribeToSmoothedPosition(listener: () => void): () => void {
  const notify = () => listener();
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
    if (listeners.size === 0 && glide) snapTo(glide.to);
    if (listeners.size === 0) stopTimer();
  };
}

/**
 * Forget everything.
 *
 * Called when the map unmounts and from sign-out. The timer in particular must
 * not outlive the screen: it is a module-level interval, so nothing else would
 * ever stop it, and it would go on emitting to a marker that no longer exists.
 */
export function resetPositionSmoothing(): void {
  stopTimer();
  const hadPosition = shown !== null;
  shown = null;
  glide = null;
  lastFixAt = null;
  lastSampleAt = null;
  cadenceMs = DEFAULT_CADENCE_MS;
  if (hadPosition) emit();
}

/** The smoothed point, for the two things that draw it. Everything else on the
 *  map should keep reading the raw fix — see the note at the top. */
export function useSmoothedPosition(): SmoothPoint | null {
  return useSyncExternalStore(subscribeToSmoothedPosition, getSmoothedPosition, () => null);
}

/** Test seam. Nothing in the app reads these. */
export const __testing = {
  FRAME_MS,
  MIN_GLIDE_MS,
  MAX_GLIDE_MS,
  TELEPORT_M,
  roughMeters,
  state: () => ({ shown, gliding: glide !== null, cadenceMs, ticking: timer !== null }),
};
