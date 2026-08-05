import {
  toFiniteNumber,
  toLatitude,
  toLongitude,
  withNumericCoords,
  withNumericCoordsList,
} from '../coords';

// The crash these guard against: Fabric refuses a string `coordinate` prop with
// "Value for latitude cannot be cast from String to double", and DRF sends
// story and meetup coordinates as strings. See services/coords.ts.

describe('toFiniteNumber', () => {
  it('keeps values that are already finite numbers', () => {
    expect(toFiniteNumber(43.238)).toBe(43.238);
    expect(toFiniteNumber(-76.945)).toBe(-76.945);
    expect(toFiniteNumber(0)).toBe(0);
  });

  it('converts plain numeric strings', () => {
    expect(toFiniteNumber('43')).toBe(43);
    expect(toFiniteNumber('-77')).toBe(-77);
    expect(toFiniteNumber('0')).toBe(0);
  });

  it('converts the decimal strings DRF actually sends', () => {
    // Exactly the shape in the bug report.
    expect(toFiniteNumber('43.238000')).toBe(43.238);
    expect(toFiniteNumber('76.945000')).toBe(76.945);
    expect(toFiniteNumber('-0.000001')).toBe(-0.000001);
    expect(toFiniteNumber(' 43.238 ')).toBe(43.238); // padded, still honest
  });

  it('rejects null and undefined', () => {
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
  });

  it('rejects empty and whitespace-only strings', () => {
    // Number('') and Number('   ') are both 0 — the trap this exists to avoid.
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber('   ')).toBeNull();
    expect(toFiniteNumber('\t\n')).toBeNull();
  });

  it('rejects booleans', () => {
    // Number(true) is 1, which would be a coordinate off the coast of Ghana.
    expect(toFiniteNumber(true)).toBeNull();
    expect(toFiniteNumber(false)).toBeNull();
  });

  it('rejects NaN and infinities', () => {
    expect(toFiniteNumber(NaN)).toBeNull();
    expect(toFiniteNumber(Infinity)).toBeNull();
    expect(toFiniteNumber(-Infinity)).toBeNull();
    expect(toFiniteNumber('NaN')).toBeNull();
    expect(toFiniteNumber('Infinity')).toBeNull();
    expect(toFiniteNumber('-Infinity')).toBeNull();
  });

  it('rejects non-numeric strings', () => {
    for (const value of ['abc', '43.238abc', 'null', '1,5', '--3', 'e5']) {
      expect(toFiniteNumber(value)).toBeNull();
    }
  });

  it('rejects objects and arrays', () => {
    // Number([]) is 0 and Number(['5']) is 5 — both would sneak through a
    // naive implementation.
    for (const value of [{}, [], ['5'], { latitude: 1 }, () => 5]) {
      expect(toFiniteNumber(value)).toBeNull();
    }
  });
});

describe('range validation', () => {
  it('accepts latitudes within ±90, inclusive', () => {
    expect(toLatitude(0)).toBe(0);
    expect(toLatitude(90)).toBe(90);
    expect(toLatitude(-90)).toBe(-90);
    expect(toLatitude('43.238000')).toBe(43.238);
  });

  it('rejects out-of-range latitude', () => {
    expect(toLatitude(90.0001)).toBeNull();
    expect(toLatitude(-90.0001)).toBeNull();
    expect(toLatitude(91)).toBeNull();
    expect(toLatitude(1000)).toBeNull();
    expect(toLatitude('123.456')).toBeNull();
  });

  it('accepts longitudes within ±180, inclusive', () => {
    expect(toLongitude(0)).toBe(0);
    expect(toLongitude(180)).toBe(180); // the antimeridian is a real meridian
    expect(toLongitude(-180)).toBe(-180);
    expect(toLongitude('76.945000')).toBe(76.945);
  });

  it('rejects out-of-range longitude', () => {
    expect(toLongitude(180.0001)).toBeNull();
    expect(toLongitude(-180.0001)).toBeNull();
    expect(toLongitude(181)).toBeNull();
    expect(toLongitude('360')).toBeNull();
  });
});

