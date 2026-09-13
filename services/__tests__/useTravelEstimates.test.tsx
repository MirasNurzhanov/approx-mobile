import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as Location from 'expo-location';
import { useTravelEstimates, type TravelEstimates } from '../../hooks/useTravelEstimates';
import { check } from '../permissions';
import { fetchRoute, routingAvailable } from '../routing';
import { calibrationFor, hydrateCalibration, recordRoutedLeg } from '../travelCalibration';
import type { GeoPoint } from '../directions';
import type { RoutedLeg } from '../routing';

let mockAppState = 'active';
const mockListeners = new Set<(state: string) => void>();
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' }, Linking: { openURL: jest.fn() },
  AppState: { get currentState() { return mockAppState; }, addEventListener: (_event: string, listener: (state: string) => void) => {
    mockListeners.add(listener); return { remove: () => mockListeners.delete(listener) };
  } },
}));
jest.mock('expo-location', () => ({ Accuracy: { Balanced: 3 }, getLastKnownPositionAsync: jest.fn(), getCurrentPositionAsync: jest.fn() }));
jest.mock('../permissions', () => ({ check: jest.fn() }));
jest.mock('../routing', () => ({ fetchRoute: jest.fn(), routingAvailable: jest.fn() }));
jest.mock('../travelCalibration', () => ({ calibrationFor: jest.fn(), hydrateCalibration: jest.fn(), recordRoutedLeg: jest.fn() }));
let state: TravelEstimates;
let renderer: ReactTestRenderer | undefined;
const target = { latitude: 43.26, longitude: 76.92 };
function Harness({ active = true, online = false, destination = target }: { active?: boolean; online?: boolean; destination?: GeoPoint | null }) {
  state = useTravelEstimates(destination, active, online);
  return null;
}
function fix(changes: Partial<Location.LocationObject> = {}): Location.LocationObject {
  return { timestamp: Date.now(), coords: { latitude: 43.25, longitude: 76.92, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, ...changes };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockAppState = 'active';
  jest.mocked(check).mockResolvedValue({ state: 'granted' } as Awaited<ReturnType<typeof check>>);
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(fix());
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue(fix());
  jest.mocked(routingAvailable).mockImplementation((mode) => mode === 'drive');
  jest.mocked(fetchRoute).mockResolvedValue(null);
  jest.mocked(hydrateCalibration).mockResolvedValue();
  jest.mocked(calibrationFor).mockReturnValue(null);
  jest.mocked(recordRoutedLeg).mockResolvedValue(null);
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  jest.useRealTimers();
});

it('does no work while closed and shows offline estimates without disclosing endpoints', async () => {
  await act(async () => { renderer = create(<Harness active={false} />); });
  expect(check).not.toHaveBeenCalled();
  expect(hydrateCalibration).not.toHaveBeenCalled();
  await act(async () => { renderer!.update(<Harness />); });
  expect(state.status).toBe('ready');
  expect(state.estimates).toHaveLength(4);
  expect(fetchRoute).not.toHaveBeenCalled();
  expect(state.refining).toBe(false);
});

it('hydrates calibration and updates offline estimates without a routing provider', async () => {
  const hydrated = deferred<void>();
  jest.mocked(hydrateCalibration).mockReturnValue(hydrated.promise);
  jest.mocked(routingAvailable).mockReturnValue(false);
  await act(async () => { renderer = create(<Harness />); });
  expect(state.estimates![0].source).toBe('model');
  jest.mocked(calibrationFor).mockReturnValue({ detour: 1.4, mps: 10, samples: 3 });
  await act(async () => { hydrated.resolve(); });
  expect(state.estimates![0].source).toBe('calibrated');
});

it('requests only supported modes after consent and immediately hides routes when consent is withdrawn', async () => {
  await act(async () => { renderer = create(<Harness />); });
  jest.mocked(fetchRoute).mockResolvedValue({ mode: 'drive', meters: 1500, seconds: 300 });
  await act(async () => { renderer!.update(<Harness online />); });
  expect(fetchRoute).toHaveBeenCalledTimes(1);
  expect(state.estimates![0].source).toBe('routed');
  await act(async () => { renderer!.update(<Harness />); });
  expect(state.estimates![0].source).toBe('model');
});

