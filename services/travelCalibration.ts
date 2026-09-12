import AsyncStorage from '@react-native-async-storage/async-storage';
import { modelTravelFactors, type GeoPoint, type TravelMode } from './directions';
import type { RoutedLeg } from './routing';

/** Local corrections to provider predictions, not observations of personal travel.
 * Version 2 stores only aggregate ratios in coarse 0.5-degree origin regions and
 * trip-distance bands. No precise endpoints, destination history or routes are persisted.
 * Bounds and expiry prevent one city's short driving routes becoming another city's model.
 */
export interface ModeCalibration { detour: number; mps: number; samples: number }
export type CalibrationTable = Partial<Record<TravelMode, ModeCalibration>>;
export interface CalibrationContext { origin: GeoPoint; directMeters: number }
type SampleOptions = { origin: GeoPoint; destination?: GeoPoint; signal?: AbortSignal };
type StoredRow = { detourRatio: number; speedRatio: number; samples: number; updatedAt: number };
type Bucket = Partial<Record<TravelMode, StoredRow>>;
type Buckets = Record<string, Bucket>;

const KEY = 'aura:travel:calibration';
const VERSION = 2;
const WEIGHT_NEW = 0.25;
const MIN_SAMPLES = 2;
const MIN_DETOUR = 1;
const MAX_DETOUR = 4;
const MAX_BUCKETS = 24;
const MAX_SAMPLES = 255;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_SEEN_ROUTES = 128;
const MODES: TravelMode[] = ['drive', 'walk', 'bicycle', 'transit'];
const SPEED_BOUNDS: Record<TravelMode, readonly [number, number]> = {
  drive: [0.5, 45], walk: [0.3, 3], bicycle: [1, 15], transit: [0.5, 40],
};
let buckets: Buckets | null = null;
let hydration: Promise<void> | null = null;
let epoch = 0;
let storageTail: Promise<void> = Promise.resolve();
let seenLegs = new WeakSet<object>();
let seenRoutes = new Set<string>();

