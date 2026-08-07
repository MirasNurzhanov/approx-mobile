// Where markers go when people stand close together.
//
// Two people at the same café are two markers at the same pixel, and something
// has to be on top. So markers that collide on screen are fanned out around the
// spot they share, and a leader line runs from each one back to it. The fan is
// measured in pixels, not metres, so it separates by the same amount at every
// zoom — and the lines are what keep it honest, since the marker is then a few
// metres from where its owner actually is.
//
// Only markers move. Zones, the approximate-location haze and motion trails are
// real geography and stay exactly where they are.
//
// Lives apart from the map screen because it is pure arithmetic with a history
// of subtle bugs, and importing the screen to test it drags in the native audio
// player. Nothing here touches React or the map.

export interface GeoPoint { latitude: number; longitude: number }
export interface ZoneArea extends GeoPoint { radius: number }

export const M_PER_DEG = 111_320;

/** Name plate under a marker. Shared by the avatar markers and by the stranger
 *  dots, which carry the interest that put them on your map. */
export const CAPTION_GAP = 5;
export const CAPTION_H = 17;

/** Marker footprint the fan has to keep clear between neighbours. The ring or
 *  halo only — a fanned marker drops its caption, see `FanResult.crowded`. */
export const MARKER_PX = 44;

/**
 * What a marker actually covers on screen, caption included.
 *
 * This is the box that has to stay clear of its neighbours, and getting it
 * wrong is what put four overlapping "Coding" chips down the middle of the map.
 * The old test compared centre distances against 26 px — roughly half a ring —
 * so two markers 60 px apart were declared not to collide. They were: the ring
 * is 38–44 px, but underneath it hangs a caption chip that is *wider than the
 * marker* and pushes the drawn box to 60–66 px tall. The upper marker's caption
 * landed squarely on the lower marker's halo, which reads as one smeared blob
 * with letters poking out either side.
 *
 * Height is the tallest marker with a caption: an avatar ring plus the gap and
 * the chip. Width is the chip, which is the widest thing drawn — the ring is
 * narrower than the name under it for all but the shortest usernames.
 */
export const MARKER_H_PX = MARKER_PX + CAPTION_GAP + CAPTION_H;
export const MARKER_W_PX = 96;

/** Clearance from the owner's marker. Measured against its solid 34 px core,
 *  not the 54 px halo — the halo is translucent, so a neighbour sitting over
 *  its edge is still perfectly readable, and using the full halo would push
 *  everyone a further 10 px (20 m at the default zoom) from where they are. */
export const SELF_CLEAR_PX = (34 + MARKER_PX) / 2;

/** The key the owner's own marker is filed under. */
export const SELF_KEY = 'self';

/**
 * The hard floor under the fan's radius, in pixels.
 *
 * Whatever else constrains the ring, it may never draw tighter than this on
 * screen. This is the invariant that stops a marker being drawn on top of the
 * pile's centre, and it is stated in *pixels* because every version of that
 * bug came from stating it in metres.
 *
 * Both caps this file has carried were real-world distances: a flat 80 m
 * ceiling, and the sound-zone boundary in `fanCapMeters`. A distance in metres
 * shrinks in pixel terms exactly as you zoom out, so past some zoom each of
 * them was smaller than the ring it was capping — the whole pile collapsed
 * onto its centre, and when that centre was the owner, every friend nearby
 * rendered on top of the person looking at the map. Not "nudged further than
 * ideal": teleported onto them.
 *
 * A pixel floor cannot fail that way, because the thing being protected — two
 * markers not overlapping — is itself measured in pixels.
 */
export const MIN_FAN_PX = SELF_CLEAR_PX;

/**
 * The fan's displacement budget: how far it may move a marker from where its
 * owner actually stands before it gives up and counts them instead.
 *
 * This is really the zoom threshold, wearing a distance's clothes.
 *
 * The ring's radius is a fixed number of *pixels*, so the metres it costs grow
 * as you zoom out. Worse, the collision box is pixels too — zoomed far enough
 * out it spans a city, so friends who are genuinely kilometres apart merge
 * into a single pile, and the fan lays them out in a tidy ring around that
 * pile's centre. When the owner is in the pile, that centre is the owner: half
 * the city's friends redrawn as a huddle around your own marker.
 *
 * That is the teleporting bug, and no pixel floor can fix it — the ring is
 * correct on screen and false about the world at the same time. The only
 * honest move past this point is to stop moving people: nobody is drawn
 * somewhere they are not, and a count appears where they actually are.
 *
 * Set generously on purpose. Displacement is only ever the ring's ~39 px, so
 * this binds solely at the far end; individual faces survive until the
 * viewport spans roughly ten kilometres, well past the "zoomed out a bit"
 * range where counting instead of drawing people read as them vanishing.
 */
