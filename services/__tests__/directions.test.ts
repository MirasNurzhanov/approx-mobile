// Getting to a pinned place: the URL, and the guess at how long it takes.
//
// Two halves worth different kinds of test.
//
// The **URL** is the part that has to be exactly right, because it is a
// contract with somebody else's app: get a query parameter wrong and Google
// Maps silently drops the travel mode, which looks like the feature working
// while every route comes out as driving. So those tests assert on the string.
//
// The **estimate** is a model, and asserting that a 3 km drive is "540 s"
// would freeze a number that is meant to be tuned. What must not drift are the
// relationships — walking is slower than cycling, a short drive is dominated
// by parking rather than by speed, a mode stops being offered past the range
// where anybody would use it — so those are what is pinned here.

import { Linking, Platform } from 'react-native';

import {
  ARRIVED_METERS,
  TRAVEL_MODES,
  arrivalTime,
  directionsUrl,
  estimateAllModes,
  estimateTravel,
  formatDistance,
  formatDuration,
  haversineMeters,
  openDirections,
  withRoutedLeg,
  type TravelMode,
} from '../directions';

const ALMATY = { latitude: 43.238949, longitude: 76.889709 };
const DUBAI = { latitude: 25.204849, longitude: 55.270783 };

describe('haversineMeters', () => {
  it('is zero for a point and itself', () => {
    expect(haversineMeters(ALMATY, ALMATY)).toBe(0);
  });

  it('measures a degree of latitude at about 111 km', () => {
    const north = { latitude: ALMATY.latitude + 1, longitude: ALMATY.longitude };
    expect(haversineMeters(ALMATY, north)).toBeGreaterThan(110_500);
    expect(haversineMeters(ALMATY, north)).toBeLessThan(111_700);
  });

  it('agrees with the published Almaty–Dubai great circle', () => {
    // ~2,807 km. This is the case the equirectangular shortcut gets wrong,
    // which is why the real formula is in there.
    const d = haversineMeters(ALMATY, DUBAI);
    expect(d / 1000).toBeGreaterThan(2_790);
    expect(d / 1000).toBeLessThan(2_825);
  });

  it('does not blow up across the antimeridian', () => {
    const west = { latitude: 0, longitude: 179.9 };
    const east = { latitude: 0, longitude: -179.9 };
    // The short way round is ~22 km, not the ~40,000 km of going the long way.
    // A naive longitude subtraction gets this one spectacularly wrong; the
    // haversine's sin² of the half-difference does not.
    expect(haversineMeters(west, east)).toBeLessThan(25_000);
  });

  it('is symmetric', () => {
    expect(haversineMeters(ALMATY, DUBAI)).toBeCloseTo(haversineMeters(DUBAI, ALMATY), 3);
  });
});

