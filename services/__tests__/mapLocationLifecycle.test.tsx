import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';

import { useMapLocation, type MapLocation } from '../../hooks/useMapLocation';
import { resetPositionSmoothing, setSmoothingActive, setSmoothingReduceMotion } from '../positionSmoothing';
import type { PermissionState } from '../permissions';

let mockFocused = true;
let mockPermission: PermissionState = 'granted';
let mockReducedMotion = false;
const mockEnsure = jest.fn();
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('../../hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReducedMotion, announce: jest.fn(),
}));
jest.mock('../permissions', () => ({
  usePermissionStore: () => ({ location: { state: mockPermission } }),
  check: jest.fn(() => Promise.resolve({ state: mockPermission })),
  refreshPermissions: jest.fn(() => Promise.resolve()),
  bindForegroundRefresh: () => jest.fn(),
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 }, getCurrentPositionAsync: jest.fn(), watchPositionAsync: jest.fn(),
}));
jest.mock('../backgroundLocation', () => ({ startBackgroundLocationUpdates: jest.fn(() => Promise.resolve()) }));
jest.mock('../location', () => ({ atSharingPrecision: (point: unknown) => point }));
jest.mock('../ownMotion', () => ({ recordSpeed: jest.fn() }));

const read = Location.getCurrentPositionAsync as jest.Mock;
const watch = Location.watchPositionAsync as jest.Mock;
const nativeMap = { animateToRegion: jest.fn(), setCamera: jest.fn() };
const T0 = Date.UTC(2026, 8, 10, 10);
const origin = { latitude: 43.238949, longitude: 76.889709 };
let subscriptions: { remove: jest.Mock }[];
let tree: ReactTestRenderer | undefined;
let latest: MapLocation;
let renders: number;