export const FAN_MAX_M = 500;

export function metersPerDegLng(latitude: number): number {
  // Guard the poles: cos(90°) is 0 and would send the offset to infinity.
  return M_PER_DEG * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
}

export function offsetByMeters(p: GeoPoint, northM: number, eastM: number): GeoPoint {
  // Clamped: an offset that runs off the top of the world is an invalid
  // coordinate, and the native map does not survive being handed one.
  const latitude = Math.max(-85, Math.min(85, p.latitude + northM / M_PER_DEG));
  return { latitude, longitude: p.longitude + eastM / metersPerDegLng(p.latitude) };
}

/** Flat-earth distance. Over the tens of metres this is used for, the error is
 *  far below the pixel it is being compared against. */
export function roughMeters(a: GeoPoint, b: GeoPoint): number {
  const dNorth = (a.latitude - b.latitude) * M_PER_DEG;
  const dEast = (a.longitude - b.longitude) * metersPerDegLng(a.latitude);
  return Math.hypot(dNorth, dEast);
}

export interface FanInput extends GeoPoint { key: string }

export interface FanResult {
  /** Where to draw the marker. Equal to the true point when nothing collided. */
  position: GeoPoint;
  /** True point, when the marker was moved — the leader line's other end. */
  anchor?: GeoPoint;
  /**
   * This marker shares its spot with others and must drop its caption.
   *
   * The fan separates markers by `MARKER_PX`, which is the ring and nothing
   * else. That is only enough room if the captions are gone — a name chip is
   * wider than the ring it hangs under, so a fan sized for rings and drawn with
   * captions collides by construction. Sizing the fan for captions instead
   * would push neighbours far enough from their real positions to be a lie, or
   * tip the pile into a headcount badge at ordinary zooms.
   *
   * So the caption is what gives way. It is the least important thing on the
   * marker: the sheet behind a tap carries the name, and a pile is the one
   * situation where names are unreadable anyway. Set on the owner's own marker
   * too when they are in a pile — the fan clears their ring, not their name.
   */
  crowded?: boolean;
}

export interface ClusterResult {
  key: string;
  /** How many people the badge stands in for. */
  count: number;
  position: GeoPoint;
  /** Set when the badge had to be moved off the spot it describes. */
  anchor?: GeoPoint;
}

export interface MarkerLayout {
  /** Markers drawn individually, by key. A key that is absent was folded into
   *  a cluster — its owner must not also be drawn. The owner's own key is
   *  never absent. */
  placed: Map<string, FanResult>;
  /**
   * Headcount badges for piles too spread out to fan without lying.
   *
   * Only ever produced past `FAN_MAX_M` — that is, when zoomed far enough out
   * that separating the pile would mean drawing people hundreds of metres or
   * kilometres from where they stand. Members of a counted pile are absent
   * from `placed`, deliberately: the alternative is not "showing them", it is
   * showing them somewhere they are not.
   *
   * The owner is never counted and never absent. They are the one position on
   * this map that can be checked against the world outside the phone.
   */
  clusters: ClusterResult[];
}

/**
 * How far a marker at `center` may move without leaving a zone it is inside.
 *
 * A marker `d` metres from the middle of a zone of radius `R` has `R − d` to
 * spare. Being inside someone's music zone is an audible fact, so a marker that
 * the fan pushed across the circle's edge would contradict what the user can
 * hear. Zones the point is already outside impose nothing.
 *
 * `Infinity` when nothing constrains it — never a flat metres ceiling, which
 * is what used to stand in for "don't fan too far" and had no geographic
 * meaning at all.
 *
 * What comes back here is still a real-world distance, so it still shrinks on
 * screen as you zoom out. That is fine now and was not before: the caller
 * floors it at `MIN_FAN_PX`, so a zone too small on screen to contain anything
 * visibly can no longer squeeze the pile onto its own centre. Read this as
 * "how far geography allows", not "how far is legible" — the second question
 * belongs to the floor.
 */
