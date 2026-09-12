import type { GeoPoint, TravelMode } from '../directions';

const ALMATY = { latitude: 43.238949, longitude: 76.889709 };
const MEDEU = { latitude: 43.157, longitude: 77.057 };
const BASE = 'https://routing.example.test';
const okRoute = { code: 'Ok', routes: [{ distance: 24_500, duration: 2_100 }] };
type RoutingModule = typeof import('../routing');
const modules: RoutingModule[] = [];
const originalFetch = global.fetch;

function loadRouting(url?: string, extra: { drive?: string; walk?: string; bicycle?: string } = {}): RoutingModule {
  const settings: Record<string, string | undefined> = {
    EXPO_PUBLIC_ROUTING_URL: url,
    EXPO_PUBLIC_ROUTING_DRIVE_URL: extra.drive,
    EXPO_PUBLIC_ROUTING_WALK_URL: extra.walk,
    EXPO_PUBLIC_ROUTING_BICYCLE_URL: extra.bicycle,
  };
  let mod!: RoutingModule;
  jest.isolateModules(() => {
    const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
    try {
      for (const [key, value] of Object.entries(settings)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../routing');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  modules.push(mod);
  return mod;
}

function response(body: unknown = okRoute, extra = {}) {
  return { ok: true, status: 200, json: async () => body, ...extra };
}

function stubFetch(body: unknown = okRoute, extra = {}) {
  const spy = jest.fn(async (_url: string, _init?: RequestInit) => response(body, extra));
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

afterEach(() => {
  for (const mod of modules.splice(0)) mod.clearRouteCache();
  global.fetch = originalFetch;
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('provider configuration and disclosure', () => {
  it.each([undefined, '', '   ', 'http://routing.test', 'file:///tmp/route',
    'https://user:password@routing.test', 'https://routing.test?key=secret',
    'https://routing.test/#key', 'https://routing.test:99999',
    'https://routing.test\\@attacker.test', 'https://routing..test',
    'https://999.0.0.1', 'https://010.0.0.1',
  ])('does not send coordinates for invalid/unconfigured base %s', async url => {
    const fetchSpy = stubFetch();
    const routing = loadRouting(url);
    expect(routing.routingAvailable()).toBe(false);
    await expect(routing.fetchRoute(ALMATY, MEDEU, 'drive')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats the legacy base as driving only, not three different OSRM datasets', async () => {
    const fetchSpy = stubFetch();
    const routing = loadRouting(BASE);
    expect(routing.routingAvailable()).toBe(true);
    expect(routing.routingAvailable('drive')).toBe(true);
    expect(routing.routingAvailable('walk')).toBe(false);
    for (const mode of ['walk', 'bicycle', 'transit'] as const) {
      await expect(routing.fetchRoute(ALMATY, MEDEU, mode)).resolves.toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses explicit mode deployments and exposes only their hostnames', async () => {
    const fetchSpy = stubFetch();
    const routing = loadRouting(BASE, {
      drive: 'https://car.example.test/proxy/',
      walk: 'https://walk.example.test', bicycle: 'https://bike.example.test',
    });
    expect(routing.routingProviders()).toEqual([
      { mode: 'drive', hostname: 'car.example.test' },
      { mode: 'walk', hostname: 'walk.example.test' },
      { mode: 'bicycle', hostname: 'bike.example.test' },
    ]);
    for (const mode of ['drive', 'walk', 'bicycle'] as const) await routing.fetchRoute(ALMATY, MEDEU, mode);
    expect(fetchSpy.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining('https://car.example.test/proxy/route/v1/driving/'),
      expect.stringContaining('https://walk.example.test/route/v1/foot/'),
      expect.stringContaining('https://bike.example.test/route/v1/bike/'),
    ]);
  });

  it('does not silently fall back when an explicit driving base is invalid', () => {
    expect(loadRouting(BASE, { drive: 'http://unsafe.test' }).routingAvailable()).toBe(false);
  });

  it('does not treat an inherited object key as a configured travel mode', async () => {
    const spy = stubFetch();
    const routing = loadRouting(BASE);
    expect(routing.routingAvailable('constructor' as TravelMode)).toBe(false);
    await expect(routing.fetchRoute(ALMATY, MEDEU, 'constructor' as TravelMode)).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('uses lon,lat and requests only the route summary without account credentials', async () => {
    const fetchSpy = stubFetch();
    const result = await loadRouting(` ${BASE}/// `).fetchRoute(ALMATY, MEDEU, 'drive');
    expect(result).toEqual({ meters: 24500, seconds: 2100, mode: 'drive' });
    expect(fetchSpy.mock.calls[0][0]).toContain(`${BASE}/route/v1/driving/${ALMATY.longitude},${ALMATY.latitude};${MEDEU.longitude},${MEDEU.latitude}`);
    expect(fetchSpy.mock.calls[0][0]).toContain('overview=false&alternatives=false&steps=false&generate_hints=false&skip_waypoints=true');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    });
  });
});

describe('strict inputs and responses', () => {
  it.each([
    { latitude: NaN, longitude: 70 }, { latitude: 91, longitude: 70 },
    { latitude: 43, longitude: 181 }, { latitude: 43, longitude: Infinity },
    { latitude: '43', longitude: 70 },
  ])('rejects an invalid coordinate before sending it: %s', async point => {
    const fetchSpy = stubFetch();
    const routing = loadRouting(BASE);
    await expect(routing.fetchRoute(point as unknown as GeoPoint, MEDEU, 'drive')).resolves.toBeNull();
    await expect(routing.fetchRoute(ALMATY, point as unknown as GeoPoint, 'drive')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not route identical endpoints', async () => {
    const fetchSpy = stubFetch();
    await expect(loadRouting(BASE).fetchRoute(ALMATY, ALMATY, 'drive')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { routes: okRoute.routes }, { code: 'NoRoute', routes: [] },
    { code: 'Ok', routes: [] }, { code: 'Ok', routes: { 0: okRoute.routes[0] } },
    ...[null, true, false, '', '2100', NaN, Infinity, -1, 0].map(duration => ({
      code: 'Ok', routes: [{ distance: 24500, duration }],
    })),
    ...[null, true, '24500', NaN, Infinity, -1, 0].map(distance => ({
      code: 'Ok', routes: [{ distance, duration: 2100 }],
    })),
  ])('keeps the offline estimate for a malformed route response %#', async body => {
    stubFetch(body);
    await expect(loadRouting(BASE).fetchRoute(ALMATY, MEDEU, 'drive')).resolves.toBeNull();
  });

  it.each([{ ok: false, status: 500 }, { redirected: true }, { url: 'https://other.test/route' }])(
    'rejects failed or redirected responses: %s', async extra => {
      stubFetch(okRoute, extra);
      await expect(loadRouting(BASE).fetchRoute(ALMATY, MEDEU, 'drive')).resolves.toBeNull();
    },
  );

  it('resolves null for network and JSON failures', async () => {
    const spy = stubFetch();
    spy.mockRejectedValueOnce(new Error('offline'));
    const routing = loadRouting(BASE);
    await expect(routing.fetchRoute(ALMATY, MEDEU, 'drive')).resolves.toBeNull();
    routing.clearRouteCache();
    spy.mockResolvedValueOnce(response(null, { json: async () => { throw new SyntaxError('HTML'); } }));
    await expect(routing.fetchRoute(ALMATY, MEDEU, 'drive')).resolves.toBeNull();
  });
});

describe('cancellation, shared requests and bounded caching', () => {
  it('never sends an already-aborted request, even when a cached route exists', async () => {
    const spy = stubFetch();
    const routing = loadRouting(BASE);
    const controller = new AbortController();
    controller.abort();
    await expect(routing.fetchRoute(ALMATY, MEDEU, 'drive', controller.signal)).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
    await routing.fetchRoute(ALMATY, MEDEU, 'drive');
    await expect(routing.fetchRoute(ALMATY, MEDEU, 'drive', controller.signal)).resolves.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('shares a request but canceling one subscriber does not cancel the other', async () => {
    const network = deferred<ReturnType<typeof response>>();
    const spy = stubFetch();
    spy.mockReturnValueOnce(network.promise);
    const routing = loadRouting(BASE);
    const one = new AbortController();
    const first = routing.fetchRoute(ALMATY, MEDEU, 'drive', one.signal);
    const second = routing.fetchRoute(ALMATY, MEDEU, 'drive');
    expect(spy).toHaveBeenCalledTimes(1);
    one.abort();
    await expect(first).resolves.toBeNull();
    expect(spy.mock.calls[0][1]?.signal?.aborted).toBe(false);
    network.resolve(response());
    const result = await second;
    expect(result?.meters).toBe(24500);
    expect(await routing.fetchRoute(ALMATY, MEDEU, 'drive')).toBe(result);
    expect(Object.isFrozen(result)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('settles cancellation immediately even if fetch ignores the abort', async () => {
    const never = new Promise<ReturnType<typeof response>>(() => {});
    const spy = stubFetch();
    spy.mockReturnValueOnce(never);
    const controller = new AbortController();
    const routing = loadRouting(BASE);
    const pending = routing.fetchRoute(ALMATY, MEDEU, 'drive', controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeNull();
    expect(spy.mock.calls[0][1]?.signal?.aborted).toBe(true);
    // An intentional cancellation must not negative-cache a new sheet open.
    await expect(routing.fetchRoute(ALMATY, MEDEU, 'drive')).resolves.not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('enforces its deadline even if the network or JSON parser never settles', async () => {
    jest.useFakeTimers();
    const spy = stubFetch();
    spy.mockReturnValueOnce(new Promise(() => {}));
    const pending = loadRouting(BASE).fetchRoute(ALMATY, MEDEU, 'drive');
    jest.advanceTimersByTime(6000);
    await expect(pending).resolves.toBeNull();
    expect(spy.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('also enforces the deadline during body parsing', async () => {
    jest.useFakeTimers();
    const spy = stubFetch(null, { json: () => new Promise(() => {}) });
    const pending = loadRouting(BASE).fetchRoute(ALMATY, MEDEU, 'drive');
    await Promise.resolve();
    jest.advanceTimersByTime(6000);
    await expect(pending).resolves.toBeNull();
    expect(spy.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('expires cached routes and briefly backs off after failures', async () => {
    jest.useFakeTimers();
    const spy = stubFetch();
    const routing = loadRouting(BASE);
    const first = await routing.fetchRoute(ALMATY, MEDEU, 'drive');
    expect(await routing.fetchRoute(ALMATY, MEDEU, 'drive')).toBe(first);
    jest.advanceTimersByTime(5 * 60_000 + 1);
    spy.mockRejectedValueOnce(new Error('offline'));
    await expect(routing.fetchRoute(ALMATY, MEDEU, 'drive')).resolves.toBeNull();
    await expect(routing.fetchRoute(ALMATY, MEDEU, 'drive')).resolves.toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(15_001);
    await expect(routing.fetchRoute(ALMATY, MEDEU, 'drive')).resolves.not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('bounds the cache to 64 legs instead of retaining an unlimited trip history', async () => {
    const spy = stubFetch();
    const routing = loadRouting(BASE);
    const targets = Array.from({ length: 65 }, (_, i) => ({ latitude: 43, longitude: 76 + i / 1000 }));
    for (const target of targets) await routing.fetchRoute(ALMATY, target, 'drive');
    await routing.fetchRoute(ALMATY, targets[64], 'drive');
    expect(spy).toHaveBeenCalledTimes(65);
    await routing.fetchRoute(ALMATY, targets[0], 'drive');
    expect(spy).toHaveBeenCalledTimes(66);
  });

  it('caps concurrent network work and clears pending trips without accepting late replies', async () => {
    const old = deferred<ReturnType<typeof response>>();
    const spy = stubFetch();
    spy.mockImplementation(() => old.promise);
    const routing = loadRouting(BASE);
    const targets = Array.from({ length: 9 }, (_, i) => ({ latitude: 43, longitude: 76 + i / 1000 }));
    const pending = targets.map(target => routing.fetchRoute(ALMATY, target, 'drive'));
    expect(spy).toHaveBeenCalledTimes(8);
    await expect(pending[8]).resolves.toBeNull();
    routing.clearRouteCache();
    expect(await Promise.all(pending)).toEqual(Array(9).fill(null));
    old.resolve(response());
    await Promise.resolve();
    spy.mockResolvedValue(response({ code: 'Ok', routes: [{ distance: 30000, duration: 2500 }] }));
    const fresh = await routing.fetchRoute(ALMATY, targets[0], 'drive');
    expect(fresh?.meters).toBe(30000);
    expect(spy).toHaveBeenCalledTimes(9);
  });
});
