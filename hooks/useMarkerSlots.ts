// Where every marker is drawn, and the fixed pools of slots the badges and
// leader lines come out of.
//
// Split out of app/(tabs)/map.tsx. The arithmetic itself has always lived in
// services/markerLayout — what moved here is the React around it: the pools,
// their high-water marks, and the render-phase growth that keeps a slot from
// ever being unmounted.
//
// Read PARKED_MARKERS in app/(tabs)/map.tsx before changing anything here. The
// short version is that react-native-maps cannot reliably remove a child from
// the native map under the New Architecture, so nothing this layout controls is
// ever unmounted — a slot with nothing to draw parks instead.
//
// ── On the `react-compiler-no-manual-memoization` findings in this file ──
// They appeared when this code moved here, not because it changed: MapScreen
// used to bail out of React Compiler entirely (a ThrowStatement inside
// try/catch, now isolated in useMapData), so its memos were invisible to the
// rule and were doing the caching themselves.
//
// They stay, on the same test earlier passes settled on: a memo whose
// *identity* feeds another hook's dependency array is load-bearing. That
// covers `musicBadgeVisible`, `markerLayout`, `drawableBadges`, `leaderLines`
// and `drawableMusicBadges` directly. The rest hand arrays to map children,
// where a fresh identity per render is the re-render this screen is least able
// to afford. Removing them is a measured change, not a cleanup — don't do it
// without the emit-diff probe.

import { useCallback, useMemo, useState } from 'react';

import type { MusicZone } from '@/hooks/useMapOverlays';
import type { NearbyUser } from '@/services/mapTypes';
import {
  isDrawable,
  layoutMarkers,
  M_PER_DEG,
  SELF_KEY,
  type FanInput,
  type GeoPoint,
  type MarkerLayout,
  type ZoneArea,
} from '@/services/markerLayout';

/** A badge is only worth drawing when the ring it labels is big enough on
 *  screen to read as a ring. Zoomed out, a 200m circle is a few pixels wide
 *  and its label would be a chip floating over nothing. */
const MIN_BADGE_PX = 24;

export interface MarkerSlots {
  markerLayout: MarkerLayout;
  /** Headcount badges, one per slot; null where the slot is parked. */
  badges: (MarkerLayout['clusters'][number] | null)[];
  badgeSlotIds: string[];
  /** Dashes from a moved marker back to where its owner really is. */
  leaders: ([GeoPoint, GeoPoint] | null)[];
  leaderSlotIds: string[];
  musicBadges: (MusicZone | null)[];
  musicBadgeSlotIds: string[];
  /** Marker position for someone, falling back to their true point before the
   *  viewport is measured on the first frame. */
  posFor: (key: string, fallback: GeoPoint) => GeoPoint;
}

