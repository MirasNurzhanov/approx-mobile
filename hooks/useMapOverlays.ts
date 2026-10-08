// Everything the map draws *under* its markers: zone outlines, music rings,
// and the one notice that admits the basemap is shifted.
//
// Split out of app/(tabs)/map.tsx, which had grown to the point where the
// screen's own control flow was unreadable. Nothing here changed in the move —
// these are the same four derivations in the same order, still deriving during
// render rather than syncing through effects. The single effect is a fetch,
// which is the one thing on this list that genuinely reaches outside React.
//
// It stays a hook rather than becoming pure functions because the region
// outlines it needs arrive asynchronously and have to trigger a re-render when
// they land: the geometry is ~1500 points per region, the nearby payload
// carries only ids, and a hundred people sharing a city cost one request
// between them.
//
// The `react-compiler-no-manual-memoization` findings here are the same
// relocation artefact described at the top of hooks/useMarkerSlots, and the
// same verdict: `neededRegionIds` and `musicZones` feed the dependency arrays
// of the effect and the derivation below them, so their identity is the thing
// doing the work.

import { useEffect, useMemo, useState } from 'react';

import { zoneRingColor } from '@/constants/theme';
import { isInMainlandChina } from '@/services/gcj02';
import type { GeoPoint, ZoneArea } from '@/services/markerLayout';
import type { NearbyUser, SelfZone } from '@/services/mapTypes';
import { fmtRadius } from '@/services/zoneAudio';
import { getRegion, ringsForDisplay, type Region as ZoneRegion } from '@/services/zoneArea';

/** A circle on the map that says where somebody's music stops.
 *
 * `label` and `color` are what make one ring tellable from another. Drawn in a
 * single colour with only a radius on the chip, two friends broadcasting near
 * each other were two identical circles: you could see that somebody's music
 * reached here, but not whose. */
export interface MusicZone {
  key: string;
  center: GeoPoint;
  radius: number;
  mine?: boolean;
  label: string;
  color: string;
}

/**
 * The radius of the viewer's own music-zone ring, or null for no ring.
 *
 * The same two conditions everyone else's ring gets, which is the point: what
 * the owner sees is what a friend standing next to them sees.
 *
 *  1. Is the music zone switched on? That switch is the whole feature now — on
 *     draws the circle, off removes it from this map and every other one.
 *  2. Is there a track? A music zone with nothing loaded is audible to nobody,
 *     and a ring around it would be marking the reach of silence. It also
 *     matters that the switch defaults to *on*: without this, everyone who has
 *     never opened Zone Music would find a circle around themselves for a
 *     feature they are not using.
 *
 * Not gated on `zone_active` or `zone_mode`. The map zone is a different
 * circle, drawn separately and answering a different question; the music zone
 * is always its own radius, never a city border it inherited.
 */
function selfMusicZoneRing(zone: SelfZone | null): number | null {
  if (!zone?.music_zone_active) return null;
  if (!zone.has_track) return null;
  if (!(zone.music_zone_radius > 0)) return null;
  return zone.music_zone_radius;
}

export interface MapOverlays {
  /** The viewer's own region zone, cut into drawable pieces. Empty unless they
   *  are in region mode and the outline has landed. */
  selfZoneRings: GeoPoint[][];
  /** Truthy while the viewer stands where the basemap disagrees with GPS. */
  chinaOffsetNotice: boolean | null;
  musicZones: MusicZone[];
  /** Every circle the eye can see, for the marker fan to be held inside. */
  zoneAreas: ZoneArea[];
}

