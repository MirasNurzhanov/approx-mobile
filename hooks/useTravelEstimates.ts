import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { check, type PermissionState } from '@/services/permissions';
import { ARRIVED_METERS, TRAVEL_MODES, estimateTravel, haversineMeters, withRoutedLeg,
  type GeoPoint, type TravelEstimate, type TravelMode } from '@/services/directions';
import { fetchRoute, routingAvailable, type RoutedLeg } from '@/services/routing';
import { calibrationFor, hydrateCalibration, recordRoutedLeg } from '@/services/travelCalibration';

export type OriginStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable';

export interface TravelEstimates {
  status: OriginStatus;
  /**
   * The location permission as last read, or null before it has been.
   *
   * Surfaced because `denied` alone does not say what to do about it: a state
   * that can still prompt wants an "Allow" button, and a blocked one wants the
   * Settings app. Reading it a second time in the sheet would be a second
   * source of truth for one answer.
   */
  permission: PermissionState | null;
  /** Straight-line metres to the destination, or null without an origin. */
  directMeters: number | null;
  /** One per mode in `TRAVEL_MODES` order, or null without an origin. */
  estimates: TravelEstimate[] | null;
  /** True when the destination is close enough that timing it is meaningless. */
  arrived: boolean;
  /** Ask again — for the retry after a failed fix, and after the user has been
   *  to Settings to turn location back on. */
  refresh: () => void;
  /** True while real routes are still being fetched. The numbers on screen are
   *  already usable; this only drives the quiet "refining" note. */
  refining: boolean;
}


const MAX_FIX_AGE_MS = 2 * 60 * 1000;
const MAX_FIX_ACCURACY_M = 100;
const FIX_TIMEOUT_MS = 15_000;
function validPoint(point: GeoPoint): boolean {
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}
function validFix(fix: Location.LocationObject | null): fix is Location.LocationObject {
  if (!fix || !validPoint(fix.coords)) return false;
  const age = Date.now() - fix.timestamp;
  const accuracy = fix.coords.accuracy;
  return age >= 0 && age <= MAX_FIX_AGE_MS && typeof accuracy === 'number'
    && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= MAX_FIX_ACCURACY_M;
}
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const finish = (action: () => void) => { clearTimeout(timer); signal.removeEventListener('abort', abort); action(); };
    const abort = () => finish(() => reject(new Error('Location cancelled')));
    const timer = setTimeout(() => finish(() => reject(new Error('Location timed out'))), FIX_TIMEOUT_MS);
    signal.addEventListener('abort', abort);
    if (signal.aborted) abort();
    promise.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
  });
}
type OriginResult = { status: 'ready' | 'denied' | 'unavailable'; permission: PermissionState | null; point: GeoPoint | null; accuracy: number };
type Origin = OriginResult & { key: string; signal: AbortSignal };
type Routes = { key: string; signal: AbortSignal; legs: Partial<Record<TravelMode, RoutedLeg>>; refining: boolean };

async function locateOrigin(signal: AbortSignal): Promise<OriginResult> {
  let permission: PermissionState | null = null;
  try {
    permission = (await bounded(check('location'), signal)).state;
    if (signal.aborted) throw new Error('Location cancelled');
    if (permission !== 'granted') {
      return { status: 'denied', permission, point: null, accuracy: 0 };
    }
    let fix = await bounded(Location.getLastKnownPositionAsync({ maxAge: MAX_FIX_AGE_MS, requiredAccuracy: MAX_FIX_ACCURACY_M }), signal).catch(() => null);
    if (signal.aborted) throw new Error('Location cancelled');
    if (!validFix(fix)) fix = await bounded(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), signal);
    if (!validFix(fix)) throw new Error('No usable location');
    return { status: 'ready', permission, point: { latitude: fix.coords.latitude, longitude: fix.coords.longitude }, accuracy: fix.coords.accuracy! };
  } catch {
    return { status: 'unavailable', permission, point: null, accuracy: 0 };
  }
}

