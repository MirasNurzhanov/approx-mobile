import { toFiniteNumber, withNumericCoords, withNumericCoordsList } from '../coords';

describe('toFiniteNumber', () => {
  it('parses the decimal strings DRF sends', () => {
    expect(toFiniteNumber('43.238000')).toBe(43.238);
    expect(toFiniteNumber('-76.889')).toBe(-76.889);
    expect(toFiniteNumber('0')).toBe(0);
  });

  it('passes numbers through untouched', () => {
    expect(toFiniteNumber(43.238)).toBe(43.238);
    expect(toFiniteNumber(0)).toBe(0);
  });

  it('rejects anything that is not honestly a coordinate', () => {
    for (const value of [null, undefined, '', '   ', 'abc', NaN, Infinity, {}, []]) {
      expect(toFiniteNumber(value)).toBeNull();
    }
  });
});

describe('withNumericCoords', () => {
  it('coerces both coordinates and keeps every other field', () => {
    const story = { id: 7, latitude: '43.238000', longitude: '76.889000', text: 'hi' };
    expect(withNumericCoords(story)).toEqual({
      id: 7,
      latitude: 43.238,
      longitude: 76.889,
      text: 'hi',
    });
  });

  it('returns null rather than an unplaceable row', () => {
    // 0,0 would be a marker in the Gulf of Guinea, which is worse than none.
    expect(withNumericCoords({ id: 1, latitude: null, longitude: '76.9' })).toBeNull();
    expect(withNumericCoords({ id: 1, latitude: '43.2', longitude: undefined })).toBeNull();
  });
});

describe('withNumericCoordsList', () => {
  it('keeps the rows it can place and drops the rest', () => {
    const rows = [
      { id: 1, latitude: '43.2', longitude: '76.8' },
      { id: 2, latitude: null, longitude: null },
      { id: 3, latitude: 43.4, longitude: 76.6 },
    ];
    expect(withNumericCoordsList(rows)).toEqual([
      { id: 1, latitude: 43.2, longitude: 76.8 },
      { id: 3, latitude: 43.4, longitude: 76.6 },
    ]);
  });

  it('treats a missing list as empty', () => {
    expect(withNumericCoordsList(null)).toEqual([]);
    expect(withNumericCoordsList(undefined)).toEqual([]);
  });
});
