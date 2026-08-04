// Where markers go when people stand close together.
//
// The bug these exist for, in one sentence: a marker is not a disc. It is a
// ring with a caption chip hanging underneath, and the chip is *wider than the
// ring and half as tall again*. The collision test compared centre distances
// against half a ring's width, so two markers a full marker-height apart were
// declared not to overlap — and they were drawn at their true positions with
// one's caption sitting across the other's halo. Four people on one street in
// Almaty came out as a vertical smear of orange circles with fragments of the
// word "Coding" poking out either side.
//
// So the tests below are mostly about the *box*, not the point.

import { layoutMarkers, type ClusterResult, type FanInput } from '../markerLayout';

/** Metres per pixel at roughly street zoom on a normal phone. */
const M_PER_PX = 1.9;
const M_PER_DEG = 111_320;

/** A point `northM` metres north of the origin, at Almaty's latitude. */
function at(northM: number, eastM = 0): { latitude: number; longitude: number } {
  const latitude = 43.238 + northM / M_PER_DEG;
  const lonScale = M_PER_DEG * Math.cos((43.238 * Math.PI) / 180);
  return { latitude, longitude: 76.945 + eastM / lonScale };
}

function person(key: string, northM: number, eastM = 0): FanInput {
  return { key, ...at(northM, eastM) };
}

/** Screen-space gap between two drawn markers, in pixels. */
function pixelsApart(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const north = Math.abs(a.latitude - b.latitude) * M_PER_DEG;
  const east =
    Math.abs(a.longitude - b.longitude) * M_PER_DEG * Math.cos((43.238 * Math.PI) / 180);
  return { north: north / M_PER_PX, east: east / M_PER_PX };
}

describe('layoutMarkers', () => {
  it('leaves someone standing alone exactly where they are', () => {
    const alone = person('u-1', 0);
    const { placed, clusters } = layoutMarkers([alone], M_PER_PX, []);
    expect(clusters).toHaveLength(0);
    expect(placed.get('u-1')!.position).toEqual({
      latitude: alone.latitude,
      longitude: alone.longitude,
    });
    // Nothing near them, so they keep their name.
    expect(placed.get('u-1')!.crowded).toBeFalsy();
  });

  it('treats markers a caption-height apart as colliding', () => {
    // The screenshot case. ~60px apart vertically: further than a ring, closer
    // than a captioned marker is tall. The old radial test said "fine".
    const points = [person('u-1', 0), person('u-2', 60 * M_PER_PX)];
    const { placed } = layoutMarkers(points, M_PER_PX, []);

    expect(placed.get('u-1')!.crowded).toBe(true);
    expect(placed.get('u-2')!.crowded).toBe(true);
  });

  it('separates a stacked column so no two rings overlap', () => {
    // Four people down one street, which is what the map actually showed.
    const points = [
      person('u-1', 0),
      person('u-2', 60 * M_PER_PX),
      person('u-3', 120 * M_PER_PX),
      person('u-4', 180 * M_PER_PX),
    ];
    const { placed, clusters } = layoutMarkers(points, M_PER_PX, []);

    const drawn = [...placed.values()].map((r) => r.position);
    const total = drawn.length + clusters.reduce((n: number, c: ClusterResult) => n + c.count, 0);
    expect(total).toBe(4);

    // Whatever survived as an individual marker must clear its neighbours by a
    // ring's width — captions are gone by then, so a ring is the footprint.
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        const gap = pixelsApart(drawn[i], drawn[j]);
        expect(Math.hypot(gap.north, gap.east)).toBeGreaterThanOrEqual(38);
      }
    }
  });

  it('drops captions for everyone in a pile, the owner included', () => {
    // The fan clears rings, not name chips. If the owner kept their caption it
    // would hang straight over whoever got fanned to the south of them.
    const points = [person('self', 0), person('u-1', 20), person('u-2', -20)];
    const { placed } = layoutMarkers(points, M_PER_PX, []);
    for (const key of ['self', 'u-1', 'u-2']) {
      expect(placed.get(key)?.crowded).toBe(true);
    }
  });

  it('keeps the owner on their real position', () => {
    const self = person('self', 0);
    const { placed } = layoutMarkers([self, person('u-1', 15)], M_PER_PX, []);
    expect(placed.get('self')!.position).toEqual({
      latitude: self.latitude,
      longitude: self.longitude,
    });
  });

  it('leaves people who are genuinely far apart alone', () => {
    // A kilometre apart at street zoom is hundreds of pixels. Nothing to do.
    const points = [person('u-1', 0), person('u-2', 1000)];
    const { placed, clusters } = layoutMarkers(points, M_PER_PX, []);
    expect(clusters).toHaveLength(0);
    for (const key of ['u-1', 'u-2']) {
      expect(placed.get(key)!.crowded).toBeFalsy();
    }
  });

  it('accounts for the caption being wider than it is tall', () => {
    // Side by side, one ring-width apart. The rings clear each other; the name
    // chips underneath do not, because a chip is far wider than a ring.
    const points = [person('u-1', 0), person('u-2', 0, 50 * M_PER_PX)];
    const { placed } = layoutMarkers(points, M_PER_PX, []);
    expect(placed.get('u-1')!.crowded).toBe(true);
  });

  it('gives a fanned marker a leader line back to the truth', () => {
    const points = [person('u-1', 0), person('u-2', 10)];
    const { placed } = layoutMarkers(points, M_PER_PX, []);
    const moved = [...placed.values()].filter((r) => r.anchor);
    expect(moved.length).toBeGreaterThan(0);
    for (const marker of moved) {
      expect(marker.anchor).toBeDefined();
    }
  });

  it('falls back to a headcount rather than moving anyone too far', () => {
    // Zoomed out, a pixel is worth a lot of metres, so separating the pile
    // would push people further than FAN_MAX_M. A number is honest; a marker a
    // kilometre from its owner is not.
    const farOut = 400;
    const points = [
      person('u-1', 0), person('u-2', 10), person('u-3', 20), person('u-4', 30),
    ];
    const { placed, clusters } = layoutMarkers(points, farOut, []);
    expect(clusters.length).toBeGreaterThan(0);
    expect(placed.size + clusters.reduce((n: number, c: ClusterResult) => n + c.count, 0)).toBe(4);
  });

  it('returns everyone before the viewport has been measured', () => {
    const points = [person('u-1', 0), person('u-2', 10)];
    const { placed, clusters } = layoutMarkers(points, 0, []);
    expect(placed.size).toBe(0);
    expect(clusters).toHaveLength(0);
  });
});
