// The mainland-China display shift.
//
// Two properties matter more than the exact numbers, because the numbers come
// from a reconstruction of an unpublished algorithm and are only approximately
// right to begin with:
//
//   1. Outside mainland China it is exactly the identity. That is what keeps
//      this file from being able to affect anyone else.
//   2. Inside it, the shift is a few hundred metres — the right order of
//      magnitude for the offset it is correcting, and nowhere near large enough
//      to move a point into a different city.

import {
  isInMainlandChina,
  shiftForDisplay,
  wgs84ToGcj02,
  type LatLng,
} from '../gcj02';

/** Rough metres between two nearby points — good enough to size an offset. */
function metresBetween(a: LatLng, b: LatLng): number {
  const latM = (b.latitude - a.latitude) * 111_320;
  const lonM =
    (b.longitude - a.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.sqrt(latM * latM + lonM * lonM);
}

describe('isInMainlandChina', () => {
  it('is true for mainland cities', () => {
    expect(isInMainlandChina(39.9042, 116.4074)).toBe(true);  // Beijing
    expect(isInMainlandChina(31.2304, 121.4737)).toBe(true);  // Shanghai
    expect(isInMainlandChina(23.1291, 113.2644)).toBe(true);  // Guangzhou
    expect(isInMainlandChina(29.6520, 91.1721)).toBe(true);   // Lhasa
  });

  it('is false for the territories Google maps in WGS-84 anyway', () => {
    // The crude country box swallows these; shifting them would introduce
    // exactly the error this file exists to remove.
    expect(isInMainlandChina(22.3193, 114.1694)).toBe(false); // Hong Kong
    expect(isInMainlandChina(22.1987, 113.5439)).toBe(false); // Macau
    expect(isInMainlandChina(25.0330, 121.5654)).toBe(false); // Taipei
    expect(isInMainlandChina(22.6273, 120.3014)).toBe(false); // Kaohsiung
  });

  it('is false everywhere else', () => {
    expect(isInMainlandChina(43.2220, 76.8512)).toBe(false);  // Almaty
    expect(isInMainlandChina(51.5074, -0.1278)).toBe(false);  // London
    expect(isInMainlandChina(35.6762, 139.6503)).toBe(false); // Tokyo
    expect(isInMainlandChina(-17.5, 179.5)).toBe(false);      // Fiji
    expect(isInMainlandChina(0, 0)).toBe(false);
  });

  it('is false for coordinates that are not numbers', () => {
    expect(isInMainlandChina(NaN, 116)).toBe(false);
    expect(isInMainlandChina(39, Infinity)).toBe(false);
  });
});

describe('wgs84ToGcj02', () => {
  it('is exactly the identity outside mainland China', () => {
    for (const [latitude, longitude] of [
      [43.222, 76.8512],
      [51.5074, -0.1278],
      [22.3193, 114.1694], // Hong Kong
      [-17.5, 179.5],
      [0, 0],
    ]) {
      expect(wgs84ToGcj02(latitude, longitude)).toEqual({ latitude, longitude });
    }
  });

  it('shifts a mainland point by a few hundred metres', () => {
    const source = { latitude: 39.9042, longitude: 116.4074 };
    const shifted = wgs84ToGcj02(source.latitude, source.longitude);
    const distance = metresBetween(source, shifted);
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(1000);
  });

  it('shifts consistently — nearby points move by nearly the same amount', () => {
    // The offset varies smoothly with position. If it did not, a polygon would
    // come out visibly distorted rather than merely moved.
    const a = wgs84ToGcj02(39.9042, 116.4074);
    const b = wgs84ToGcj02(39.9142, 116.4174);
    const shiftA = metresBetween({ latitude: 39.9042, longitude: 116.4074 }, a);
    const shiftB = metresBetween({ latitude: 39.9142, longitude: 116.4174 }, b);
    expect(Math.abs(shiftA - shiftB)).toBeLessThan(50);
  });

  it('is deterministic', () => {
    expect(wgs84ToGcj02(31.2304, 121.4737)).toEqual(wgs84ToGcj02(31.2304, 121.4737));
  });
});

describe('shiftForDisplay', () => {
  const beijingRing: LatLng[] = [
    { latitude: 39.9, longitude: 116.3 },
    { latitude: 39.9, longitude: 116.5 },
    { latitude: 40.0, longitude: 116.5 },
    { latitude: 40.0, longitude: 116.3 },
  ];

  it('returns a shape outside China untouched, by identity', () => {
    const almaty: LatLng[] = [
      { latitude: 43.2, longitude: 76.8 },
      { latitude: 43.3, longitude: 76.9 },
    ];
    expect(shiftForDisplay(almaty)).toBe(almaty);
  });

  it('moves every point of a mainland shape', () => {
    const shifted = shiftForDisplay(beijingRing);
    expect(shifted).toHaveLength(beijingRing.length);
    shifted.forEach((point, i) => {
      expect(point.latitude).not.toBe(beijingRing[i].latitude);
      expect(metresBetween(beijingRing[i], point)).toBeGreaterThan(100);
    });
  });

  it('decides once for the whole shape rather than per point', () => {
    // A per-point test could shift half a border and leave the other half,
    // tearing the polygon in two along the boundary of the test itself.
    const straddling: LatLng[] = [
      { latitude: 22.5, longitude: 114.0 },  // inside the Hong Kong cut-out
      { latitude: 22.7, longitude: 114.0 },  // mainland Shenzhen
    ];
    const shifted = shiftForDisplay(straddling);
    expect(shifted).toBe(straddling);
  });

  it('handles an empty shape', () => {
    expect(shiftForDisplay([])).toEqual([]);
  });
});