it('ignores stale routes and stops calibration when the destination changes', async () => {
  const pending = deferred<RoutedLeg | null>();
  jest.mocked(fetchRoute).mockReturnValueOnce(pending.promise);
  await act(async () => { renderer = create(<Harness online />); });
  const oldSignal = jest.mocked(fetchRoute).mock.calls[0][3]!;
  await act(async () => { renderer!.update(<Harness online destination={{ latitude: 43.28, longitude: 76.92 }} />); });
  expect(oldSignal.aborted).toBe(true);
  await act(async () => { pending.resolve({ mode: 'drive', meters: 1500, seconds: 300 }); });
  expect(recordRoutedLeg).not.toHaveBeenCalled();
  expect(state.estimates![0].source).toBe('model');
});

it('ignores permission and GPS completions after closing and does not revive them on reopen', async () => {
  const pending = deferred<Location.LocationObject | null>();
  jest.mocked(Location.getLastKnownPositionAsync).mockReturnValueOnce(pending.promise);
  await act(async () => { renderer = create(<Harness online />); });
  await act(async () => { renderer!.update(<Harness active={false} />); });
  await act(async () => { pending.resolve(fix()); });
  expect(state.status).toBe('idle');
  expect(state.estimates).toBeNull();
  expect(fetchRoute).not.toHaveBeenCalled();
  await act(async () => { renderer!.update(<Harness />); });
  expect(check).toHaveBeenCalledTimes(2);
  expect(state.status).toBe('ready');
});

it('does not restart location work for an equivalent destination object', async () => {
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { renderer!.update(<Harness destination={{ ...target }} />); });
  expect(check).toHaveBeenCalledTimes(1);
  expect(Location.getLastKnownPositionAsync).toHaveBeenCalledTimes(1);
});

it('keeps an old completed fix hidden while reopening the same destination', async () => {
  await act(async () => { renderer = create(<Harness online />); });
  expect(state.status).toBe('ready');
  await act(async () => { renderer!.update(<Harness active={false} />); });
  const fresh = deferred<Location.LocationObject | null>();
  jest.mocked(Location.getLastKnownPositionAsync).mockReturnValueOnce(fresh.promise);
  await act(async () => { renderer!.update(<Harness online />); });
  expect(state.status).toBe('locating');
  expect(state.estimates).toBeNull();
  expect(fetchRoute).toHaveBeenCalledTimes(1);
  await act(async () => { fresh.resolve(fix()); });
  expect(state.status).toBe('ready');
  expect(fetchRoute).toHaveBeenCalledTimes(2);
});

it('does not let an old GPS result overwrite a newer destination request', async () => {
  const oldFix = deferred<Location.LocationObject | null>();
  jest.mocked(Location.getLastKnownPositionAsync).mockReturnValueOnce(oldFix.promise);
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { renderer!.update(<Harness destination={{ latitude: 43.25, longitude: 76.92 }} />); });
  expect(state.arrived).toBe(true);
  await act(async () => { oldFix.resolve(fix({ coords: { ...fix().coords, latitude: 45 } })); });
  expect(state.arrived).toBe(true);
  expect(state.status).toBe('ready');
});

it('rejects stale or inaccurate cached fixes and asks for a fresh one', async () => {
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValueOnce(fix({ timestamp: Date.now() - 600_000 }));
  await act(async () => { renderer = create(<Harness />); });
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  expect(state.status).toBe('ready');
});

it('handles permission-check failures and invalid coordinates without leaking a request', async () => {
  jest.mocked(check).mockRejectedValueOnce(new Error('permission failed'));
  await act(async () => { renderer = create(<Harness online />); });
  expect(state.status).toBe('unavailable');
  expect(fetchRoute).not.toHaveBeenCalled();
  await act(async () => { renderer!.update(<Harness online destination={{ latitude: 91, longitude: 2 }} />); });
  expect(state.status).toBe('unavailable');
  expect(check).toHaveBeenCalledTimes(1);
});

