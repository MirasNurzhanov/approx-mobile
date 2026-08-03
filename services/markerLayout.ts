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
 * The hard ceiling on how far the fan may move a marker.
 *
 * The fan is sized in pixels, which is what keeps it legible at every zoom —
 * but a pixel is worth more metres the further you zoom out, so left uncapped
 * the same 39 px nudge becomes a kilometre. Two things break at that point: the
 * marker stops describing where its owner is, and anyone standing inside a
 * sound zone gets pushed outside the circle they are audibly within.
 *
 * So the fan is capped, and when the cap leaves too little room to separate a
 * pile, the pile is drawn as a count instead. Zooming out therefore trades
 * individuals for a number rather than for a fiction.
 */
export const FAN_MAX_M = 80;

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
   *  a cluster — its owner must not also be drawn. */
  placed: Map<string, FanResult>;
  clusters: ClusterResult[];
}

/**
 * How far a marker at `center` may move without leaving a zone it is inside.
 *
 * A marker `d` metres from the middle of a zone of radius `R` has `R − d` to
 * spare. Being inside someone's sound zone is an audible fact, so a marker that
 * the fan pushed across the circle's edge would contradict what the user can
 * hear. Zones the point is already outside impose nothing.
 */
export function fanCapMeters(center: GeoPoint, zones: ZoneArea[]): number {
  let cap = FAN_MAX_M;
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
 * Decide where every marker goes: fanned apart, or replaced by a count.
 *
 * `metersPerPx` converts the pixel thresholds above into map distance at the
 * current zoom, so a fan separates by the same amount on screen however far in
 * you are — and zooming in shrinks how far each marker sits from the truth.
 *
 * Two rules survive every zoom level:
 *
 *  - **The owner never moves.** When a pile contains them they keep their real
 *    position and everyone else rings around it. Your own marker is the one
 *    position on this map you can check against the world outside the phone,
 *    and it is the centre of your own zone — nudging it would put your avatar
 *    off-centre inside your own circle. They are never folded into a count
 *    either: "you" is not a statistic.
 *  - **Nobody is moved further than the cap.** If separating a pile would cost
 *    more than that, the pile becomes one badge with a number on it. That is
 *    the zoomed-out case: a count is true, whereas a fan that flings people
 *    across a neighbourhood — or out of a sound zone they are standing in — is
 *    not.
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
    const capM = fanCapMeters(center, zones);

    if (wantM > capM) {
      clusters.push({
        key: badgeKey(center),
        count: others.length,
        // A badge stands for a group rather than claiming to be one person's
        // position, so moving it clear of the owner's marker costs nothing —
        // and it has to move, because the owner's marker is staying put.
        position: self ? offsetByMeters(center, SELF_CLEAR_PX * metersPerPx, 0) : center,
        anchor: self ? center : undefined,
      });
      continue;
    }

    const radiusM = wantM;
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
