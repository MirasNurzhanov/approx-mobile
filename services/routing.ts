import type { GeoPoint, TravelMode } from './directions';

/** Optional OSRM-compatible routing, requested only after the sheet's online
 * consent. Both journey endpoints go to the configured operator. Public env
 * variables must contain no credentials; paid service keys belong on a proxy.
 *
 * An OSRM deployment has a statically prepared transport profile. Changing
 * 'driving' to 'foot' in its URL does NOT turn car data into walking data.
 * Therefore the legacy URL enables driving only. Walking and cycling require
 * explicitly configured bases backed by the appropriate routing data.
 * https://project-osrm.org/docs/v5.24.0/api/#general-options
 */
type Provider = { base: string; hostname: string; profile: string };

function provider(raw: string | undefined, profile: string): Provider | null {
  if (!raw) return null;
  // Deliberately narrower than a general URL parser: HTTPS, ASCII DNS/IP host,
  // optional port/path, no userinfo, query, fragment, whitespace or backslash.
  // RN 0.81's URL implementation is permissive, so constructor success alone
  // does not validate a base (nor reliably reject embedded credentials).
  const match = raw.trim().match(/^https:\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?(\/[^?#\s\\]*)?$/i);
  if (!match) return null;
  const hostname = match[1].toLowerCase();
  if (hostname.length > 253 || !hostname.split('.').every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  if (/^[0-9.]+$/.test(hostname) && (hostname.split('.').length !== 4
    || !hostname.split('.').every(part => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255))) return null;
  const port = match[2];
  if (port && (Number(port) < 1 || Number(port) > 65535)) return null;
  const path = (match[3] ?? '').replace(/\/+$/, '');
  return { base: `https://${hostname}${port ? `:${port}` : ''}${path}`, hostname, profile };
}

// Expo requires direct property access for build-time environment replacement.
const PROVIDERS: Partial<Record<TravelMode, Provider | null>> = {
  drive: provider(process.env.EXPO_PUBLIC_ROUTING_DRIVE_URL ?? process.env.EXPO_PUBLIC_ROUTING_URL, 'driving'),
  walk: provider(process.env.EXPO_PUBLIC_ROUTING_WALK_URL, 'foot'),
  bicycle: provider(process.env.EXPO_PUBLIC_ROUTING_BICYCLE_URL, 'bike'),
};

function providerFor(mode: TravelMode): Provider | null | undefined {
  return mode === 'drive' || mode === 'walk' || mode === 'bicycle' ? PROVIDERS[mode] : null;
}

export function routingAvailable(mode?: TravelMode): boolean {
  return mode === undefined ? Object.values(PROVIDERS).some(Boolean) : Boolean(providerFor(mode));
}

/** Hosts disclosed before online routing is enabled; no coordinates or keys. */
export function routingProviders(): { mode: TravelMode; hostname: string }[] {
  return (['drive', 'walk', 'bicycle'] as const).flatMap(mode => {
    const configured = PROVIDERS[mode];
    return configured ? [{ mode, hostname: configured.hostname }] : [];
  });
}

export interface RoutedLeg {
  readonly meters: number;
  readonly seconds: number;
  readonly mode: TravelMode;
}

const TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 64;
const MAX_IN_FLIGHT = 8;
type CacheEntry = { leg: RoutedLeg | null; createdAt: number; expiresAt: number };
type Waiter = (leg: RoutedLeg | null) => void;
type Job = {
  controller: AbortController;
  waiters: Set<Waiter>;
  finish: (leg: RoutedLeg | null, cacheResult: boolean) => void;
  done: boolean;
  result: RoutedLeg | null;
};

// Coordinate keys never go to disk or logs. One expiry timer, no polling;
// count/TTL limits apply to negative results too. Sign-out clears both maps.
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Job>();
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function expireCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now || entry.createdAt > now) cache.delete(key);
  }
}

function scheduleExpiry() {
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
  if (!cache.size) return;
  const soonest = Math.min(...Array.from(cache.values(), entry => entry.expiresAt));
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    expireCache();
    scheduleExpiry();
  }, Math.max(1, soonest - Date.now()));
}