it('does not route an arrived trip and accounts for GPS accuracy', async () => {
  await act(async () => { renderer = create(<Harness online destination={{ latitude: 43.25, longitude: 76.92 }} />); });
  expect(state.arrived).toBe(true);
  expect(fetchRoute).not.toHaveBeenCalled();
});

it('clears routes on background and rechecks permission on foreground', async () => {
  await act(async () => { renderer = create(<Harness online />); });
  await act(async () => { mockListeners.forEach((listener) => listener('background')); });
  expect(state.status).toBe('idle');
  expect(state.estimates).toBeNull();
  jest.mocked(check).mockResolvedValueOnce({ state: 'denied' } as Awaited<ReturnType<typeof check>>);
  await act(async () => { mockListeners.forEach((listener) => listener('active')); });
  expect(state.status).toBe('denied');
  expect(fetchRoute).toHaveBeenCalledTimes(1);
});

it('times out a stuck live GPS request without remaining in locating forever', async () => {
  jest.useFakeTimers();
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValueOnce(null);
  jest.mocked(Location.getCurrentPositionAsync).mockReturnValueOnce(new Promise(() => {}));
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { jest.advanceTimersByTime(15_001); });
  expect(state.status).toBe('unavailable');
});

it('shows a fast walking response while a driving provider is still pending', async () => {
  const drive = deferred<RoutedLeg | null>();
  jest.mocked(routingAvailable).mockImplementation((mode) => mode === 'drive' || mode === 'walk');
  jest.mocked(fetchRoute).mockImplementation((_from, _to, mode) => mode === 'drive'
    ? drive.promise : Promise.resolve({ mode, meters: 1500, seconds: 1200 }));
  await act(async () => { renderer = create(<Harness online />); });
  expect(fetchRoute).toHaveBeenCalledTimes(2);
  expect(state.estimates!.find((item) => item.mode === 'walk')!.source).toBe('routed');
  expect(state.estimates!.find((item) => item.mode === 'drive')!.source).toBe('model');
  expect(state.refining).toBe(true);
  await act(async () => { drive.resolve(null); });
  expect(state.refining).toBe(false);
});

it('revalidates an old origin before routing when consent arrives later', async () => {
  const initial = fix();
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(initial);
  await act(async () => { renderer = create(<Harness />); });
  const time = jest.spyOn(Date, 'now').mockReturnValue(initial.timestamp + 180_000);
  const refreshed = deferred<Location.LocationObject>();
  jest.mocked(Location.getCurrentPositionAsync).mockReturnValueOnce(refreshed.promise);
  try {
    await act(async () => { renderer!.update(<Harness online />); });
    expect(check).toHaveBeenCalledTimes(2);
    expect(state.status).toBe('locating');
    expect(state.estimates).toBeNull();
    expect(fetchRoute).not.toHaveBeenCalled();
    await act(async () => {
      refreshed.resolve(fix({ coords: { ...initial.coords, latitude: 43.251 } }));
    });
    expect(state.status).toBe('ready');
    expect(fetchRoute).toHaveBeenCalledWith(expect.objectContaining({ latitude: 43.251 }), target, 'drive', expect.anything());
  } finally { time.mockRestore(); }
});

it('does not route if location permission was revoked while the sheet remained open', async () => {
  await act(async () => { renderer = create(<Harness />); });
  jest.mocked(check).mockResolvedValueOnce({ state: 'denied' } as Awaited<ReturnType<typeof check>>);
  await act(async () => { renderer!.update(<Harness online />); });
  expect(state.status).toBe('denied');
  expect(state.estimates).toBeNull();
  expect(fetchRoute).not.toHaveBeenCalled();
  expect(Location.getLastKnownPositionAsync).toHaveBeenCalledTimes(1);
});
