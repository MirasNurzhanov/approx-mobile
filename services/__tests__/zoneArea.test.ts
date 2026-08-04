// Region geometry on the client, which has to agree with regions/geometry.py
// on the server exactly. The client repeats the containment test rather than
// asking, because it runs on every marker of every poll — so any drift between
// the two shows up as a zone that says you are inside it on one side and
// outside it on the other.
//
// Rings are written the way OSM sends them: wrapped, so a shape crossing the
// dateline jumps from +179 to -179 between adjacent points. The server unwraps
// before storing, so the fixtures below are pre-unwrapped where they represent
// something already stored.

import {
  alignLon,
  crossesAntimeridian,
  regionBoxContains,
  regionContains,
  regionViewport,
  ringsForDisplay,
  splitRingAtAntimeridian,
  toLatLng,
  type Region,
  type RegionSummary,
} from '../zoneArea';

/** Build a stored region the way the server would, from unwrapped rings. */
function makeRegion(rings: [number, number][][], overrides: Partial<Region> = {}): Region {
  const lats = rings.flat().map(([, lat]) => lat);
  const lons = rings.flat().map(([lon]) => lon);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  // Wrapped back into ±180, exactly as the server stores a centroid.
  const centroidLon = (((maxLon + minLon) / 2 + 180) % 360 + 360) % 360 - 180;
  return {
    id: 1,
    name: 'Somewhere',
    display_name: 'Somewhere, Testland',
    country_code: 'ts',
    kind: 'city',
    admin_level: null,
    min_lat: Math.min(...lats),
    max_lat: Math.max(...lats),
    min_lon: minLon,
    max_lon: maxLon,
    centroid_lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    centroid_lon: centroidLon,
    point_count: rings.flat().length,
    rings,
    ...overrides,
  };
}

// A unit square from (0,0) to (1,1), as [lon, lat] like GeoJSON.
const SQUARE: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
// The same square with a hole from (0.4,0.4) to (0.6,0.6).
const HOLE: [number, number][] = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]];

// Unwrapped, i.e. as stored: Fiji runs 178 → 181, not 178 → -179.
const FIJI: [number, number][] = [
  [178, -18.5], [181, -18.5], [181, -17], [178, -17], [178, -18.5],
];
const KIRIBATI: [number, number][] = [
  [179, 1], [183, 1], [183, 3], [179, 3], [179, 1],
];
const CHUKOTKA: [number, number][] = [
  [179, 64], [184, 64], [184, 67], [179, 67], [179, 64],
];
// The Chathams sit at 176.5 west — near the meridian, entirely one side of it.
const CHATHAM: [number, number][] = [
  [-177, -44.4], [-175.8, -44.4], [-175.8, -43.6], [-177, -43.6], [-177, -44.4],
];

describe('alignLon', () => {
  it('leaves an ordinary window alone', () => {
    expect(alignLon(76.9, 76.7, 77.1)).toBe(76.9);
    expect(alignLon(0.5, 0, 1)).toBe(0.5);
  });

  it('moves a query into a window that runs past 180', () => {
    expect(alignLon(-179.9, 178, 181)).toBeCloseTo(180.1);
  });

  it('is the identity a long way from any crossing', () => {
    expect(alignLon(-120, -130, -110)).toBe(-120);
  });
});

describe('crossesAntimeridian', () => {
  it('is false for every ordinary region', () => {
    expect(crossesAntimeridian({ min_lon: 0, max_lon: 1 })).toBe(false);
    expect(crossesAntimeridian({ min_lon: -177, max_lon: -175.8 })).toBe(false);
  });

  it('is true for a window running past the line', () => {
    expect(crossesAntimeridian({ min_lon: 178, max_lon: 181 })).toBe(true);
  });
});