export function fanCapMeters(center: GeoPoint, zones: ZoneArea[]): number {
  let cap = Infinity;
  for (const zone of zones) {
    const d = roughMeters(center, zone);
    if (d >= zone.radius) continue;
    cap = Math.min(cap, zone.radius - d);
  }
  return cap;
}

/** Ring radius whose straight-line gap between neighbours is one marker wide.
 *  Sizing by arc length instead looks right but comes out short — a ring of
 *  three lands 36 px apart and still overlaps. */
export function ringRadiusPx(count: number): number {
  return count < 2 ? MARKER_PX : MARKER_PX / (2 * Math.sin(Math.PI / count));
}

/**
 * Decide where every marker goes: fanned apart, at a spacing that reads the
 * same on screen at every zoom.
 *
 * `metersPerPx` converts the pixel thresholds above into map distance at the
 * current zoom, so the ring keeps a constant *pixel* radius however far out
 * you are — the real-world distance it corresponds to grows as you zoom out,
 * which is expected: a ring that instead held its real-world size would
 * shrink to nothing on screen long before it held its pixel size wrong.
 *
 * Three rules survive every zoom level:
 *
 *  - **The owner never moves, and is never counted.** When a pile contains
 *    them they keep their real position and everyone else rings around it.
 *    Your own marker is the one position on this map you can check against the
 *    world outside the phone, and it is the centre of your own zone — nudging
 *    it would put your avatar off-centre inside your own circle.
 *  - **Nobody is ever drawn on top of the owner.** While the fan runs, the
 *    ring is floored at `MIN_FAN_PX`; past `FAN_MAX_M` the fan stops running
 *    at all. Between them there is no zoom, and no zone geometry, at which a
 *    friend can be drawn at the owner's own coordinates.
 *  - **A marker is never displaced further than `FAN_MAX_M`.** Beyond that the
 *    pile is counted where it stands instead of being spread around a centre.
 *    Zooming out therefore trades faces for a number — never for a fiction
 *    about where people are.
 */