function fix(timestamp = T0, north = 0): Location.LocationObject {
  return {
    timestamp, coords: {
      latitude: origin.latitude + north / 111320, longitude: origin.longitude,
      accuracy: 5, altitude: null, altitudeAccuracy: null, heading: -1, speed: 2,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function Harness() {
  latest = useMapLocation(mockEnsure);
  const { mapRef } = latest;
  useEffect(() => { mapRef.current = nativeMap as never; }, [mapRef]);
  renders += 1;
  return null;
}
async function render() {
  await act(async () => { tree = create(<Harness />); });
}
async function rerender() {
  await act(async () => { tree!.update(<Harness />); });
}
function watched(index = watch.mock.calls.length - 1): (value: Location.LocationObject) => void {
  return watch.mock.calls[index][1];
}
async function appState(next: AppStateStatus) {
  AppState.currentState = next;
  await act(async () => {
    for (const [event, listener] of (AppState.addEventListener as jest.Mock).mock.calls) {
      if (event === 'change') listener(next);
    }
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
  mockFocused = true;
  mockPermission = 'granted';
  mockReducedMotion = false;
  mockEnsure.mockReset().mockResolvedValue(true);
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  nativeMap.animateToRegion.mockClear();
  nativeMap.setCamera.mockClear();
  subscriptions = [];
  renders = 0;
  read.mockReset().mockResolvedValue(fix());
  watch.mockReset().mockImplementation(() => {
    const subscription = { remove: jest.fn() };
    subscriptions.push(subscription);
    return Promise.resolve(subscription);
  });
  setSmoothingActive(true);
  setSmoothingReduceMotion(false);
  resetPositionSmoothing();
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  resetPositionSmoothing();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('starts one watcher without waiting for the initial read and ignores the older read result', async () => {
  const initial = deferred<Location.LocationObject>();
  read.mockReturnValueOnce(initial.promise);
  await render();
  expect(watch).toHaveBeenCalledTimes(1);
  act(() => { watched()(fix(T0 + 1000, 20)); });
  const newest = latest.coords;
  await act(async () => { initial.resolve(fix()); });
  expect(latest.coords).toBe(newest);
  await rerender();
  expect(watch).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
  act(() => { watched()({ ...fix(T0 + 3000), coords: { ...fix().coords, latitude: NaN } }); });
  expect(latest.coords).toBe(newest);
});

it('keeps accuracy with the accepted fix, ignores stale accuracy, and clears unknown estimates', async () => {
  await render();
  expect(latest.accuracyRef.current).toBe(5);
  act(() => { watched()({ ...fix(T0 + 1000), coords: { ...fix().coords, accuracy: 23 } }); });
  expect(latest.accuracyRef.current).toBe(23);
  act(() => { watched()({ ...fix(T0), coords: { ...fix().coords, accuracy: 1 } }); });
  expect(latest.accuracyRef.current).toBe(23);
  act(() => { watched()({ ...fix(T0 + 2000), coords: { ...fix().coords, accuracy: null } }); });
  expect(latest.accuracyRef.current).toBeNull();
  mockPermission = 'denied';
  await rerender();
  expect(latest.accuracyRef.current).toBeNull();
});

it('removes a watcher whose asynchronous creation finishes after unmount', async () => {
  const creating = deferred<Location.LocationSubscription>();
  const subscription = { remove: jest.fn() };
  watch.mockReturnValueOnce(creating.promise);
  await render();
  act(() => { tree!.unmount(); });
  tree = undefined;
  await act(async () => { creating.resolve(subscription); });
  expect(subscription.remove).toHaveBeenCalledTimes(1);
});

it.each([-3600000, 3600000])('accepts fresh fixes after a %s ms clock change while backgrounded', async correction => {
  await render();
  const oldWatch = watched();
  await appState('background');
  jest.setSystemTime(T0 + correction);
  read.mockResolvedValueOnce(fix(Date.now(), 40));
  await appState('active');
  expect(latest.coords?.latitude).toBe(fix(Date.now(), 40).coords.latitude);
  const fresh = latest.coords;
  act(() => { oldWatch(fix(T0 + 1000, 200)); });
  expect(latest.coords).toBe(fresh);
  act(() => { jest.advanceTimersByTime(1000); watched()(fix(Date.now(), 50)); });
  expect(latest.coords?.latitude).toBe(fix(Date.now(), 50).coords.latitude);
});

it.each([-3600000, 3600000])('recovers from a %s ms foreground clock change without accepting an earlier pending read', async correction => {
  const initial = deferred<Location.LocationObject>();
  read.mockReturnValueOnce(initial.promise);
  await render();
  act(() => { watched()(fix()); });
  act(() => { jest.advanceTimersByTime(1000); });
  jest.setSystemTime(T0 + 1000 + correction);
  act(() => { watched()(fix(Date.now(), 40)); });
  expect(latest.coords?.latitude).toBe(fix(Date.now(), 40).coords.latitude);
  const fresh = latest.coords;
  // Even a pending one-shot stamped in the new clock domain cannot overwrite
  // a fix accepted since that request's acquisition generation changed.
  await act(async () => { initial.resolve(fix(Date.now() + 1000, 200)); });
  expect(latest.coords).toBe(fresh);
  act(() => { watched()(fix(T0 + 2000, 200)); });
  expect(latest.coords).toBe(fresh);
  act(() => { jest.advanceTimersByTime(1000); watched()(fix(Date.now(), 50)); });
  expect(latest.coords?.latitude).toBe(fix(Date.now(), 50).coords.latitude);
});

it.each(['focus', 'background', 'permission'] as const)('stops on %s loss, ignores the old callback, and restarts once', async reason => {
  await render();
  const previous = watched();
  if (reason === 'focus') { mockFocused = false; await rerender(); }
  if (reason === 'background') await appState('background');
  if (reason === 'permission') { mockPermission = 'denied'; await rerender(); }
  expect(subscriptions[0].remove).toHaveBeenCalledTimes(1);
  const stoppedAt = latest.coords;
  act(() => { previous(fix(T0 + 10000, 200)); });
  expect(latest.coords).toBe(stoppedAt);
  expect(nativeMap.setCamera).not.toHaveBeenCalled();
  if (reason === 'permission') expect(latest.coords).toBeNull();
  if (reason === 'focus') { mockFocused = true; await rerender(); }
  if (reason === 'background') await appState('active');
  if (reason === 'permission') { mockPermission = 'granted'; await rerender(); }
  expect(watch).toHaveBeenCalledTimes(2);
  act(() => { watched()(fix(T0 + 12000, 30)); });
  expect(latest.coords?.latitude).toBe(fix(T0 + 12000, 30).coords.latitude);
});

it('lets the 450 ms recenter animation finish before streaming smoothed camera centers', async () => {
  await render();
  await act(async () => { await latest.handleLocatePress(); });
  expect(nativeMap.animateToRegion).toHaveBeenCalledWith(expect.objectContaining(origin), 450);
  act(() => { jest.advanceTimersByTime(200); watched()(fix(T0 + 1000, 20)); });
  act(() => { jest.advanceTimersByTime(249); });
  expect(nativeMap.setCamera).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(1); });
  expect(nativeMap.setCamera).toHaveBeenCalledTimes(1);
  expect(Object.keys(nativeMap.setCamera.mock.calls[0][0])).toEqual(['center']);
});

it.each([-3600000, 3600000])('keeps the recenter deadline at 450 ms when wall time changes by %s ms', async correction => {
  await render();
  await act(async () => { await latest.handleLocatePress(); });
  act(() => { jest.advanceTimersByTime(200); watched()(fix(T0 + 1000, 20)); });
  jest.setSystemTime(T0 + 200 + correction);
  act(() => { jest.advanceTimersByTime(249); });
  // A forward correction must not interrupt the zoom; a rollback must not
  // leave follow mode waiting an hour for the wall clock to catch up.
  expect(nativeMap.setCamera).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(1); });
  expect(nativeMap.setCamera).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(132); });
  expect(nativeMap.setCamera.mock.calls.length).toBeGreaterThan(1);
});