describe('regionContains', () => {
  it('finds a point inside an ordinary region', () => {
    expect(regionContains(makeRegion([SQUARE]), 0.5, 0.5)).toBe(true);
  });

  it('rejects a point outside the ring but inside the box', () => {
    const el: [number, number][] = [
      [0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1], [0, 0],
    ];
    const region = makeRegion([el]);
    expect(regionContains(region, 0.25, 0.25)).toBe(true);
    expect(regionContains(region, 0.75, 0.75)).toBe(false);
  });

  it('treats a hole as outside', () => {
    const region = makeRegion([SQUARE, HOLE]);
    expect(regionContains(region, 0.2, 0.2)).toBe(true);
    expect(regionContains(region, 0.5, 0.5)).toBe(false);
  });

  describe('across the antimeridian', () => {
    it('holds either side of the line in Fiji', () => {
      const fiji = makeRegion([FIJI]);
      expect(regionContains(fiji, -17.5, 179.99)).toBe(true);
      expect(regionContains(fiji, -17.5, -179.99)).toBe(true);
      expect(regionContains(fiji, -17.5, 180)).toBe(true);
      expect(regionContains(fiji, -17.5, -180)).toBe(true);
      expect(regionContains(fiji, -17.5, 178.5)).toBe(true);
      expect(regionContains(fiji, -17.5, -179.5)).toBe(true);
      // Outside, both ends.
      expect(regionContains(fiji, -17.5, 177)).toBe(false);
      expect(regionContains(fiji, -17.5, -178)).toBe(false);
      // Right longitude, wrong latitude.
      expect(regionContains(fiji, -20, 179.5)).toBe(false);
    });

    it('holds either side of the line in Kiribati', () => {
      const kiribati = makeRegion([KIRIBATI]);
      expect(regionContains(kiribati, 2, 179.9)).toBe(true);
      expect(regionContains(kiribati, 2, -179.9)).toBe(true);
      expect(regionContains(kiribati, 2, -177.5)).toBe(true);
      expect(regionContains(kiribati, 2, 178)).toBe(false);
      expect(regionContains(kiribati, 2, -176)).toBe(false);
      expect(regionContains(kiribati, 5, 179.9)).toBe(false);
    });

    it('holds either side of the line in Chukotka', () => {
      const chukotka = makeRegion([CHUKOTKA]);
      expect(regionContains(chukotka, 65.5, 179.5)).toBe(true);
      expect(regionContains(chukotka, 65.5, -179.5)).toBe(true);
      expect(regionContains(chukotka, 65.5, -177)).toBe(true);
      expect(regionContains(chukotka, 65.5, 178)).toBe(false);
      expect(regionContains(chukotka, 65.5, -175)).toBe(false);
      expect(regionContains(chukotka, 60, -179.5)).toBe(false);
    });

    it('leaves the Chathams as an ordinary region', () => {
      const chatham = makeRegion([CHATHAM]);
      expect(crossesAntimeridian(chatham)).toBe(false);
      expect(regionContains(chatham, -44, -176.4)).toBe(true);
      expect(regionContains(chatham, -44, 179)).toBe(false);
      expect(regionContains(chatham, -44, -179)).toBe(false);
    });

    it('does not let a crossing region swallow the far side of the world', () => {
      const fiji = makeRegion([FIJI]);
      expect(regionContains(fiji, -17.5, 0)).toBe(false);
      expect(regionContains(fiji, -17.5, -90)).toBe(false);
      expect(regionContains(fiji, -17.5, 90)).toBe(false);
    });
  });
});

describe('regionBoxContains', () => {
  it('is a cheap definite no for a search result far away', () => {
    expect(regionBoxContains({ min_lat: 0, max_lat: 1, min_lon: 0, max_lon: 1 }, 50, 50))
      .toBe(false);
  });

  it('accepts a point inside the box without needing the rings', () => {
    expect(regionBoxContains({ min_lat: 0, max_lat: 1, min_lon: 0, max_lon: 1 }, 0.5, 0.5))
      .toBe(true);
  });

  it('handles a crossing box the same way containment does', () => {
    const fiji = { min_lat: -18.5, max_lat: -17, min_lon: 178, max_lon: 181 };
    expect(regionBoxContains(fiji, -17.5, -179.5)).toBe(true);
    expect(regionBoxContains(fiji, -17.5, 179.5)).toBe(true);
    expect(regionBoxContains(fiji, -17.5, 100)).toBe(false);
  });
});