describe('estimateTravel', () => {
  /** Seconds for one mode over a straight-line distance. */
  const secs = (meters: number, mode: TravelMode) => estimateTravel(meters, mode).seconds;

  it('orders the modes the way the world does over a city distance', () => {
    const km5 = 5_000;
    expect(secs(km5, 'drive')).toBeLessThan(secs(km5, 'bicycle'));
    expect(secs(km5, 'bicycle')).toBeLessThan(secs(km5, 'walk'));
  });

  it('lets walking beat driving over a couple of blocks', () => {
    // The point of the fixed overheads. Without them a 250 m drive comes out
    // at thirty seconds and the sheet tells people to get in the car to reach
    // the end of their street. The two converge somewhere around 400 m, which
    // is about where they converge in life.
    expect(secs(250, 'walk')).toBeLessThan(secs(250, 'drive'));
    expect(secs(3_000, 'drive')).toBeLessThan(secs(3_000, 'walk'));
  });

  it('routes further than the crow flies', () => {
    for (const mode of TRAVEL_MODES) {
      const e = estimateTravel(2_000, mode);
      expect(e.routeMeters).toBeGreaterThan(e.directMeters);
      expect(e.directMeters).toBe(2_000);
    }
  });

  it('speeds up over distance for driving but not for walking', () => {
    // Effective speed = route metres ÷ moving seconds. Driving's curve is the
    // reason a 40 km trip is not eight times a 5 km one.
    const speed = (meters: number, mode: TravelMode) => {
      const e = estimateTravel(meters, mode);
      return e.routeMeters / e.seconds;
    };
    expect(speed(40_000, 'drive')).toBeGreaterThan(speed(2_000, 'drive') * 1.5);
    expect(speed(15_000, 'walk')).toBeLessThan(speed(2_000, 'walk') * 1.2);
  });

  it('marks a mode implausible past the range anybody uses it', () => {
    expect(estimateTravel(1_000, 'walk').plausible).toBe(true);
    expect(estimateTravel(80_000, 'walk').plausible).toBe(false);
    expect(estimateTravel(80_000, 'bicycle').plausible).toBe(true);
    expect(estimateTravel(300_000, 'bicycle').plausible).toBe(false);
    // Driving stays plausible at the range a pinned meetup can realistically be.
    expect(estimateTravel(900_000, 'drive').plausible).toBe(true);
  });

  it('survives nonsense input rather than returning NaN', () => {
    for (const bad of [NaN, -5, Infinity]) {
      const e = estimateTravel(bad, 'drive');
      expect(Number.isFinite(e.seconds)).toBe(true);
      expect(Number.isFinite(e.routeMeters)).toBe(true);
    }
  });

  it('rounds to the half minute, so two modes never differ by seconds', () => {
    expect(estimateTravel(3_412, 'drive').seconds % 30).toBe(0);
  });
});

describe('the three tiers of answer', () => {
  it('says a bare estimate came from the model', () => {
    expect(estimateTravel(3_000, 'drive').source).toBe('model');
  });

  it('uses what this phone has measured, and says so', () => {
    const plain = estimateTravel(3_000, 'drive');
    // A city whose roads wander further than the constant assumes, driven
    // slower than the curve guesses. Both must show up in the answer.
    const learned = estimateTravel(3_000, 'drive', { detour: 1.9, mps: 5 });

    expect(learned.source).toBe('calibrated');
    expect(learned.routeMeters).toBeCloseTo(3_000 * 1.9, 6);
    expect(learned.seconds).toBeGreaterThan(plain.seconds);
  });

  it('replaces the model outright rather than scaling it', () => {
    // The speed curve's job is to guess how much of a trip is city driving. A
    // measured effective speed has already answered that, so applying both
    // would count the guess twice.
    const learned = estimateTravel(10_000, 'drive', { detour: 1.0, mps: 10 });
    const moving = learned.seconds - 240; // less the drive overhead
    // 10 km at 10 m/s is 1000 s, give or take the half-minute rounding every
    // estimate gets. The curve, left in, would have made this ~750.
    expect(Math.abs(moving - 1_000)).toBeLessThanOrEqual(30);
  });

  it('takes a real road leg over both, and keeps the door-to-door overhead', () => {
    const base = estimateTravel(3_000, 'drive');
    const routed = withRoutedLeg(base, { meters: 4_800, seconds: 600 });

    expect(routed.source).toBe('routed');
    expect(routed.routeMeters).toBe(4_800);
    // 600 s of road plus the 240 s of walking to the car and parking, which a
    // routing engine knows nothing about and which is most of what makes a
    // short drive not worth taking.
    expect(routed.seconds).toBe(840);
  });

  it('re-judges plausibility on the real distance, not the crow’s', () => {
    // 20 km as the crow flies is a walk the model allows; 26 km of actual
    // pavement is not.
    const base = estimateTravel(20_000, 'walk');
    expect(base.plausible).toBe(true);
    expect(withRoutedLeg(base, { meters: 26_000, seconds: 20_000 }).plausible).toBe(false);
  });

  it('ignores a nonsense leg rather than showing it', () => {
    const base = estimateTravel(3_000, 'drive');
    expect(withRoutedLeg(base, { meters: 0, seconds: 600 })).toBe(base);
    expect(withRoutedLeg(base, { meters: 4_800, seconds: 0 })).toBe(base);
  });
});