function remember(key: string, leg: RoutedLeg | null) {
  expireCache();
  cache.delete(key);
  while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  const createdAt = Date.now();
  cache.set(key, { leg, createdAt, expiresAt: createdAt + (leg ? CACHE_TTL_MS : FAILURE_TTL_MS) });
  scheduleExpiry();
}

export function clearRouteCache(): void {
  cache.clear();
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
  for (const job of Array.from(inFlight.values())) job.finish(null, false);
}

function validPoint(point: GeoPoint): boolean {
  return !!point && typeof point.latitude === 'number' && Number.isFinite(point.latitude)
    && Math.abs(point.latitude) <= 90 && typeof point.longitude === 'number'
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}

function parseRoute(body: unknown, mode: TravelMode): RoutedLeg | null {
  if (!body || typeof body !== 'object') return null;
  const data = body as { code?: unknown; routes?: unknown };
  if (data.code !== 'Ok' || !Array.isArray(data.routes)) return null;
  const route = data.routes[0] as { distance?: unknown; duration?: unknown } | null;
  if (!route || typeof route !== 'object') return null;
  const meters = route.distance;
  const seconds = route.duration;
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0
    || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Object.freeze({ meters, seconds, mode });
}

function startJob(key: string, url: string, mode: TravelMode): Job {
  const job: Job = {
    controller: new AbortController(), waiters: new Set(), done: false,
    result: null, finish: () => {},
  };
  let timer: ReturnType<typeof setTimeout>;
  job.finish = (leg, cacheResult) => {
    if (job.done) return;
    job.done = true;
    job.result = leg;
    clearTimeout(timer);
    if (inFlight.get(key) === job) inFlight.delete(key);
    if (cacheResult) remember(key, leg);
    if (leg === null) job.controller.abort();
    for (const waiter of Array.from(job.waiters)) waiter(leg);
    job.waiters.clear();
  };
  inFlight.set(key, job);
  // Finish ourselves as well as aborting: some transports ignore cancellation.
  timer = setTimeout(() => job.finish(null, true), TIMEOUT_MS);
  void (async () => {
    try {
      const response = await fetch(url, {
        signal: job.controller.signal, credentials: 'omit', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' },
      });
      if (job.done) return;
      // Native networking may not honor redirect:'error'; never use a result
      // from a redirected destination. Operators must serve this URL directly:
      // this check cannot undo any disclosure made by a native redirect.
      if (!response.ok || response.redirected || (response.url && response.url !== url)) {
        job.finish(null, true);
        return;
      }
      const body: unknown = await response.json();
      if (!job.done) job.finish(parseRoute(body, mode), true);
    } catch {
      job.finish(null, true);
    }
  })();
  return job;
}

function subscribe(job: Job, signal?: AbortSignal): Promise<RoutedLeg | null> {
  return new Promise(resolve => {
    let settled = false;
    const finish: Waiter = leg => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      job.waiters.delete(finish);
      resolve(leg);
      // One dismissed sheet must not cancel another sheet's shared request.
      if (!job.done && job.waiters.size === 0) job.finish(null, false);
    };
    const abort = () => finish(null);
    job.waiters.add(finish);
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) finish(null);
    else if (job.done) finish(job.result);
  });
}

/** Best-effort upgrade to the offline estimate. Call only after explicit online
 * consent. Invalid inputs, unavailable modes and pre-aborted calls send nothing.
 * Exact origin/destination/mode requests share a bounded five-minute cache and
 * one in-flight request; canceled callers always settle without waiting for it.
 */
export async function fetchRoute(
  from: GeoPoint, to: GeoPoint, mode: TravelMode, signal?: AbortSignal,
): Promise<RoutedLeg | null> {
  const configured = providerFor(mode);
  if (!configured || signal?.aborted || !validPoint(from) || !validPoint(to)) return null;
  if (from.latitude === to.latitude && from.longitude === to.longitude) return null;
  const coords = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  const url = `${configured.base}/route/v1/${configured.profile}/${coords}`
    + '?overview=false&alternatives=false&steps=false&generate_hints=false&skip_waypoints=true';
  const key = `${mode}:${url}`;
  expireCache();
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.leg;
  }
  let job = inFlight.get(key);
  if (!job) {
    if (inFlight.size >= MAX_IN_FLIGHT) return null;
    job = startJob(key, url, mode);
  }
  return subscribe(job, signal);
}
