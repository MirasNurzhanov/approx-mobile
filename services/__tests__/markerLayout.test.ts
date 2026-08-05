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

import {
  FAN_MAX_M,
  layoutMarkers,
  MIN_FAN_PX,
  roughMeters,
  SELF_CLEAR_PX,
  type FanInput,
} from '../markerLayout';

/** Metres per pixel at roughly street zoom on a normal phone. */
const M_PER_PX = 1.9;
/** Zoomed out over a district: still fans, well short of `FAN_MAX_M`. */
const MID_ZOOM = 5;
/** Zoomed out over a region. A pixel is worth hundreds of metres here, so a
 *  fan would fling people kilometres and the pile is counted instead. */
const FAR_ZOOM = 400;
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
    const { placed } = layoutMarkers(points, M_PER_PX, []);

    const drawn = [...placed.values()].map((r) => r.position);
    // Everyone is drawn. A headcount badge may also appear beside them, but it
    // stands for nobody — it never removes a marker from this map.
    expect(placed.size).toBe(4);

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

  // ── The teleporting bug, from every direction it arrived from ─────────────
  //
  // Three separate versions of "friends jump onto the user when you zoom out"
  // have shipped. Two came from a cap measured in metres quietly beating a
  // separation that only means anything in pixels; the third from fanning a
  // pile whose members were kilometres apart into a tidy ring around whoever
  // sat at its centre — which, when the owner is in the pile, is the owner.
  // The invariant below has to hold at *every* zoom, with and without zones.

  it('never draws anyone at the owner’s position, at any zoom, with or without zones', () => {
    const zooms = [0.5, M_PER_PX, MID_ZOOM, 12, 13, 40, 120, FAR_ZOOM];
    // A tiny zone is the nastiest case: as a real-world distance it shrinks to
    // a fraction of a pixel when zoomed out, and used to drag the whole pile
    // onto its centre with it.
    const zoneSets = [[], [{ ...at(0), radius: 20 }], [{ ...at(0), radius: 400 }]];
    const points = [
      person('self', 0), person('u-1', 5), person('u-2', -5), person('u-3', 0, 5),
    ];

    for (const metersPerPx of zooms) {
      for (const zones of zoneSets) {
        const { placed } = layoutMarkers(points, metersPerPx, zones);
        const self = placed.get('self')!.position;
        for (const key of ['u-1', 'u-2', 'u-3']) {
          const other = placed.get(key);
          // Absent means counted, not drawn somewhere false — also fine.
          if (!other) continue;
          const gapPx = roughMeters(self, other.position) / metersPerPx;
          expect(gapPx).toBeGreaterThanOrEqual(MIN_FAN_PX - 0.01);
        }
      }
    }
  });

  it('never displaces a marker further than the fan’s budget', () => {
    // The other half of "no teleporting": a marker that stays on the map must
    // stay near where its owner really is, however far out the camera goes.
    for (const metersPerPx of [M_PER_PX, MID_ZOOM, 12, 40, FAR_ZOOM]) {
      const points = [
        person('u-1', 0), person('u-2', 10), person('u-3', 20), person('u-4', 30),
      ];
      const { placed } = layoutMarkers(points, metersPerPx, []);
      for (const result of placed.values()) {
        if (!result.anchor) continue;
        expect(roughMeters(result.position, result.anchor)).toBeLessThanOrEqual(FAN_MAX_M + 0.01);
      }
    }
  });

  // ── When the counting starts ──────────────────────────────────────────────

  it('draws everyone individually at ordinary zooms rather than counting early', () => {
    // The complaint that produced the previous round of changes: people turned
    // into a number the moment you pulled back a little, while their zone
    // circles stayed full-size, so it read as them vanishing out of their own
    // circles. Nothing is counted until genuinely far out.
    for (const metersPerPx of [M_PER_PX, MID_ZOOM]) {
      const points = [
        person('u-1', 0), person('u-2', 10), person('u-3', 20), person('u-4', 30),
      ];
      const { placed, clusters } = layoutMarkers(points, metersPerPx, []);
      expect(clusters).toHaveLength(0);
      expect(placed.size).toBe(4);
    }
  });

  it('counts the pile once zoomed out past the budget', () => {
    const points = [
      person('u-1', 0), person('u-2', 10), person('u-3', 20), person('u-4', 30),
    ];
    const { placed, clusters } = layoutMarkers(points, FAR_ZOOM, []);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(4);
    // Counted instead of drawn — the point is that none of them is drawn
    // somewhere they are not.
    expect(placed.size).toBe(0);
  });

  it('counts the friends around the owner while still drawing the owner', () => {
    const points = [
      person('self', 0), person('u-1', 5), person('u-2', -5), person('u-3', 0, 5),
    ];
    const { placed, clusters } = layoutMarkers(points, FAR_ZOOM, []);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(3);
    // "You" is never a statistic, and never leaves the map.
    expect(placed.size).toBe(1);
    expect(placed.get('self')!.position).toEqual(at(0));
    // And the badge does not sit on top of the owner's marker either.
    const gapPx = roughMeters(clusters[0].position, placed.get('self')!.position) / FAR_ZOOM;
    expect(gapPx).toBeGreaterThanOrEqual(MIN_FAN_PX - 0.01);
  });

  it('puts the badge where the counted people are, not beside the owner', () => {
    // Zoomed far out the collision box spans kilometres, so the owner and a
    // cluster of friends 20 km away land in one pile. The number belongs over
    // the friends; pinning it to the owner would repeat the very claim the fan
    // used to make by moving them there.
    const far = 20_000;
    const points = [
      person('self', 0),
      person('u-1', far), person('u-2', far + 40), person('u-3', far - 40),
    ];
    const { clusters } = layoutMarkers(points, FAR_ZOOM, []);
    expect(clusters).toHaveLength(1);
    expect(roughMeters(clusters[0].position, at(far))).toBeLessThan(100);
    expect(roughMeters(clusters[0].position, at(0))).toBeGreaterThan(far - 100);
  });

  it('nudges a badge off the owner in the direction of the people it counts', () => {
    // Friends genuinely clustered beside the owner, close enough that the
    // badge would cover their marker. It has to move — but east, because that
    // is where the people are, not north because north is convenient.
    const beside = 1_000;
    const points = [
      person('self', 0),
      person('u-1', 0, beside), person('u-2', 40, beside), person('u-3', -40, beside),
    ];
    const { clusters, placed } = layoutMarkers(points, FAR_ZOOM, []);
    expect(clusters).toHaveLength(1);
    const badge = clusters[0].position;
    const self = placed.get('self')!.position;
    // Cleared the owner…
    expect(roughMeters(badge, self) / FAR_ZOOM).toBeGreaterThanOrEqual(MIN_FAN_PX - 0.01);
    // …eastward, toward the friends, rather than off along some fixed axis.
    expect(badge.longitude).toBeGreaterThan(self.longitude);
    expect(Math.abs(badge.latitude - self.latitude)).toBeLessThan(1e-6);
    // And it remembers the spot it stands in for, for the leader line.
    expect(clusters[0].anchor).toBeDefined();
  });

  // ── Zones ────────────────────────────────────────────────────────────────

  it('still honours a sound zone that is large enough on screen to mean something', () => {
    // The floor must not swallow the constraint it rescues. A ring of six
    // wants a wider radius than the floor, so a zone between the two really
    // does pull it in — a marker fanned outside a circle its owner is audibly
    // inside would contradict what the user can hear.
    const centre = at(0);
    const zones = [{ ...centre, radius: 78 }];
    const points = [
      person('u-1', 0), person('u-2', 4), person('u-3', -4),
      person('u-4', 8), person('u-5', -8), person('u-6', 12),
    ];
    const { placed } = layoutMarkers(points, M_PER_PX, zones);
    expect(placed.size).toBe(6);
    for (const result of placed.values()) {
      expect(roughMeters(result.position, centre)).toBeLessThanOrEqual(78.01);
    }
  });

  it('returns everyone before the viewport has been measured', () => {
    const points = [person('u-1', 0), person('u-2', 10)];
    const { placed, clusters } = layoutMarkers(points, 0, []);
    expect(placed.size).toBe(0);
    expect(clusters).toHaveLength(0);
  });
});