describe('estimateAllModes', () => {
  it('returns one estimate per mode, in display order', () => {
    const all = estimateAllModes(ALMATY, { latitude: 43.26, longitude: 76.92 });
    expect(all.map((e) => e.mode)).toEqual([...TRAVEL_MODES]);
  });

  it('agrees with the direct distance it was given', () => {
    const to = { latitude: 43.26, longitude: 76.92 };
    const direct = haversineMeters(ALMATY, to);
    for (const e of estimateAllModes(ALMATY, to)) {
      expect(e.directMeters).toBeCloseTo(direct, 6);
    }
  });
});

describe('formatDuration', () => {
  it.each([
    [10, 'Under a min'],
    [59, 'Under a min'],
    [90, '2 min'],
    [1_500, '25 min'],
    [3_600, '1 hr'],
    [5_400, '1 hr 30 min'],
    [90_000, '1 d 1 hr'],
  ])('%i s reads as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('never says "1 hr 0 min"', () => {
    expect(formatDuration(3_600)).not.toContain('0 min');
  });
});

describe('formatDistance', () => {
  it.each([
    [0, '10 m'],
    [140, '140 m'],
    [949, '950 m'],
    [1_000, '1.0 km'],
    [4_260, '4.3 km'],
    [42_600, '43 km'],
  ])('%i m reads as %s', (meters, expected) => {
    expect(formatDistance(meters)).toBe(expected);
  });

  it('switches to feet and miles when asked', () => {
    expect(formatDistance(100, true)).toMatch(/ft$/);
    expect(formatDistance(5_000, true)).toMatch(/mi$/);
  });

  it('does not print NaN', () => {
    expect(formatDistance(NaN)).toBe('—');
  });
});

describe('arrivalTime', () => {
  it('names a clock time for a trip that finishes today', () => {
    const now = new Date('2026-09-09T10:00:00Z');
    expect(arrivalTime(1_800, now)).toBeTruthy();
  });

  it('declines to name one for a trip over half a day', () => {
    expect(arrivalTime(13 * 3600)).toBeNull();
  });
});