it('streams camera updates without rerendering the hook and a pan cancels before another frame', async () => {
  await render();
  await act(async () => { await latest.handleLocatePress(); });
  act(() => { jest.advanceTimersByTime(500); watched()(fix(T0 + 1000, 20)); });
  const beforeFrames = renders;
  act(() => { jest.advanceTimersByTime(600); });
  expect(nativeMap.setCamera.mock.calls.length).toBeGreaterThan(5);
  expect(renders).toBe(beforeFrames);
  const beforePan = nativeMap.setCamera.mock.calls.length;
  act(() => {
    latest.stopFollowing('gesture');
    // The ref must stop follow inside the gesture handler, before React has
    // committed followRequested=false and cleaned up the subscription.
    jest.advanceTimersByTime(200);
  });
  expect(nativeMap.setCamera).toHaveBeenCalledTimes(beforePan);
  expect(latest.locateState).toBe('off');
});

it('recenters without animation when Reduce Motion is enabled', async () => {
  mockReducedMotion = true;
  await render();
  await act(async () => { await latest.handleLocatePress(); });
  expect(nativeMap.animateToRegion).toHaveBeenCalledWith(expect.objectContaining(origin), 0);
  act(() => { watched()(fix(T0 + 1000, 20)); });
  expect(nativeMap.setCamera).toHaveBeenCalledWith({
    center: { latitude: fix(T0 + 1000, 20).coords.latitude, longitude: origin.longitude },
  });
});

it('clears a pending locate on backgrounding so the next foreground fix does not leave a permanent spinner', async () => {
  const initial = deferred<Location.LocationObject>();
  const locating = deferred<Location.LocationObject>();
  read.mockReturnValueOnce(initial.promise).mockReturnValueOnce(locating.promise)
    .mockResolvedValueOnce(fix(T0 + 3000, 30));
  await render();
  await act(async () => { void latest.handleLocatePress(); });
  expect(latest.locateState).toBe('locating');
  await appState('background');
  await appState('active');
  expect(latest.coords?.latitude).toBe(fix(T0 + 3000, 30).coords.latitude);
  expect(latest.locateState).toBe('off');
  await act(async () => { locating.resolve(fix(T0 + 1000, 10)); initial.resolve(fix()); });
  expect(latest.locateState).toBe('off');
  expect(nativeMap.animateToRegion).not.toHaveBeenCalled();
});

it('a pan cancels a locate still waiting for its first fix', async () => {
  const initial = deferred<Location.LocationObject>();
  const locating = deferred<Location.LocationObject>();
  read.mockReturnValueOnce(initial.promise).mockReturnValueOnce(locating.promise);
  await render();
  await act(async () => { void latest.handleLocatePress(); });
  expect(latest.locateState).toBe('locating');
  act(() => { latest.stopFollowing('gesture'); });
  await act(async () => { locating.resolve(fix(T0 + 1000, 10)); });
  expect(latest.coords).not.toBeNull();
  expect(latest.locateState).toBe('off');
  expect(nativeMap.animateToRegion).not.toHaveBeenCalled();
  expect(nativeMap.setCamera).not.toHaveBeenCalled();
});

it('re-reads a still phone\'s fix before it is too old to report, and only while the map is in front', async () => {
  // The watcher only fires on movement. Without a re-read, a fix that aged past
  // the report window while the disclosure sheet was open was never sent.
  await render();
  expect(read).toHaveBeenCalledTimes(1);
  read.mockImplementation(() => Promise.resolve(fix(Date.now())));
  await act(async () => { jest.advanceTimersByTime(45_000); });
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(read).toHaveBeenCalledTimes(2);
  expect(latest.fixTimestampRef.current).toBe(T0 + 75_000);
  await appState('background');
  const reads = read.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(300_000); });
  expect(read).toHaveBeenCalledTimes(reads);
});
