import AsyncStorage from '@react-native-async-storage/async-storage';
import { __testing, calibrationFor, calibrationTable, hydrateCalibration, recordRoutedLeg, resetTravelCalibration } from '../travelCalibration';
import { modelTravelFactors } from '../directions';
import type { RoutedLeg } from '../routing';
const { KEY, VERSION, MIN_SAMPLES, MAX_AGE_MS, MAX_BUCKETS } = __testing;
const origin = { latitude: 43.25, longitude: 76.92 };
const context = { origin, directMeters: 1000 };
const options = { origin };
const leg = (mode: RoutedLeg['mode'] = 'drive', meters = 1400, seconds = 100): RoutedLeg => ({ mode, meters, seconds });
const getImplementation = jest.mocked(AsyncStorage.getItem).getMockImplementation();
const setImplementation = jest.mocked(AsyncStorage.setItem).getMockImplementation();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function learn() {
  for (let i = 0; i < MIN_SAMPLES; i += 1) await recordRoutedLeg(1000, leg(), options);
}
beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(getImplementation!);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(setImplementation!);
  await resetTravelCalibration();
  __testing.forgetMemory();
});

it('learns only after multiple provider samples and keeps modes separate', async () => {
  await recordRoutedLeg(1000, leg(), options);
  expect(calibrationFor('drive', context)).toBeNull();
  await recordRoutedLeg(1000, leg(), options);
  const result = calibrationFor('drive', context)!;
  expect(result.detour).toBeCloseTo(1.4);
  expect(result.mps).toBeCloseTo(14);
  expect(calibrationFor('walk', context)).toBeNull();
});

it('keeps relative speed corrections as baseline speed changes within the trip band', async () => {
  await learn();
  const sameRegion = { origin, directMeters: 1900 };
  const correction = 14 / modelTravelFactors(1000, 'drive').mps;
  expect(calibrationFor('drive', sameRegion)!.mps).toBeCloseTo(modelTravelFactors(1900, 'drive').mps * correction);
});

it('does not apply another city or trip-distance band calibration', async () => {
  await learn();
  expect(calibrationFor('drive', { origin: { latitude: 51.2, longitude: 71.4 }, directMeters: 1000 })).toBeNull();
  expect(calibrationFor('drive', { origin, directMeters: 20_000 })).toBeNull();
  expect(calibrationFor('drive')).toBeNull();
});

it('expires provider-derived corrections', async () => {
  await learn();
  const now = Date.now();
  const spy = jest.spyOn(Date, 'now').mockReturnValue(now + MAX_AGE_MS + 1);
  expect(calibrationFor('drive', context)).toBeNull();
  spy.mockRestore();
});

it('rejects nonfinite, zero, impossible-mode and geographically unbounded samples', async () => {
  for (const invalid of [leg('drive', NaN, 100), leg('drive', 1400, NaN), leg('drive', Infinity, 100),
    leg('drive', 1400, 0), leg('walk', 1400, 60), leg('bicycle', 1400, 30), leg('drive', 800, 100)]) {
    expect(await recordRoutedLeg(1000, invalid, options)).toBeNull();
  }
  expect(await recordRoutedLeg(100, leg(), options)).toBeNull();
  expect(await recordRoutedLeg(60_000, leg(), options)).toBeNull();
  expect(await recordRoutedLeg(1000, leg(), { origin: { latitude: 100, longitude: 5 } })).toBeNull();
  expect(calibrationTable(context)).toEqual({});
});

it('does not count a cached leg or repeated endpoint pair as independent evidence', async () => {
  const cached = leg();
  await recordRoutedLeg(1000, cached, options);
  expect(await recordRoutedLeg(1000, cached, options)).toBeNull();
  const route = { origin, destination: { latitude: 43.26, longitude: 76.92 } };
  await recordRoutedLeg(1000, leg(), route);
  expect(await recordRoutedLeg(1000, leg(), route)).toBeNull();
  expect(calibrationFor('drive', context)!.samples).toBe(2);
});