describe('unusable route and calibration data', () => {
  it.each([
    { detour: NaN, mps: 5 }, { detour: 1.3, mps: 0 },
    { detour: Infinity, mps: 8 }, { detour: 1.3, mps: Infinity },
  ])('keeps the offline model for invalid learned factors %p', (learned) => {
    expect(estimateTravel(3_000, 'drive', learned)).toEqual(estimateTravel(3_000, 'drive'));
  });

  it.each([
    { meters: Infinity, seconds: 600 }, { meters: 4_000, seconds: Infinity },
    { meters: 4_000, seconds: NaN }, { meters: 100, seconds: 600 },
  ])('keeps an estimate for a corrupt or impossible route %p', (route) => {
    const base = estimateTravel(3_000, 'drive');
    expect(withRoutedLeg(base, route)).toBe(base);
  });

  it('does not label a driving-speed response as a walking route', () => {
    const walk = estimateTravel(3_000, 'walk');
    expect(withRoutedLeg(walk, { meters: 4_000, seconds: 300 })).toBe(walk);
  });

  it('does not describe unknown durations as a trip under a minute', () => {
    expect(formatDuration(Infinity)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
    expect(arrivalTime(-60)).toBeNull();
  });
});

describe('directionsUrl', () => {
  const to = { latitude: 43.238949, longitude: 76.889709 };

  it('uses Google’s versioned directions endpoint, not the search one', () => {
    // `maps?q=` — the form this replaced — cannot carry a travel mode at all.
    const url = directionsUrl(to);
    expect(url).toContain('https://www.google.com/maps/dir/?');
    expect(url).toContain('api=1');
  });

  it.each([
    ['drive', 'driving'],
    ['walk', 'walking'],
    ['bicycle', 'bicycling'],
    ['transit', 'transit'],
  ] as const)('sends %s as Google’s "%s"', (mode, expected) => {
    expect(directionsUrl(to, { mode })).toContain(`travelmode=${expected}`);
  });

  it.each([
    ['drive', 'd'],
    ['walk', 'w'],
    ['bicycle', 'b'],
    ['transit', 'r'],
  ] as const)('sends %s as Apple’s dirflg=%s', (mode, flag) => {
    const url = directionsUrl(to, { mode, app: 'apple' });
    expect(url).toContain('https://maps.apple.com/?');
    expect(url).toContain(`dirflg=${flag}`);
  });

  it('is an https link on both apps, so no native query permission is needed', () => {
    // The reason this can ship without a rebuild: an https link is routed to
    // the installed app by the OS. A `comgooglemaps://` scheme would need
    // LSApplicationQueriesSchemes on iOS and a <queries> block on Android.
    expect(directionsUrl(to)).toMatch(/^https:\/\//);
    expect(directionsUrl(to, { app: 'apple' })).toMatch(/^https:\/\//);
  });

  it('leaves the origin out unless one is given', () => {
    expect(directionsUrl(to)).not.toContain('origin=');
    expect(directionsUrl(to, { app: 'apple' })).not.toContain('saddr=');

    const from = { latitude: 43.2, longitude: 76.8 };
    expect(directionsUrl(to, { origin: from })).toContain('origin=');
    expect(directionsUrl(to, { app: 'apple', origin: from })).toContain('saddr=43.2,76.8');
  });

  it('carries the coordinate and nothing else identifying', () => {
    const url = directionsUrl(to, { mode: 'walk' });
    expect(url).toContain('43.238949');
    expect(url).toContain('76.889709');
  });
});

describe('openDirections', () => {
  const openSpy = jest.spyOn(Linking, 'openURL');

  beforeEach(() => {
    openSpy.mockReset();
    openSpy.mockResolvedValue(true);
  });

  afterAll(() => openSpy.mockRestore());

  it('still works with the three positional arguments it always took', async () => {
    await openDirections(43.1, 76.8, 'Riverside café');
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0]).toContain('travelmode=driving');
  });

  it('does not put the place name in the URL', async () => {
    // It used to, as a `q=` label. Both maps apps name the destination from
    // their own place data, and a title typed into a club chat is not
    // something to hand to a third party.
    await openDirections(43.1, 76.8, 'Aisha’s birthday, back terrace');
    expect(openSpy.mock.calls[0][0]).not.toContain('Aisha');
    expect(openSpy.mock.calls[0][0]).not.toContain('terrace');
  });

  it('passes the chosen mode through', async () => {
    await openDirections(43.1, 76.8, 'Somewhere', { mode: 'bicycle' });
    expect(openSpy.mock.calls[0][0]).toContain('travelmode=bicycling');
  });

  it('falls back to a plain pin when the directions link is refused', async () => {
    openSpy.mockRejectedValueOnce(new Error('no handler'));
    await openDirections(43.1, 76.8, 'Somewhere');
    expect(openSpy).toHaveBeenCalledTimes(2);
    expect(openSpy.mock.calls[1][0]).toContain('43.1,76.8');
  });

  it('resolves rather than throwing when nothing can open a link at all', async () => {
    openSpy.mockRejectedValue(new Error('no handler'));
    await expect(openDirections(43.1, 76.8, 'Somewhere')).resolves.toBeUndefined();
  });

  it('sends the iOS fallback to Apple Maps and the Android one to Google', async () => {
    const original = Platform.OS;
    try {
      openSpy.mockRejectedValueOnce(new Error('no handler'));
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
      await openDirections(43.1, 76.8);
      expect(openSpy.mock.calls[1][0]).toContain('maps.apple.com');

      openSpy.mockReset();
      openSpy.mockResolvedValue(true);
      openSpy.mockRejectedValueOnce(new Error('no handler'));
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      await openDirections(43.1, 76.8);
      expect(openSpy.mock.calls[1][0]).toContain('google.com/maps');
    } finally {
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }
  });
});

describe('ARRIVED_METERS', () => {
  it('is wider than a GPS fix is accurate', () => {
    // Below this the sheet says "you're here" instead of quoting a walk. Set
    // under ~30 m it would flicker between "here" and "1 min" as the fix
    // wandered; set over ~150 m it would claim arrival across a main road.
    expect(ARRIVED_METERS).toBeGreaterThanOrEqual(30);
    expect(ARRIVED_METERS).toBeLessThanOrEqual(150);
  });
});