export function useMarkerSlots(
  visibleNearby: NearbyUser[],
  displayCoords: GeoPoint | null,
  musicZones: MusicZone[],
  zoneAreas: ZoneArea[],
  /** Viewport, for turning the fan's pixel thresholds into map metres. */
  zoomDelta: number,
  mapH: number,
): MarkerSlots {
  const musicBadgeVisible = useCallback((radius: number) => {
    const metersPerPx = mapH > 0 ? (zoomDelta * M_PER_DEG) / mapH : 0;
    return metersPerPx > 0 && radius / metersPerPx >= MIN_BADGE_PX;
  }, [mapH, zoomDelta]);

  /**
   * Where every marker is drawn, and which piles became a count instead.
   *
   * The owner is in the input so a pile containing them is recognised as theirs:
   * they stay put and the pile opens up around them. Before the viewport has
   * been measured this is empty, and everyone falls back to their true point —
   * which is exactly the old behaviour, so the first frame is never wrong.
   */
  const markerLayout = useMemo<MarkerLayout>(() => {
    // latitudeDelta spans the viewport's height, so this is metres per pixel.
    const metersPerPx = mapH > 0 ? (zoomDelta * M_PER_DEG) / mapH : 0;
    if (metersPerPx <= 0) return { placed: new Map(), clusters: [] };

    const points: FanInput[] = [];
    if (displayCoords) {
      points.push({ key: SELF_KEY, latitude: displayCoords.latitude, longitude: displayCoords.longitude });
    }
    for (const u of visibleNearby) {
      if (u.latitude == null || u.longitude == null) continue;
      points.push({ key: `u-${u.id}`, latitude: u.latitude, longitude: u.longitude });
    }
    return layoutMarkers(points, metersPerPx, zoneAreas);
  }, [visibleNearby, displayCoords, zoomDelta, mapH, zoneAreas]);

  /** Badges and leader lines the map is currently holding open.
   *
   * Both come and go with the zoom, and neither may be unmounted to do it — see
   * `PARKED_MARKERS`. So each renders from a fixed run of slots, and the run
   * only ever grows: a slot with nothing to draw parks rather than leaving.
   * The high-water marks are state rather than refs: they are read back while
   * rendering to size the run, and a ref read during render is what stops the
   * compiler optimising this screen. Raising one during render re-runs this
   * component before anything is painted, and since a mark only ever grows —
   * bounded by the piles a screen can hold — it settles in one extra pass. */
  const [badgeSlots, setBadgeSlots] = useState(0);
  const [leaderSlots, setLeaderSlots] = useState(0);

  /** Badge, or nothing, for each slot. Drawable filter first, so an unusable
   *  coordinate parks its slot instead of shifting every badge after it. */
  const drawableBadges = useMemo(
    () => markerLayout.clusters.filter((c) => isDrawable(c.position)),
    [markerLayout],
  );
  if (drawableBadges.length > badgeSlots) setBadgeSlots(drawableBadges.length);
  const badges = useMemo(
    () => Array.from({ length: badgeSlots }, (_, i) => drawableBadges[i] ?? null),
    [drawableBadges, badgeSlots],
  );
  // A slot's identity, not its content: slot 3 is always "badge-slot-3" for
  // the life of the screen, whichever cluster (or none) currently occupies
  // it. The pool only grows, so this never reassigns an id already handed
  // out — the property `key` actually needs, which the slot's own array
  // position happens to also satisfy but does not make legible as one.
  const badgeSlotIds = useMemo(
    () => Array.from({ length: badgeSlots }, (_, i) => `badge-slot-${i}`),
    [badgeSlots],
  );

  /** Leader lines: the dashes from a moved marker back to where its owner
   *  really is, and from a nudged badge back to the pile it counts. */
  const leaderLines = useMemo(() => {
    const lines: [GeoPoint, GeoPoint][] = [];
    // Both ends validated: a single bad coordinate in a Polyline is enough to
    // bring the native map down.
    for (const item of [...Array.from(markerLayout.placed.values()), ...markerLayout.clusters]) {
      if (item.anchor && isDrawable(item.anchor) && isDrawable(item.position)) {
        lines.push([item.anchor, item.position]);
      }
    }
    return lines;
  }, [markerLayout]);
  if (leaderLines.length > leaderSlots) setLeaderSlots(leaderLines.length);
  const leaders = useMemo(
    () => Array.from({ length: leaderSlots }, (_, i) => leaderLines[i] ?? null),
    [leaderLines, leaderSlots],
  );
  const leaderSlotIds = useMemo(
    () => Array.from({ length: leaderSlots }, (_, i) => `leader-slot-${i}`),
    [leaderSlots],
  );

  /** The same slot pool for the chips that label music zones.
   *
   * These leave the map for a reason the others do not: someone switching their
   * music zone off. The ring is a Circle and goes cleanly, but the chip is a
   * Marker wrapping a custom view — the one shape Fabric strands — so an
   * unmounted chip would sit on the native map naming a zone that no longer
   * exists. Pooled, it parks instead, and the switch removes both halves. */
  const [musicBadgeSlots, setMusicBadgeSlots] = useState(0);
  const drawableMusicBadges = useMemo(
    () => musicZones.filter((z) => musicBadgeVisible(z.radius) && isDrawable(z.center)),
    [musicZones, musicBadgeVisible],
  );
  if (drawableMusicBadges.length > musicBadgeSlots) setMusicBadgeSlots(drawableMusicBadges.length);
  const musicBadges = useMemo(
    () => Array.from({ length: musicBadgeSlots }, (_, i) => drawableMusicBadges[i] ?? null),
    [drawableMusicBadges, musicBadgeSlots],
  );
  const musicBadgeSlotIds = useMemo(
    () => Array.from({ length: musicBadgeSlots }, (_, i) => `music-badge-slot-${i}`),
    [musicBadgeSlots],
  );

  const posFor = useCallback(
    (key: string, fallback: GeoPoint): GeoPoint =>
      markerLayout.placed.get(key)?.position ?? fallback,
    [markerLayout],
  );

  return {
    markerLayout,
    badges,
    badgeSlotIds,
    leaders,
    leaderSlotIds,
    musicBadges,
    musicBadgeSlotIds,
    posFor,
  };
}