/** Offline estimates are automatic. Precise endpoints are sent only after per-sheet online consent. */
export function useTravelEstimates(destination: GeoPoint | null, active: boolean, online = false): TravelEstimates {
  const [attempt, setAttempt] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [location, setLocation] = useState<Origin | null>(null);
  const [routes, setRoutes] = useState<Routes | null>(null);
  const [, setCalibrationRevision] = useState(0);
  const lat = destination?.latitude;
  const lng = destination?.longitude;
  const valid = lat !== undefined && lng !== undefined && validPoint({ latitude: lat, longitude: lng });
  const enabled = active && foreground && valid;
  // Consent can arrive minutes after opening the sheet. Recheck permission and
  // location before disclosing endpoints, and gate the previous fix immediately.
  const key = lat + ':' + lng + ':' + attempt + ':' + online;
  // Store only completed async results. Their request signal invalidates them
  // on cleanup, including closing and reopening the same destination.
  const current = enabled && location !== null && location.key === key && !location.signal.aborted;
  const status: OriginStatus = !active || !foreground ? 'idle' : !valid ? 'unavailable' : current ? location.status : 'locating';
  const origin = current && status === 'ready' ? location.point : null;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // Hydrate even with no configured provider: saved local corrections are useful offline.
    void hydrateCalibration().then(() => { if (live) setCalibrationRevision((revision) => revision + 1); }).catch(() => {});
    return () => { live = false; };
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void locateOrigin(controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setLocation({ ...result, key, signal: controller.signal });
      }
    });
    return () => controller.abort();
  }, [enabled, key]);

  const directMeters = origin && valid ? haversineMeters(origin, { latitude: lat!, longitude: lng! }) : null;
  const routeKey = key + ':' + origin?.latitude + ':' + origin?.longitude;
  const canRoute = enabled && online && origin !== null && directMeters !== null && directMeters >= ARRIVED_METERS;
  useEffect(() => {
    if (!canRoute || !origin || lat === undefined || lng === undefined || directMeters === null) return;
    const modes = TRAVEL_MODES.filter((mode) => routingAvailable(mode));
    if (modes.length === 0) return;
    const controller = new AbortController();
    const signal = controller.signal;
    const to = { latitude: lat, longitude: lng };
    const requests = modes.map((mode) => fetchRoute(origin, to, mode, signal)
      .catch(() => null)
      .then((leg) => {
        if (controller.signal.aborted || !leg || leg.mode !== mode) return;
        setRoutes((previous) => ({
          key: routeKey, signal,
          legs: { ...(previous?.signal === signal ? previous.legs : {}), [mode]: leg },
          refining: true,
        }));
        void recordRoutedLeg(directMeters, leg, { origin, destination: to, signal }).catch(() => {});
      }));
    void Promise.all(requests).finally(() => {
      if (!controller.signal.aborted) {
        setRoutes((previous) => ({
          key: routeKey, signal,
          legs: previous?.signal === signal ? previous.legs : {},
          refining: false,
        }));
      }
    });
    return () => controller.abort();
  }, [canRoute, origin, lat, lng, directMeters, routeKey]);

  const currentRoutes = canRoute && routes?.key === routeKey && !routes.signal.aborted ? routes : null;

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  const estimates = directMeters !== null && origin ? TRAVEL_MODES.map((mode) => {
    const base = estimateTravel(directMeters, mode, calibrationFor(mode, { origin, directMeters }));
    const leg = currentRoutes?.legs[mode];
    return leg ? withRoutedLeg(base, leg) : base;
  }) : null;
  return { status, permission: current ? location.permission : null, directMeters, estimates,
    arrived: directMeters !== null && directMeters + (location?.accuracy ?? 0) < ARRIVED_METERS,
    refresh, refining: canRoute && TRAVEL_MODES.some((mode) => routingAvailable(mode)) && (currentRoutes?.refining ?? true) };
}