export function layoutMarkers(
  points: FanInput[],
  metersPerPx: number,
  zones: ZoneArea[],
): MarkerLayout {
  const placed = new Map<string, FanResult>();
  const clusters: ClusterResult[] = [];
  if (points.length === 0 || !Number.isFinite(metersPerPx) || metersPerPx <= 0) {
    return { placed, clusters };
  }

  /**
   * Badge keys are the rounded centre, not the member list.
   *
   * Keying on membership looked tidier and was the bug: one person walking in
   * or out changed the key, React unmounted the badge and mounted a new one,
   * and a fresh marker re-arms `tracksViewChanges`. Do that repeatedly — which
   * is exactly what a pinch does — and Android is re-rasterizing markers every
   * frame until it runs out of memory. A position key keeps the same badge
   * mounted while the pile stays put.
   */
  const usedKeys = new Set<string>();
  const badgeKey = (center: GeoPoint) => {
    const base = `cluster-${center.latitude.toFixed(4)}-${center.longitude.toFixed(4)}`;
    let key = base;
    for (let i = 2; usedKeys.has(key); i++) key = `${base}-${i}`;
    usedKeys.add(key);
    return key;
  };

  // Boxes, not centre distance. A marker is not a disc — it is a ring with a
  // caption chip hanging under it, wider than the ring and half as tall again —
  // so "do these two collide" is an overlap test between two rectangles. The
  // old radial test used half a ring's width and declared markers a full
  // marker-height apart to be clear of each other, which is exactly how four
  // captions ended up stacked through one another down the middle of the map.
  const clearNorth = MARKER_H_PX * metersPerPx;
  const clearEast = MARKER_W_PX * metersPerPx;
  const collides = (a: GeoPoint, b: GeoPoint) =>
    Math.abs(a.latitude - b.latitude) * M_PER_DEG < clearNorth &&
    Math.abs(a.longitude - b.longitude) * metersPerDegLng(a.latitude) < clearEast;

  const piles: FanInput[][] = [];
  for (const p of points) {
    const pile = piles.find((group) => group.some((q) => collides(q, p)));
    if (pile) pile.push(p);
    else piles.push([p]);
  }

  const keep = (p: FanInput, crowded = false) => {
    placed.set(p.key, {
      position: { latitude: p.latitude, longitude: p.longitude },
      ...(crowded ? { crowded: true } : {}),
    });
  };

  for (const pile of piles) {
    if (pile.length === 1) {
      keep(pile[0]);
      continue;
    }

    const self = pile.find((p) => p.key === SELF_KEY);
    const others = self ? pile.filter((p) => p.key !== SELF_KEY) : pile;

    // Ring centre: the owner's exact position when they are in the pile,
    // otherwise the pile's centroid — which keeps a group of other people put
    // when the server re-orders them between polls.
    const center: GeoPoint = self
      ? { latitude: self.latitude, longitude: self.longitude }
      : {
          latitude: pile.reduce((s, p) => s + p.latitude, 0) / pile.length,
          longitude: pile.reduce((s, p) => s + p.longitude, 0) / pile.length,
        };

    // Crowded: the fan below clears rings, not name chips, so the owner drops
    // their caption alongside everyone they are standing among.
    if (self) keep(self, true);

    // With the owner sitting at the centre, the ring also has to clear *them*.
    const wantPx = self
      ? Math.max(SELF_CLEAR_PX, ringRadiusPx(others.length))
      : ringRadiusPx(others.length);
    const wantM = wantPx * metersPerPx;

    // Zoomed out far enough that fanning this pile would mean drawing people
    // hundreds of metres from where they are. Count them instead, at their own
    // centre — nobody is moved, so nobody is claimed to be somewhere they are
    // not, and in particular nobody is swept into a ring around the owner.
    if (wantM > FAN_MAX_M) {
      // The people being counted, not the pile: with the owner in it the pile's
      // centre *is* the owner, and a badge pinned there would say "these
      // friends are on top of you" — the same lie the fan told by putting them
      // there. Their own centroid is where they actually are.
      const spot = self
        ? {
            latitude: others.reduce((s, p) => s + p.latitude, 0) / others.length,
            longitude: others.reduce((s, p) => s + p.longitude, 0) / others.length,
          }
        : center;
      // …unless that lands on the owner's marker anyway, which it does when
      // they really are standing together — or near enough that the gap is a
      // few pixels at this zoom. Then it is nudged out to clear the owner,
      // *along the line to the people it counts* so it still points the right
      // way, with a leader line back to the spot it stands in for.
      const clearM = MIN_FAN_PX * metersPerPx;
      const north = (spot.latitude - center.latitude) * M_PER_DEG;
      const east = (spot.longitude - center.longitude) * metersPerDegLng(center.latitude);
      const away = Math.hypot(north, east);
      const coversOwner = self != null && away < clearM;
      clusters.push({
        key: badgeKey(spot),
        count: others.length,
        position: !coversOwner
          ? spot
          : away > 0
            ? offsetByMeters(center, (north / away) * clearM, (east / away) * clearM)
            // Exactly co-located: no direction to preserve, so pick one.
            : offsetByMeters(center, clearM, 0),
        anchor: coversOwner ? spot : undefined,
      });
      continue;
    }

    // A zone may pull the ring in, but only so far. `fanCapMeters` is a
    // real-world distance and so shrinks in pixel terms as you zoom out; below
    // `MIN_FAN_PX` on screen it has stopped describing anything a viewer can
    // see and starts stacking the pile onto its own centre.
    //
    // The floor is itself held to `wantM`, so it can only ever rescue an
    // over-tight cap — never push a pile *wider* than its ideal spacing. Small
    // piles ask for less than `MIN_FAN_PX` (a ring of four wants 31 px), and
    // moving those further from where people actually are, to satisfy a floor
    // meant for a different problem, would be its own small lie. The practical
    // effect is that a zone only ever binds on piles of six or more, where the
    // ideal ring is wider than the floor; below that the floor wins, which is
    // the right way round — a circle drawn a few pixels off is a smaller
    // problem than a friend drawn on top of you.
    //
    // Where the owner is in the pile `wantPx` is at least `SELF_CLEAR_PX`, so
    // the floor lands on the full `MIN_FAN_PX` and the "never on top of the
    // owner" guarantee holds unconditionally.
    const floorM = Math.min(wantM, MIN_FAN_PX * metersPerPx);
    const radiusM = Math.max(Math.min(wantM, fanCapMeters(center, zones)), floorM);

    others.forEach((p, i) => {
      // Start at the top and go clockwise.
      const angle = (2 * Math.PI * i) / others.length - Math.PI / 2;
      placed.set(p.key, {
        position: offsetByMeters(center, -radiusM * Math.sin(angle), radiusM * Math.cos(angle)),
        anchor: center,
        crowded: true,
      });
    });
  }

  return { placed, clusters };
}
