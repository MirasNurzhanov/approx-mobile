// The map canvas and the layers drawn on it: zones, people, stories, meetups and
// pinned places. Presentational: the screen passes everything in. Moved out of
// app/(tabs)/map.tsx unchanged.

import { useMemo, useState, type ReactNode } from 'react';
import MapView, { Circle, Polygon, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { mapStyleFor } from '@/constants/mapStyle';
import {
    isDrawable,
    SELF_KEY,
    type ClusterResult,
    type GeoPoint,
    type MarkerLayout,
} from '@/services/markerLayout';
import { withAlpha } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { MotionTrail } from '@/components/MotionTrail';
import { type MapOverlays, type MusicZone } from '@/hooks/useMapOverlays';
import { type MarkerSlots } from '@/hooks/useMarkerSlots';
import { useMotionTrails } from '@/hooks/useMotionTrails';
import {
    type PinnedPlace,
} from '@/services/pinnedPlaces';
import type { Story } from '@/services/stories';
import type {
    ClubMeetup,
    NearbyUser,
    SelfZone,
} from '@/services/mapTypes';

import { APPROX_RADIUS_M } from '@/components/map/mapConstants';
import { type MapStyles } from '@/components/map/mapStyles';
import { SelfMarker, MusicZoneBadge, ClusterMarker, StoryMarker, MeetupMarker, PinnedMarker, PersonMarker } from '@/components/map/MapMarkers';

// ─── Constants ────────────────────────────────────────────────────────────────
// Ring colour carries the relationship, and nothing else does: blue is a
// friend, orange is a connection, teal is a matched stranger. One colour per
// state, used on the marker, in the sheet and on the zone.
// COLOR_FRIEND / COLOR_CONNECTED / COLOR_STRANGER are computed inside
// `PeopleLayer` from the dynamic theme — see below.

/**
 * Every pin, out of a slot pool that grows and never shrinks.
 *
 * `liveMeetupIds` is what stops a meetup the viewer is going to being drawn
 * twice while it is still on the map in its own right: `MeetupMarker` keeps
 * that one and wears the bookmark corner. The pin appears here the moment the
 * event drops out of the nearby feed — which is the case this feature is for,
 * since a meetup you are travelling to is by definition not near you yet.
 */
function PinnedLayer({ places, liveMeetupIds, parkedAt, colors, onOpenPin }: {
  places: PinnedPlace[];
  liveMeetupIds: Set<number>;
  parkedAt: GeoPoint;
  colors: ColorPalette;
  onOpenPin: (place: PinnedPlace) => void;
}) {
  const [slotCount, setSlotCount] = useState(0);

  const drawable = useMemo(
    () => places.filter(
      (p) => isDrawable(p) && !(p.kind === 'meetup' && liveMeetupIds.has(p.source_id)),
    ),
    [places, liveMeetupIds],
  );
  if (drawable.length > slotCount) setSlotCount(drawable.length);

  const slots = useMemo(
    () => Array.from({ length: slotCount }, (_, i) => drawable[i] ?? null),
    [drawable, slotCount],
  );
  // Slot identity, not content: slot 3 is "pin-slot-3" for the life of the
  // screen, whichever pin (or none) is currently in it. Same rule as the
  // headcount badges — see hooks/useMarkerSlots.
  const slotIds = useMemo(
    () => Array.from({ length: slotCount }, (_, i) => `pin-slot-${i}`),
    [slotCount],
  );

  return (
    <>
      {/* A Swift whose creator shares an approximate position was snapped to a
          ~500m cell before it was ever stored, so the pin marks a cell and the
          circle says so. Circles leave the native map cleanly, unlike the
          markers above them, so these are not pooled. */}
      {drawable.reduce<ReactNode[]>((circles, place) => {
        if (place.precision === 'approximate') {
          circles.push(
            <Circle
              key={`pin-approx-${place.id}`}
              center={{ latitude: place.latitude, longitude: place.longitude }}
              radius={APPROX_RADIUS_M}
              fillColor={withAlpha(colors.teal, 0.10)}
              strokeColor={withAlpha(colors.teal, 0.45)}
              strokeWidth={1}
            />,
          );
        }
        return circles;
      }, [])}

      {slots.map((place, i) => (
        <PinnedMarker
          key={slotIds[i]}
          place={place}
          parkedAt={parkedAt}
          parked={!place}
          onPress={onOpenPin}
        />
      ))}
    </>
  );
}

// ─── Map layers ───────────────────────────────────────────────────────────────
/*
 * The three groups of children the map draws, in draw order: the circles
 * underneath, the people standing in them, and the pins for things rather than
 * people. Split out of the screen's own `return` because that return had grown
 * past the point where the order was legible — which is the one property this
 * JSX has to make obvious, since every z-index on this map is decided by it.
 *
 * Each is a plain function returning a fragment, so the children the native map
 * receives are exactly the ones it received before: same elements, same keys,
 * same order. That matters more here than anywhere else in the app — see
 * PARKED_MARKERS.
 */

/** Circles: music rings, the viewer's own zone, and the chips that name them. */
function ZoneLayer({
  musicZones, musicBadges, musicBadgeSlotIds, selfZone, selfZoneRings, displayCoords, colors,
}: {
  musicZones: MusicZone[];
  musicBadges: (MusicZone | null)[];
  musicBadgeSlotIds: string[];
  selfZone: SelfZone | null;
  selfZoneRings: GeoPoint[][];
  displayCoords: GeoPoint;
  colors: ColorPalette;
}) {
  return (
    <>
      {/* Other people's detection zones are deliberately not drawn.
          A zone is a radar: it decides who *its owner* can find. Seeing a
          stranger's radar tells you nothing you can act on — you are on it
          or you are not, and either way the answer is already the fact that
          they are on your screen. What it did do was fill the map with
          overlapping teal circles, one per person, until the only thing
          legible was the circles.
          Your own zone is below, because that one is a tool: it is the
          reach you are tuning when you change its size. And music zones
          stay, because those answer a question you can act on — walk
          inside one and you can hear what is playing. */}

      {/* Music zones. Someone else's ring is drawn when the viewer is
          allowed to hear their track; the viewer's own whenever they have
          a music zone switched on — see `selfMusicZoneRing`. A ring means
          "the music stops here", so a zone that has been switched off has
          no ring, on the owner's map or anyone else's.
          A hairline and nothing else. What identifies it as *music* is the
          badge on its edge, not the stroke — the map already has circles in
          this colour, and shouting with opacity would only have made a
          louder anonymous ring. Not dashed either: `lineDashPattern` on a
          Circle is Apple-Maps-only and this map is PROVIDER_GOOGLE, so the
          dashes would silently never appear. */}
      {/* Colours come from the palette, not from literals.
          Somebody else's ring used to be a hardcoded rgba(31,199,182) —
          the *dark* theme's teal — so on the light map it stayed a pale
          teal thread over a near-white basemap and simply could not be
          seen. The light palette answers `teal` with a strong orange, the
          same colour those people's markers already use, so taking the hue
          from `colors` fixes the contrast and makes the ring match the dots
          it belongs to. Dark mode is unchanged. */}
      {musicZones.map(({ key, center, radius, color }) => (
        <Circle
          key={key}
          center={center}
          radius={radius}
          fillColor="transparent"
          strokeColor={withAlpha(color, 0.6)}
          strokeWidth={1.5}
        />
      ))}

      {/* Own zone.
          One polygon per *piece*, not per ring: a region straddling the
          ±180 meridian is cut in two there, so it draws as the island group
          it is instead of as a band stretched around the planet. Regions
          that do not cross come back as a single piece, unchanged. */}
      {selfZone?.zone_active && selfZone.zone_mode === 'region' && selfZone.zone_region_id
        ? selfZoneRings.map((piece) => (
            <Polygon
              // Keyed on where the piece starts: the split is deterministic,
              // so a piece keeps its identity until the region itself moves.
              key={`self-zone-${piece[0].latitude},${piece[0].longitude}`}
              coordinates={piece}
              fillColor={withAlpha(colors.purple, 0.05)}
              strokeColor={withAlpha(colors.purple, 0.35)}
              strokeWidth={1.5}
            />
          ))
        : selfZone?.zone_active && (selfZone.zone_radius ?? 0) > 0 && (
          <Circle
            center={displayCoords}
            radius={selfZone.zone_radius}
            fillColor={withAlpha(colors.purple, 0.07)}
            strokeColor={withAlpha(colors.purple, 0.35)}
            strokeWidth={1.5}
          />
        )}

      {/* The chip that says which ring is which — literally, now: a
          friend's ring is labelled with their @name and drawn in their own
          colour, so two overlapping circles are two people rather than one
          anonymous smudge. Drawn after every circle so it sits on top of
          them, and skipped when the ring is too small on screen for a label
          to mean anything. Your own is included: where your music stops is
          the one thing you cannot check by listening.
          Slotted, and a spare slot goes transparent rather than unmounting
          — see PARKED_MARKERS. A zone switched off has to take its chip
          with its circle, and an unmounted Marker does not reliably go. */}
      {musicBadges.map((z, i) => (
        <MusicZoneBadge
          key={musicBadgeSlotIds[i]}
          center={z?.center ?? displayCoords}
          radius={z?.radius ?? 0}
          mine={z?.mine}
          label={z?.label ?? ''}
          color={z?.color ?? colors.purple}
          parked={!z}
        />
      ))}
    </>
  );
}

/** People: the approximate haze, their trails, the fan's leader lines, the
 *  markers themselves, the headcounts that stand in for a pile, and you. */
function PeopleLayer({
  visibleNearby, motionTrails, reduceMotion, leaders, leaderSlotIds, markerLayout,
  badges, badgeSlotIds, friendIds, connectionIds, colors, displayCoords, selfProfile,
  ghost, posFor, onOpenSheet, onZoomToCluster,
}: {
  visibleNearby: NearbyUser[];
  motionTrails: ReturnType<typeof useMotionTrails>;
  reduceMotion: boolean;
  leaders: ([GeoPoint, GeoPoint] | null)[];
  leaderSlotIds: string[];
  markerLayout: MarkerLayout;
  badges: (ClusterResult | null)[];
  badgeSlotIds: string[];
  friendIds: Set<number>;
  connectionIds: Set<number>;
  colors: ColorPalette;
  displayCoords: GeoPoint;
  selfProfile: { username: string; profile_picture?: string } | null;
  ghost: boolean | null | undefined;
  posFor: (key: string, fallback: GeoPoint) => GeoPoint;
  onOpenSheet: (user: NearbyUser) => void;
  onZoomToCluster: (center: GeoPoint) => void;
}) {
  // Ring colour carries the relationship, and nothing else does.
  const COLOR_FRIEND    = colors.blue;
  const COLOR_CONNECTED = colors.orange;
  const COLOR_STRANGER  = colors.teal;

  return (
    <>
      {/* Approximate sharers get a haze instead of a precise-looking pin —
          the marker would otherwise imply accuracy the data doesn't have. */}
      {visibleNearby.reduce<ReactNode[]>((circles, u) => {
        if (u.location_precision === 'approximate' && u.latitude != null && u.longitude != null) {
          circles.push(
            <Circle
              key={`approx-${u.id}`}
              center={{ latitude: u.latitude, longitude: u.longitude }}
              radius={APPROX_RADIUS_M}
              fillColor={withAlpha(colors.t1, 0.06)}
              strokeColor={withAlpha(colors.t1, 0.18)}
              strokeWidth={1}
            />,
          );
        }
        return circles;
      }, [])}

      {/* Speed trails, drawn before the markers so they sit underneath and
          read as something the avatar is leaving behind. Only ever built
          from positions already observed — never extrapolated ahead of the
          last known point, which on a 10s poll is already stale. */}
      {Array.from(motionTrails.entries()).map(([id, path]) => (
        <MotionTrail key={`trail-${id}`} path={path} reduceMotion={reduceMotion} />
      ))}

      {/* Leader lines back to the spot a moved marker really occupies.
          Without them the fan would quietly claim that people sitting at
          one table are tens of metres apart. Drawn under the markers.
          Slotted, and a spare slot collapses onto the owner's own point in
          full transparency rather than unmounting — see PARKED_MARKERS. */}
      {leaders.map((line, i) => (
        <Polyline
          key={leaderSlotIds[i]}
          coordinates={line ?? [displayCoords, displayCoords]}
          strokeColor={line ? withAlpha(colors.t1, 0.28) : 'transparent'}
          strokeWidth={1}
          lineDashPattern={[3, 3]}
          zIndex={2}
        />
      ))}

      {visibleNearby.filter((u) => u.latitude != null && u.longitude != null).map((user) => {
        const uid = Number(user.id);
        const isFriend = friendIds.has(uid);
        const isConnected = connectionIds.has(uid);
        return (
          <PersonMarker
            key={user.id}
            user={user}
            layout={markerLayout.placed.get(`u-${user.id}`)}
            isFriend={isFriend}
            isConnected={isConnected}
            color={isFriend ? COLOR_FRIEND : isConnected ? COLOR_CONNECTED : COLOR_STRANGER}
            onPress={() => onOpenSheet(user)}
          />
        );
      })}

      {/* No self-fuzz circle any more. It existed to stop an Approximate
          sharer being shown a precise dot they had asked us not to publish;
          precision is the viewer's relationship now, the owner is always on
          the precise side of it, and a circle here would describe a
          blurring that no longer applies to them. What a stranger sees is
          drawn on the stranger's map, from the cell the server sends. */}

      {/* Piles that could not be fanned apart without moving someone too far
          — which is what zooming out does to a pixel-sized fan. A number
          instead, and a tap to go in and see who.
          Slots, not badges: zooming back in empties a slot rather than
          removing it, because a removed badge is the one that stayed on the
          map on top of the faces it had been standing in for. An empty slot
          parks on the owner's own point, where it is invisible, one pixel
          wide and deaf to taps. See PARKED_MARKERS. */}
      {badges.map((cluster, i) => (
        <ClusterMarker
          key={badgeSlotIds[i]}
          coordinate={cluster ? cluster.position : displayCoords}
          count={cluster ? cluster.count : 0}
          parked={!cluster}
          onPress={cluster ? () => onZoomToCluster(cluster.anchor ?? cluster.position) : undefined}
        />
      ))}

      {/* Never moved, and never folded into a count. When someone stands
          where you stand, they are the one who gets fanned aside — so this
          marker, and the zone centred on it, stay exactly where you are. */}
      <SelfMarker
        coordinate={posFor(SELF_KEY, displayCoords)}
        // The same point, moved continuously rather than in ten-metre hops —
        // see services/positionSmoothing. Passed alongside the laid-out
        // coordinate rather than replacing it so that the layout stays the
        // authority on *where* this marker belongs (it is the one marker that
        // is never fanned aside) while the smoother decides only how it gets
        // there. Subscribed inside SelfMarker, so a new interpolated position
        // re-renders one marker and not this whole layer.
        uri={selfProfile?.profile_picture}
        username={selfProfile?.username ?? ''}
        // Drawn muted while Paused, because the owner's own marker is the
        // only thing on this screen that could be read as "this is what
        // everyone else sees". While paused it is not — nobody sees it —
        // and the map should say so where the question is being asked.
        hidden={ghost === true}
      />
    </>
  );
}

/** Pins for things rather than people: story bubbles, club meetups, and the
 *  places the viewer saved for themselves. */
function PinsLayer({
  storiesByAuthor, clubMeetups, pinnedPlaces, displayCoords, colors,
  onOpenStories, onOpenMeetup, onOpenPin,
}: {
  storiesByAuthor: Map<number, Story[]>;
  clubMeetups: ClubMeetup[];
  pinnedPlaces: PinnedPlace[];
  /** Where an empty pin slot parks — see `PinnedMarker`. */
  displayCoords: GeoPoint;
  colors: ColorPalette;
  onOpenStories: (stories: Story[]) => void;
  onOpenMeetup: (meetup: ClubMeetup) => void;
  onOpenPin: (place: PinnedPlace) => void;
}) {
  /** Which meetups are on the map in their own right, so `PinnedLayer` can
   *  leave those to `MeetupMarker` instead of stacking a second pin on them. */
  const liveMeetupIds = useMemo(
    () => new Set(clubMeetups.map((m) => m.id)),
    [clubMeetups],
  );
  /** And which of them the viewer is going to, which is what puts the bookmark
   *  corner on the meetup's own marker. */
  const goingMeetupIds = useMemo(
    () => new Set(
      pinnedPlaces.reduce<number[]>((ids, p) => {
        if (p.kind === 'meetup') ids.push(p.source_id);
        return ids;
      }, []),
    ),
    [pinnedPlaces],
  );

  return (
    <>
      {/* `isDrawable` as well as the numeric coercion at the boundary: the
          two answer different questions. services/coords.ts guarantees a
          real coordinate; this guarantees one Google's Mercator projection
          can actually place, which stops above ±85°. People's markers have
          always been filtered this way — stories and meetups were not, and
          were the two that could reach the native map unchecked. */}
      {Array.from(storiesByAuthor).reduce<ReactNode[]>((markers, [authorId, authorStories]) => {
        if (isDrawable(authorStories[0])) {
          // Keyed by author alone. It used to include the newest story id
          // as well, to force a remount so a fresh story could not reuse a
          // stale frozen snapshot — but StoryMarker already re-arms
          // `tracksViewChanges` off that same id, so the remount bought
          // nothing and cost a ghost: an unmounted marker never leaves the
          // native map (see `PARKED_MARKERS`), so posting a story left the
          // previous bubble behind next to the new one.
          markers.push(
            <StoryMarker
              key={`story-author-${authorId}`}
              stories={authorStories}
              onPress={() => onOpenStories(authorStories)}
            />,
          );
        }
        return markers;
      }, [])}

      {/* Approved club meetup pins — one per event, above story bubbles. */}
      {clubMeetups.reduce<ReactNode[]>((markers, meetup) => {
        if (isDrawable(meetup)) {
          markers.push(
            <MeetupMarker
              key={`meetup-${meetup.id}`}
              meetup={meetup}
              pinned={goingMeetupIds.has(meetup.id)}
              onPress={() => onOpenMeetup(meetup)}
            />,
          );
        }
        return markers;
      }, [])}

      <PinnedLayer
        places={pinnedPlaces}
        liveMeetupIds={liveMeetupIds}
        parkedAt={displayCoords}
        colors={colors}
        onOpenPin={onOpenPin}
      />
    </>
  );
}

// ─── Map surface ──────────────────────────────────────────────────────────────
/**
 * The map itself and everything drawn on it, as opposed to over it.
 *
 * `overlays` and `slots` arrive as whole hook results rather than unpacked into
 * twenty props. That is not just brevity: the slot pools only mean anything as
 * a set — a badge and its id come from the same run, and splitting them across
 * a prop list is how they get to disagree. See PARKED_MARKERS.
 */
export function MapCanvas({
  mapRef, styles, themeMode, region, displayCoords, colors,
  overlays, slots, visibleNearby, motionTrails, reduceMotion,
  friendIds, connectionIds, selfProfile, selfZone, ghost,
  storiesByAuthor, clubMeetups, pinnedPlaces,
  onMapLayout, onRegionChangeComplete, onPanDrag, onLongPress,
  onOpenSheet, onZoomToCluster, onOpenStories, onOpenMeetup, onOpenPin,
}: {
  mapRef: React.RefObject<MapView | null>;
  styles: MapStyles;
  themeMode: string;
  region: Region | undefined;
  displayCoords: GeoPoint;
  colors: ColorPalette;
  overlays: MapOverlays;
  slots: MarkerSlots;
  visibleNearby: NearbyUser[];
  motionTrails: ReturnType<typeof useMotionTrails>;
  reduceMotion: boolean;
  friendIds: Set<number>;
  connectionIds: Set<number>;
  selfProfile: { username: string; profile_picture?: string } | null;
  selfZone: SelfZone | null;
  ghost: boolean | null | undefined;
  storiesByAuthor: Map<number, Story[]>;
  clubMeetups: ClubMeetup[];
  pinnedPlaces: PinnedPlace[];
  onMapLayout: (height: number) => void;
  onRegionChangeComplete: (region: Region) => void;
  onPanDrag: () => void;
  onLongPress: () => void;
  onOpenSheet: (user: NearbyUser) => void;
  onZoomToCluster: (center: GeoPoint) => void;
  onOpenStories: (stories: Story[]) => void;
  onOpenMeetup: (meetup: ClubMeetup) => void;
  onOpenPin: (place: PinnedPlace) => void;
}) {
  return (
    <MapView
      ref={mapRef}
      onLayout={(e) => onMapLayout(e.nativeEvent.layout.height)}
      style={styles.map}
      provider={PROVIDER_GOOGLE}
      customMapStyle={mapStyleFor(themeMode)}
      initialRegion={region}
      showsUserLocation={false}
      showsMyLocationButton={false}
      rotateEnabled={false}
      pitchEnabled={false}
      // Dragging the map is the user taking the camera back. Follow mode
      // drops out rather than fighting the gesture and snapping away from
      // wherever they just moved to. Pinch-zoom is not a pan, so zooming
      // in on yourself keeps following, the way it does in Google Maps.
      onPanDrag={onPanDrag}
      onRegionChangeComplete={onRegionChangeComplete}
      onLongPress={onLongPress}
    >
      <ZoneLayer
        musicZones={overlays.musicZones}
        musicBadges={slots.musicBadges}
        musicBadgeSlotIds={slots.musicBadgeSlotIds}
        selfZone={selfZone}
        selfZoneRings={overlays.selfZoneRings}
        displayCoords={displayCoords}
        colors={colors}
      />

      <PeopleLayer
        visibleNearby={visibleNearby}
        motionTrails={motionTrails}
        reduceMotion={reduceMotion}
        leaders={slots.leaders}
        leaderSlotIds={slots.leaderSlotIds}
        markerLayout={slots.markerLayout}
        badges={slots.badges}
        badgeSlotIds={slots.badgeSlotIds}
        friendIds={friendIds}
        connectionIds={connectionIds}
        colors={colors}
        displayCoords={displayCoords}
        selfProfile={selfProfile}
        ghost={ghost}
        posFor={slots.posFor}
        onOpenSheet={onOpenSheet}
        onZoomToCluster={onZoomToCluster}
      />

      <PinsLayer
        storiesByAuthor={storiesByAuthor}
        clubMeetups={clubMeetups}
        pinnedPlaces={pinnedPlaces}
        displayCoords={displayCoords}
        colors={colors}
        onOpenStories={onOpenStories}
        onOpenMeetup={onOpenMeetup}
        onOpenPin={onOpenPin}
      />
    </MapView>
  );
}