export function useMapOverlays(
  visibleNearby: NearbyUser[],
  selfZone: SelfZone | null,
  displayCoords: GeoPoint | null,
  /** Purple, from the live palette: "yours" everywhere else on the map. */
  selfRingColor: string,
): MapOverlays {
  /** Outlines for every region zone currently on screen.
   *
   * The nearby payload carries region *ids*; the geometry is fetched once per
   * region and cached across sessions, so a hundred people sharing a city cost
   * one request between them. Held in state rather than read straight from the
   * cache because a fetch that lands must trigger a re-render — otherwise the
   * outline arrives and nothing draws it until the next unrelated poll. */
  const [regionOutlines, setRegionOutlines] = useState<Map<number, ZoneRegion>>(new Map());

  const neededRegionIds = useMemo(() => {
    const ids = new Set<number>();
    if (selfZone?.zone_active && selfZone.zone_mode === 'region' && selfZone.zone_region_id) {
      ids.add(selfZone.zone_region_id);
    }
    for (const u of visibleNearby) {
      if (u.zone_active && u.zone_mode === 'region' && u.zone_region_id) ids.add(u.zone_region_id);
    }
    return ids;
  }, [visibleNearby, selfZone]);

  useEffect(() => {
    let alive = true;
    const missing = [...neededRegionIds].filter((id) => !regionOutlines.has(id));
    if (missing.length === 0) return;

    Promise.all(missing.map((id) => getRegion(id))).then((fetched) => {
      if (!alive) return;
      const landed = fetched.filter((r): r is ZoneRegion => r != null);
      if (landed.length === 0) return;
      setRegionOutlines((prev) => {
        const next = new Map(prev);
        for (const r of landed) next.set(r.id, r);
        return next;
      });
    });
    return () => { alive = false; };
  }, [neededRegionIds, regionOutlines]);

  /** The viewer's own zone outline, cut into drawable pieces.
   *
   * No mainland-China display shift here, unlike the zone-area preview: this
   * map draws markers, clusters, trails and circles from the same coordinates,
   * and shifting only the polygon would put your zone's border in the right
   * street while leaving your own dot in the wrong one. That trade is worse
   * than a uniform offset, because "am I inside it?" is the single question
   * the outline exists to answer. See services/gcj02 and `chinaOffsetNotice`. */
  const selfZoneRings = useMemo(() => {
    const id = selfZone?.zone_region_id;
    if (!selfZone?.zone_active || selfZone.zone_mode !== 'region' || !id) return [];
    const outline = regionOutlines.get(id);
    return outline ? ringsForDisplay(outline) : [];
  }, [selfZone, regionOutlines]);

  /** Set once the viewer is standing where the basemap disagrees with GPS.
   *
   * Google serves GCJ-02 tiles inside mainland China while everything Approx
   * measures is WGS-84, so the two are a few hundred metres apart. Saying so
   * beats drawing a zone that silently sits in the wrong street. */
  const chinaOffsetNotice = useMemo(
    () =>
      displayCoords &&
      isInMainlandChina(displayCoords.latitude, displayCoords.longitude),
    [displayCoords],
  );

  /** Every music zone on screen — the viewer's own, and each friend whose
   *  track they are allowed to hear. Assembled once so the faint ring, the
   *  badge that labels it and the fan constraint below can never disagree
   *  about which circles exist. */
  const musicZones = useMemo(() => {
    const zones: MusicZone[] = [];
    // Your own ring, on the same terms as everyone else's: a track, and a music
    // zone switched on to carry it. Off takes the circle off your map exactly
    // as it takes it off theirs — there is no zone left for it to mark.
    //
    // Independent of `zone_active`, which removes the circle you appear inside
    // and says nothing about sound. These are two different circles.
    const selfRadius = selfMusicZoneRing(selfZone);
    if (displayCoords && selfRadius) {
      zones.push({
        key: 'music-self',
        center: displayCoords,
        radius: selfRadius,
        mine: true,
        // Yours says how far it carries, not who it is — you know who you are,
        // and where your own music stops is the one thing you cannot check by
        // listening. Purple means "yours" everywhere else on the map.
        label: fmtRadius(selfRadius),
        color: selfRingColor,
      });
    }
    for (const u of visibleNearby) {
      // `zone_audio_url` is the real switch: no track, no ring to label. The
      // server only sends it to viewers allowed to hear it, so a ring drawn
      // here is always one the viewer could walk into and play.
      if (!(u.music_zone_radius ?? 0) || !u.zone_audio_url) continue;
      if (u.latitude == null || u.longitude == null) continue;
      // `zone_mode` is not consulted. A music zone is always its own circle,
      // never a city border inherited from the map zone, so a region-mode
      // friend's ring is as honest as anyone else's.
      zones.push({
        key: `music-${u.id}`,
        center: { latitude: u.latitude, longitude: u.longitude },
        radius: u.music_zone_radius!,
        // Only friends are ever drawn here — the server withholds
        // `zone_audio_url` from everyone else — so naming them reveals nothing
        // their marker does not already caption.
        label: `@${u.username}`,
        color: zoneRingColor(u.username),
      });
    }
    return zones;
  }, [visibleNearby, displayCoords, selfZone, selfRingColor]);

  /**
   * Every circle the eye can see, so the fan can be held inside them.
   *
   * This constraint exists to stop a marker being displaced out of a circle it
   * is standing in, which is only ever a lie about a boundary the viewer can
   * *see* — so the list is exactly the circles that get drawn, taken from
   * `musicZones` rather than recomputed. They used to be two independent
   * conditions and they had already drifted apart: this one asked whether the
   * music zone was separate where the drawing asked for `zone_audio_url`, so
   * it constrained rings that were not on screen and ignored ones that were.
   *
   * Region zones are deliberately absent. The fan is capped at tens of metres
   * and no displacement that small can move anyone out of a city, so a polygon
   * has nothing to constrain here.
   */
  const zoneAreas = useMemo<ZoneArea[]>(() => {
    const areas: ZoneArea[] = [];
    if (
      displayCoords && selfZone?.zone_active &&
      selfZone.zone_mode === 'radius' && (selfZone.zone_radius ?? 0) > 0
    ) {
      areas.push({ ...displayCoords, radius: selfZone.zone_radius });
    }
    // Other people's detection zones are not drawn, so they are not here: an
    // undrawn circle has no boundary to be flung across.
    for (const { center, radius } of musicZones) {
      areas.push({ ...center, radius });
    }
    return areas;
  }, [musicZones, displayCoords, selfZone]);

  return { selfZoneRings, chinaOffsetNotice, musicZones, zoneAreas };
}