describe('splitRingAtAntimeridian', () => {
  it('returns an ordinary ring as one piece', () => {
    const [piece, ...rest] = splitRingAtAntimeridian(SQUARE);
    expect(rest).toHaveLength(0);
    // The closing duplicate is dropped; a polygon closes itself.
    expect(piece).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
  });

  it('leaves a ring near but not over the line untouched', () => {
    const [piece, ...rest] = splitRingAtAntimeridian(CHATHAM);
    expect(rest).toHaveLength(0);
    expect(piece.every(([lon]) => lon >= -180 && lon <= 180)).toBe(true);
  });

  it('cuts a crossing ring into two drawable pieces', () => {
    const pieces = splitRingAtAntimeridian(FIJI);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) {
      for (const [lon] of piece) {
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);
      }
    }
    // One piece each side of the line, meeting at it.
    const [near, far] = pieces;
    expect(Math.max(...near.map(([lon]) => lon))).toBeCloseTo(180);
    expect(Math.min(...far.map(([lon]) => lon))).toBeCloseTo(-180);
  });

  it('keeps the latitudes of the cut edge', () => {
    // Fiji spans -18.5 to -17; both pieces must still span exactly that, or
    // the seam shows as a notch at the edge of the map.
    for (const piece of splitRingAtAntimeridian(FIJI)) {
      const lats = piece.map(([, lat]) => lat);
      expect(Math.min(...lats)).toBeCloseTo(-18.5);
      expect(Math.max(...lats)).toBeCloseTo(-17);
    }
  });

  it('handles a window that runs past -180 rather than +180', () => {
    const westward: [number, number][] = [
      [-178, 10], [-182, 10], [-182, 12], [-178, 12], [-178, 10],
    ];
    const pieces = splitRingAtAntimeridian(westward);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) {
      for (const [lon] of piece) {
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);
      }
    }
  });

  it('discards a ring too small to enclose anything', () => {
    expect(splitRingAtAntimeridian([[0, 0], [1, 1]])).toEqual([]);
  });
});

describe('ringsForDisplay', () => {
  it('converts to the latitude/longitude the map wants', () => {
    const [piece] = ringsForDisplay(makeRegion([SQUARE]));
    expect(piece[0]).toEqual({ latitude: 0, longitude: 0 });
    expect(piece[1]).toEqual({ latitude: 0, longitude: 1 });
  });

  it('splits a crossing region into two polygons', () => {
    expect(ringsForDisplay(makeRegion([FIJI]))).toHaveLength(2);
  });

  it('keeps a hole as its own piece', () => {
    expect(ringsForDisplay(makeRegion([SQUARE, HOLE]))).toHaveLength(2);
  });

  it('applies a transform when one is given', () => {
    const pieces = ringsForDisplay(makeRegion([SQUARE]), (points) =>
      points.map((p) => ({ latitude: p.latitude + 10, longitude: p.longitude })),
    );
    expect(pieces[0][0]).toEqual({ latitude: 10, longitude: 0 });
  });
});

describe('toLatLng', () => {
  it('inverts GeoJSON order and nothing else', () => {
    expect(toLatLng([[76.9, 43.2]])).toEqual([{ latitude: 43.2, longitude: 76.9 }]);
  });
});

describe('regionViewport', () => {
  it('frames an ordinary region on its own box', () => {
    const box = regionViewport(makeRegion([SQUARE]) as RegionSummary);
    expect(box.latitude).toBeCloseTo(0.5);
    expect(box.longitude).toBeCloseTo(0.5);
    expect(box.longitudeDelta).toBeCloseTo(1.15);
  });

  it('frames a crossing region as the few degrees wide it really is', () => {
    // The bug this replaces: a wrapped box reads as 358 degrees across, so the
    // camera zooms out to the whole planet to fit a country.
    const box = regionViewport(makeRegion([FIJI]) as RegionSummary);
    expect(box.longitudeDelta).toBeCloseTo(3.45);
    expect(box.longitude).toBeGreaterThanOrEqual(-180);
    expect(box.longitude).toBeLessThanOrEqual(180);
  });
});