it('does not lose simultaneous mode updates or write an older snapshot last', async () => {
  await Promise.all([
    recordRoutedLeg(1000, leg(), options), recordRoutedLeg(1000, leg('walk', 1100, 800), options),
    recordRoutedLeg(1000, leg(), options),
  ]);
  expect(calibrationTable(context).drive!.samples).toBe(2);
  expect(calibrationTable(context).walk!.samples).toBe(1);
  __testing.forgetMemory();
  await hydrateCalibration();
  expect(calibrationTable(context).drive!.samples).toBe(2);
  expect(calibrationTable(context).walk!.samples).toBe(1);
});

it('stores aggregate ratios and coarse regions without precise origins or destinations', async () => {
  await recordRoutedLeg(1000, leg(), { origin, destination: { latitude: 43.26, longitude: 76.92 } });
  const data = (await AsyncStorage.getItem(KEY))!;
  expect(JSON.parse(data).version).toBe(VERSION);
  expect(data).toContain('detourRatio');
  expect(data).not.toContain('43.25');
  expect(data).not.toContain('76.92');
  expect(data).not.toContain('43.26');
});

it('hydrates once and returns defensive public copies', async () => {
  await learn();
  __testing.forgetMemory();
  jest.mocked(AsyncStorage.getItem).mockClear();
  await Promise.all([hydrateCalibration(), hydrateCalibration(), hydrateCalibration()]);
  expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
  calibrationTable(context).drive!.detour = 500;
  calibrationFor('drive', context)!.mps = 900;
  expect(calibrationFor('drive', context)!.detour).toBeCloseTo(1.4);
  expect(calibrationFor('drive', context)!.mps).toBeCloseTo(14);
});

it('discards old unscoped storage and invalid persisted numbers', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({ drive: { detour: 1.4, mps: 14, samples: 4 } }));
  await hydrateCalibration();
  expect(calibrationFor('drive', context)).toBeNull();
  __testing.forgetMemory();
  await AsyncStorage.setItem(KEY, JSON.stringify({ version: VERSION, buckets: { '266:513:local': {
    drive: { detourRatio: '1', speedRatio: 1, samples: 2, updatedAt: Date.now() },
    walk: { detourRatio: 1, speedRatio: 1, samples: 2.5, updatedAt: Date.now() },
  } } }));
  await hydrateCalibration();
  expect(calibrationTable(context)).toEqual({});
});

it('discards a late hydration after sign-out', async () => {
  await learn();
  const stored = (await AsyncStorage.getItem(KEY))!;
  __testing.forgetMemory();
  const read = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockReturnValueOnce(read.promise);
  const pending = hydrateCalibration();
  await Promise.resolve();
  await resetTravelCalibration();
  read.resolve(stored);
  await pending;
  expect(calibrationFor('drive', context)).toBeNull();
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
});

it('cannot record a prior-account sample that was waiting for hydration', async () => {
  const read = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockReturnValueOnce(read.promise);
  const pending = recordRoutedLeg(1000, leg(), options);
  await Promise.resolve();
  await resetTravelCalibration();
  read.resolve(null);
  expect(await pending).toBeNull();
  expect(calibrationTable(context)).toEqual({});
});

it('orders sign-out clearing after an already-started write', async () => {
  const write = deferred<void>();
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key, value) => {
    await write.promise;
    await setImplementation!(key, value);
  });
  const pending = recordRoutedLeg(1000, leg(), options);
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  const reset = resetTravelCalibration();
  write.resolve();
  await Promise.all([pending, reset]);
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
  expect(calibrationTable(context)).toEqual({});
});

it('rejects cancelled sample work before it changes memory or storage', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await recordRoutedLeg(1000, leg(), { origin, signal: controller.signal })).toBeNull();
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
});

it('bounds the number of stored geographic buckets', async () => {
  for (let index = 0; index < MAX_BUCKETS + 5; index += 1) {
    await recordRoutedLeg(1000, leg(), { origin: { latitude: index, longitude: 10 } });
  }
  const saved = JSON.parse((await AsyncStorage.getItem(KEY))!);
  expect(Object.keys(saved.buckets)).toHaveLength(MAX_BUCKETS);
});