function pointIsValid(point: GeoPoint): boolean {
  return Number.isFinite(point?.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point?.longitude) && Math.abs(point.longitude) <= 180;
}
function bucketKey({ origin, directMeters }: CalibrationContext): string | null {
  if (!pointIsValid(origin) || !Number.isFinite(directMeters) || directMeters < 200 || directMeters > 50_000) return null;
  const band = directMeters < 2_000 ? 'local' : directMeters < 10_000 ? 'city' : 'regional';
  const lat = Math.min(359, Math.floor((origin.latitude + 90) * 2));
  const lng = Math.min(719, Math.floor((origin.longitude + 180) * 2));
  return lat + ':' + lng + ':' + band;
}
function fresh(row: StoredRow): boolean {
  const age = Date.now() - row.updatedAt;
  return age >= 0 && age <= MAX_AGE_MS;
}
function reviveRow(raw: unknown): StoredRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as StoredRow;
  if (![row.detourRatio, row.speedRatio, row.updatedAt].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  if (row.detourRatio < 0.25 || row.detourRatio > 4 || row.speedRatio < 0.25 || row.speedRatio > 4) return null;
  if (!Number.isInteger(row.samples) || row.samples < 1 || row.samples > MAX_SAMPLES || !fresh(row)) return null;
  return { detourRatio: row.detourRatio, speedRatio: row.speedRatio, samples: row.samples, updatedAt: row.updatedAt };
}
function prune(value: Buckets): Buckets {
  return Object.fromEntries(Object.entries(value).map(([key, bucket]) => [key,
    Object.fromEntries(Object.entries(bucket).filter(([, row]) => fresh(row))),
  ] as [string, Bucket]).filter(([, bucket]) => Object.keys(bucket).length > 0)
    .sort((a, b) => Math.max(...Object.values(b[1]).map((row) => row.updatedAt))
      - Math.max(...Object.values(a[1]).map((row) => row.updatedAt))).slice(0, MAX_BUCKETS));
}
function queueStorage(action: () => Promise<void>): Promise<void> {
  const task = storageTail.then(action);
  storageTail = task.catch(() => {});
  return task;
}
export function hydrateCalibration(): Promise<void> {
  if (buckets) return Promise.resolve();
  if (hydration) return hydration;
  const currentEpoch = epoch;
  const pendingWrites = storageTail;
  const task = (async () => {
    await pendingWrites;
    let restored: Buckets = {};
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      const data = parsed as { version?: number; buckets?: Record<string, unknown> } | null;
      if (data?.version === VERSION && data.buckets && typeof data.buckets === 'object' && !Array.isArray(data.buckets)) {
        for (const [key, value] of Object.entries(data.buckets)) {
          const match = /^(\d{1,3}):(\d{1,3}):(local|city|regional)$/.exec(key);
          if (!match || Number(match[1]) > 359 || Number(match[2]) > 719 || !value || typeof value !== 'object') continue;
          const bucket: Bucket = {};
          for (const mode of MODES) {
            const row = reviveRow((value as Record<string, unknown>)[mode]);
            if (row) bucket[mode] = row;
          }
          restored[key] = bucket;
        }
      }
    } catch { restored = {}; }
    if (currentEpoch !== epoch) return;
    buckets = prune(restored);
  })();
  hydration = task;
  void task.finally(() => { if (hydration === task) hydration = null; });
  return task;
}
function evaluated(mode: TravelMode, context: CalibrationContext, row: StoredRow): ModeCalibration | null {
  const baseline = modelTravelFactors(context.directMeters, mode);
  const detour = baseline.detour * row.detourRatio;
  const mps = baseline.mps * row.speedRatio;
  const bounds = SPEED_BOUNDS[mode];
  if (!fresh(row) || !Number.isFinite(detour) || !Number.isFinite(mps)
    || detour < MIN_DETOUR || detour > MAX_DETOUR || mps < bounds[0] || mps > bounds[1]) return null;
  return { detour, mps, samples: row.samples };
}
export function calibrationFor(mode: TravelMode, context?: CalibrationContext): ModeCalibration | null {
  if (!context || !MODES.includes(mode)) return null;
  const key = bucketKey(context);
  const row = key ? buckets?.[key]?.[mode] : null;
  return row && row.samples >= MIN_SAMPLES ? evaluated(mode, context, row) : null;
}
export function calibrationTable(context?: CalibrationContext): CalibrationTable {
  if (!context) return {};
  const key = bucketKey(context);
  const bucket = key ? buckets?.[key] : null;
  const result: CalibrationTable = {};
  if (bucket) for (const mode of MODES) {
    const row = bucket[mode];
    const value = row && evaluated(mode, context, row);
    if (value) result[mode] = value;
  }
  return result;
}
export async function recordRoutedLeg(directMeters: number, leg: RoutedLeg, options?: SampleOptions): Promise<ModeCalibration | null> {
  if (!options || options.signal?.aborted || !MODES.includes(leg.mode)) return null;
  const context = { origin: options.origin, directMeters };
  const key = bucketKey(context);
  if (!key || !Number.isFinite(leg.seconds) || !Number.isFinite(leg.meters) || leg.seconds <= 0 || leg.meters <= 0) return null;
  const detour = leg.meters / directMeters;
  const mps = leg.meters / leg.seconds;
  const bounds = SPEED_BOUNDS[leg.mode];
  if (detour < MIN_DETOUR || detour > MAX_DETOUR || mps < bounds[0] || mps > bounds[1]) return null;
  const baseline = modelTravelFactors(directMeters, leg.mode);
  const detourRatio = detour / baseline.detour;
  const speedRatio = mps / baseline.mps;
  if (![detourRatio, speedRatio].every((ratio) => Number.isFinite(ratio) && ratio >= 0.25 && ratio <= 4)) return null;
  if (options.destination && !pointIsValid(options.destination)) return null;
  const sampleKey = options.destination ? [leg.mode, options.origin.latitude.toFixed(3), options.origin.longitude.toFixed(3),
    options.destination.latitude.toFixed(3), options.destination.longitude.toFixed(3)].join(':') : null;
  const currentEpoch = epoch;
  await hydrateCalibration();
  if (epoch !== currentEpoch || options.signal?.aborted || seenLegs.has(leg) || (sampleKey && seenRoutes.has(sampleKey))) return null;
  seenLegs.add(leg);
  if (sampleKey) {
    seenRoutes.add(sampleKey);
    if (seenRoutes.size > MAX_SEEN_ROUTES) seenRoutes.delete(seenRoutes.values().next().value!);
  }
  // Read current state after hydration: concurrent modes must not overwrite each other.
  const current = buckets ?? {};
  const old = current[key]?.[leg.mode];
  const previous = old && fresh(old) ? old : null;
  const row: StoredRow = {
    detourRatio: previous ? previous.detourRatio * (1 - WEIGHT_NEW) + detourRatio * WEIGHT_NEW : detourRatio,
    speedRatio: previous ? previous.speedRatio * (1 - WEIGHT_NEW) + speedRatio * WEIGHT_NEW : speedRatio,
    samples: Math.min(MAX_SAMPLES, (previous?.samples ?? 0) + 1), updatedAt: Date.now(),
  };
  buckets = prune({ ...current, [key]: { ...current[key], [leg.mode]: row } });
  const saved = JSON.stringify({ version: VERSION, buckets });
  await queueStorage(async () => { if (currentEpoch === epoch && !options.signal?.aborted) await AsyncStorage.setItem(KEY, saved); }).catch(() => {});
  return currentEpoch === epoch && !options.signal?.aborted ? evaluated(leg.mode, context, row) : null;
}
export async function resetTravelCalibration(): Promise<void> {
  epoch += 1;
  buckets = {};
  hydration = null;
  seenLegs = new WeakSet();
  seenRoutes = new Set();
  await queueStorage(async () => {
    try { await AsyncStorage.removeItem(KEY); }
    catch { await AsyncStorage.setItem(KEY, JSON.stringify({ version: VERSION, buckets: {} })); }
  });
}
export const __testing = { KEY, VERSION, WEIGHT_NEW, MIN_SAMPLES, MAX_DETOUR, MIN_DETOUR, MAX_BUCKETS, MAX_AGE_MS,
  forgetMemory: () => { epoch += 1; buckets = null; hydration = null; seenLegs = new WeakSet(); seenRoutes = new Set(); },
};