describe('withNumericCoords', () => {
  it('coerces both coordinates and preserves every other field', () => {
    const story = {
      id: 7,
      latitude: '43.238000',
      longitude: '76.945000',
      content: 'hi',
      author: { id: 1, username: 'nur' },
    };
    expect(withNumericCoords(story)).toEqual({
      id: 7,
      latitude: 43.238,
      longitude: 76.945,
      content: 'hi',
      author: { id: 1, username: 'nur' },
    });
  });

  it('leaves rows that are already numeric untouched in value', () => {
    const user = { id: 2, latitude: 43.238, longitude: 76.945 };
    expect(withNumericCoords(user)).toEqual(user);
  });

  it('does not mutate the original object', () => {
    const story = { id: 7, latitude: '43.238000', longitude: '76.945000' };
    const snapshot = { ...story };
    const placed = withNumericCoords(story);

    expect(story).toEqual(snapshot);
    expect(story.latitude).toBe('43.238000'); // still the string it arrived as
    expect(placed).not.toBe(story); // a copy, not the same reference
  });

  it('returns null rather than an unplaceable row', () => {
    // 0,0 would be a confident marker in the Gulf of Guinea — worse than none.
    expect(withNumericCoords({ id: 1, latitude: null, longitude: '76.9' })).toBeNull();
    expect(withNumericCoords({ id: 1, latitude: '43.2', longitude: undefined })).toBeNull();
    expect(withNumericCoords({ id: 1, latitude: '', longitude: '' })).toBeNull();
    expect(withNumericCoords({ id: 1, latitude: true, longitude: false })).toBeNull();
    expect(withNumericCoords({ id: 1, latitude: 'abc', longitude: 'def' })).toBeNull();
    expect(withNumericCoords({ id: 1, latitude: NaN, longitude: 0 })).toBeNull();
    expect(withNumericCoords({ id: 1 } as { latitude?: unknown; longitude?: unknown })).toBeNull();
  });

  it('returns null for out-of-range coordinates', () => {
    expect(withNumericCoords({ id: 1, latitude: 91, longitude: 76.9 })).toBeNull();
    expect(withNumericCoords({ id: 1, latitude: '900.5', longitude: '76.9' })).toBeNull();
    expect(withNumericCoords({ id: 1, latitude: 43.2, longitude: 181 })).toBeNull();
    expect(withNumericCoords({ id: 1, latitude: '43.2', longitude: '-180.5' })).toBeNull();
  });

  it('never yields 0,0 for input that was not actually 0,0', () => {
    const bogus = [
      { latitude: null, longitude: null },
      { latitude: '', longitude: '' },
      { latitude: false, longitude: false },
      { latitude: [], longitude: [] },
      { latitude: undefined, longitude: undefined },
    ];
    for (const row of bogus) expect(withNumericCoords(row)).toBeNull();

    // A genuine null island reading is still allowed through — it is a real
    // coordinate, and rejecting it would be inventing a rule the data lacks.
    expect(withNumericCoords({ latitude: '0', longitude: '0' })).toEqual({
      latitude: 0,
      longitude: 0,
    });
  });
});

describe('withNumericCoordsList', () => {
  it('keeps the rows it can place and drops the rest', () => {
    const rows = [
      { id: 1, latitude: '43.238000', longitude: '76.945000' },
      { id: 2, latitude: null, longitude: null },
      { id: 3, latitude: 43.4, longitude: 76.6 },
      { id: 4, latitude: '91', longitude: '76.9' }, // off the planet
      { id: 5, latitude: 'abc', longitude: 'def' },
    ];
    expect(withNumericCoordsList(rows)).toEqual([
      { id: 1, latitude: 43.238, longitude: 76.945 },
      { id: 3, latitude: 43.4, longitude: 76.6 },
    ]);
  });

  it('does not mutate the input array or its items', () => {
    const rows = [
      { id: 1, latitude: '43.238000', longitude: '76.945000' },
      { id: 2, latitude: null, longitude: null },
    ];
    const snapshot = JSON.parse(JSON.stringify(rows));
    const out = withNumericCoordsList(rows);

    expect(rows).toEqual(snapshot);
    expect(rows).toHaveLength(2); // the invalid row is still in the input
    expect(out).not.toBe(rows);
    expect(out[0]).not.toBe(rows[0]);
  });

  it('treats a missing or non-array list as empty', () => {
    expect(withNumericCoordsList(null)).toEqual([]);
    expect(withNumericCoordsList(undefined)).toEqual([]);
    expect(withNumericCoordsList([])).toEqual([]);
  });

  it('guarantees every survivor is finite and in range', () => {
    const rows = [
      { latitude: '43.238000', longitude: '76.945000' },
      { latitude: Infinity, longitude: 0 },
      { latitude: 89.9, longitude: 179.9 },
      { latitude: '  ', longitude: '  ' },
    ];
    for (const row of withNumericCoordsList(rows)) {
      expect(typeof row.latitude).toBe('number');
      expect(typeof row.longitude).toBe('number');
      expect(Number.isFinite(row.latitude)).toBe(true);
      expect(Number.isFinite(row.longitude)).toBe(true);
      expect(Math.abs(row.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(row.longitude)).toBeLessThanOrEqual(180);
    }
  });
});
