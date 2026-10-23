import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    Text,
    View,
} from 'react-native';
import { type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector } from 'react-native-gesture-handler';
import { ApproxNav } from '@/components/ApproxNav';
import { StoryTutorialOverlay } from '@/components/tutorial/StoryTutorialOverlay';
import { useTheme } from '@/context/ThemeContext';
import { useNavAlignedRight, useNavClearance } from '@/hooks/useNavMetrics';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { usePermissionPrimer } from '@/components/PermissionPrimer';
import { openAppSettings } from '@/services/permissions';
import { useMapData } from '@/hooks/useMapData';
import { useMapLocation } from '@/hooks/useMapLocation';
import { useMapOverlays } from '@/hooks/useMapOverlays';
import { useMapSheets } from '@/hooks/useMapSheets';
import { useMarkerSlots } from '@/hooks/useMarkerSlots';
import { useMotionTrails } from '@/hooks/useMotionTrails';
import { useStoryComposer } from '@/hooks/useStoryComposer';
import { useStoryTutorial } from '@/hooks/useStoryTutorial';
import { useVisiblePeople } from '@/hooks/useVisiblePeople';
import {
    MAX_PINS,
    pinIdFor,
    pinMeetup,
    unpinPlace,
    usePinnedPlaces,
    type PinnedPlace,
} from '@/services/pinnedPlaces';
import { useGhostMode } from '@/services/privacy';
import type {
    ClubMeetup,
} from '@/services/mapTypes';

import { LOCATE_SIZE, LOCATE_INSET } from '@/components/map/mapConstants';
import { makeStyles } from '@/components/map/mapStyles';
import { MapCanvas } from '@/components/map/MapLayers';
import { MapSheets } from '@/components/map/MapSheets';
import { LocateButton, TopBar, MapPermissionGate, MapNotices, MapToasts } from '@/components/map/MapChrome';
import { CreateStoryModal } from '@/components/map/CreateStoryModal';
import { VenueSheet } from '@/components/map/VenueSheet';
import { CheckInControl } from '@/components/map/CheckInControl';
import { useMapVenues } from '@/hooks/useMapVenues';
import type { Venue } from '@/services/venues';
import { takeVenueFocus } from '@/services/venueFocus';

// ─── Where the pieces live ────────────────────────────────────────────────────
// This file is the screen: its state, effects and the wiring between them.
// What it draws lives in components/map, split along the seams it already had:
//   MapLayers + MapMarkers   the canvas and everything on it
//   MapSheets                a person, a meetup, a pinned place
//   MapChrome                top bar, locate button, permission gate, notices, toasts
//   CreateStoryModal         the story composer
//   mapStyles, mapConstants, mapFormat   the StyleSheet, sizes and helpers they share
// The payload shapes live in services/mapTypes so the hooks can share them too.

// ─── Two things this screen deliberately no longer does ───────────────────────
/*
 * Both used to live in the middle of MapScreen, as notes about code that had
 * been taken out. They are here instead because they describe absences, and an
 * absence has no line to sit next to.
 *
 * **Nearby people do not generate alerts.** They used to, from this screen —
 * "@miras is nearby · 180m away", "@aisha shares your interests". Being
 * somewhere is not an event, and the map already shows who is around. The
 * markers are the whole of it now.
 *
 * **Zone audio is not the map's to play.** There is no screen-level sound, no
 * autoplay when you cross into someone's circle, and nothing to stop on
 * unmount: a friend's track is loaded by the player inside their card and
 * unloaded when that card closes. Walking into a zone is an invitation, not a
 * command to a stranger's phone speaker.
 */

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function MapScreen() {
  const { venues, error: venueError, retry: retryVenues } = useMapVenues();
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const { colors, themeMode } = useTheme();
  // No wrapper: now that the screen's compile-blocking code has moved into
  // `useMapData`, React Compiler caches this and every `styles.*` read off it
  // by itself — emit is byte-identical with and without a `useMemo`.
  const styles = makeStyles(colors);
  const router = useRouter();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
  const { ensure: ensurePermission, primer } = usePermissionPrimer();

  // The device's own position, the permission behind it, and the camera that
  // follows it — see hooks/useMapLocation. Called before every hook that reads
  // `coordsRef`, so its mirror effect lands first on any commit where both run.
  const {
    mapRef, coords, coordsRef, displayCoords, speedRef, accuracyRef, fixTimestampRef,
    permState, setPermState,
    locateState, handleLocatePress, stopFollowing, zoomToCluster,
    zoomDelta, mapH, onMapLayout, onRegionChangeComplete,
  } = useMapLocation(ensurePermission);

  // Everyone else, and the poll that keeps them true — see hooks/useMapData.
  // It reads `coordsRef`, so it is called after the hook that owns it.
  const {
    nearby, currentUserId, friendIds, connectionIds, selfProfile, selfZone,
    stories, clubMeetups, awaitingFix, fetchFriends, reactToStory, createStory,
    zoneRetry, retryZoneBoundary,
  } = useMapData(coordsRef, speedRef, !!coords, accuracyRef, fixTimestampRef);

  // The places this viewer saved — where a Swift was made, and the meetups
  // they said they are going to. On-device and account-scoped; see
  // services/pinnedPlaces for why they are not on the server.
  const pinnedPlaces = usePinnedPlaces();

  // Which panel is open over the map, and the spring that opens it — see
  // hooks/useMapSheets. Given the live lists so an open sheet follows each poll.
  const {
    sheetY, selectedUser, selectedMeetup, selectedPin, storyViewer,
    sheetUser, sheetMeetup, sheetPin,
    openSheet, closeSheet, openMeetupSheet, closeMeetupSheet,
    openPinSheet, closePinSheet, openStoryViewer, closeStoryViewer,
  } = useMapSheets(nearby, stories, pinnedPlaces);

  // The story composer and the left-edge swipe that opens it.
  const { composerOpen, createStoryCoord, composeEdge, openComposerAt, closeComposer } =
    useStoryComposer(coordsRef);

  const { showStoryTutorial, dismissStoryTutorial } = useStoryTutorial(currentUserId);
  const [hiToast, setHiToast]           = useState(false);
  const [locationToast, setLocationToast] = useState(false);
  const hiToastTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUserIdRef   = useRef<number | null>(null);
  // Mirrors state for the polling callbacks further down. Declared above every
  // effect that reads it, so on any commit where both run this one lands first.
  // `coordsRef` is the same arrangement one level up, in useMapLocation.
  useEffect(() => { currentUserIdRef.current = currentUserId; });

  const reduceMotion = useReduceMotion();

  // A venue picked on the Places tab of search. Search leaves it behind and
  // goes back; the map takes it here, flies to it, and opens its card. The card
  // waits for the flight (and for the search screen to finish leaving — iOS
  // will not present a modal mid-transition).
  const venueFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFocusEffect(useCallback(() => {
    const venue = takeVenueFocus();
    if (!venue) return;
    stopFollowing('tap');
    mapRef.current?.animateToRegion(
      { latitude: venue.latitude, longitude: venue.longitude, latitudeDelta: 0.006, longitudeDelta: 0.006 },
      reduceMotion ? 0 : 500,
    );
    venueFocusTimer.current = setTimeout(() => setSelectedVenue(venue), reduceMotion ? 350 : 550);
    return () => { if (venueFocusTimer.current) clearTimeout(venueFocusTimer.current); };
  }, [mapRef, reduceMotion, stopFollowing]));

  // Who is allowed on this map at all, and whose stories may pin to it — see
  // hooks/useVisiblePeople. Policy, not plumbing.
  const { visibleNearby, storiesByAuthor } = useVisiblePeople(
    nearby, stories, currentUserId, friendIds, connectionIds,
  );

  // Ghost Mode: nobody sees the viewer and the viewer sees nobody. Drawn in
  // three places here — the muted self marker, the notice, and what the story
  // composer says it will do. The rounding that keeps the owner's own view
  // honest lives with the position itself, in hooks/useMapLocation.
  const ghost = useGhostMode();

  // Speed trails. Fed from the same list the markers render, so a person who
  // disappears from `visibleNearby` takes their trail history with them.
  const motionTrails = useMotionTrails(visibleNearby);

  // Zone outlines, music rings and the basemap-offset notice — see
  // hooks/useMapOverlays. The purple is passed in rather than imported there
  // so the ring follows the live palette, the same as every other colour on
  // this screen.
  const overlays = useMapOverlays(visibleNearby, selfZone, displayCoords, colors.purple);

  // Where each marker lands, and the pooled slots the badges and leader lines
  // are drawn from. The pools are why nothing here is ever unmounted — see
  // PARKED_MARKERS above and hooks/useMarkerSlots.
  const slots = useMarkerSlots(
    visibleNearby, displayCoords, overlays.musicZones, overlays.zoneAreas, zoomDelta, mapH,
  );

  /** Whether the meetup whose card is open is one the viewer is going to.
   *  Read off the same list the markers use, so the card and the pin on the
   *  map can never disagree about it. */
  const goingToMeetup = !!sheetMeetup
    && pinnedPlaces.some((p) => p.kind === 'meetup' && p.source_id === sheetMeetup.id);

  /** "I'm going", and its undo.
   *
   *  Lives on the screen rather than inside the sheet so the meetup card and
   *  anything else that grows the same button later share one implementation
   *  of what going means — a pin, and nothing sent anywhere. */
  async function toggleGoing(meetup: ClubMeetup) {
    const pinned = pinnedPlaces.some(
      (p) => p.kind === 'meetup' && p.source_id === meetup.id,
    );
    if (pinned) {
      await unpinPlace(pinIdFor('meetup', meetup.id));
      return;
    }
    const result = await pinMeetup({
      meetupId: meetup.id,
      latitude: meetup.latitude,
      longitude: meetup.longitude,
      title: meetup.title,
      clubName: meetup.club_name,
      locationName: meetup.location_name,
      eventDatetime: meetup.event_datetime,
      expiresAt: meetup.expires_at,
    });
    if (!result.ok && result.reason === 'limit') {
      Alert.alert(
        'Your map is full',
        `You can keep ${MAX_PINS} pinned places. Remove one to add this meetup.`,
      );
    }
  }

  /** Dismiss first, then remove. The card is read back out of the pin list, so
   *  removing it while it is still on screen would blank the panel mid-slide —
   *  `useMapSheets` keeps the opened row for exactly this reason. */
  function handleUnpin(place: PinnedPlace) {
    closePinSheet();
    void unpinPlace(place.id);
  }

  function handleHiSent() {
    fetchFriends();
    setHiToast(true);
    if (hiToastTimer.current) clearTimeout(hiToastTimer.current);
    hiToastTimer.current = setTimeout(() => setHiToast(false), 1500);
  }

  /** Long-press writes a story where the finger landed.
   *
   *  No `if (!coords) return` guard: not having a fix — because Ghost Mode is
   *  on, or the permission was never granted — is no longer a reason a story
   *  cannot be written. It only means the story will not be a pin, which the
   *  toast then says out loud. */
  function openComposerHere() {
    openComposerAt(coords ?? null);
    setLocationToast(true);
    if (locationToastTimer.current) clearTimeout(locationToastTimer.current);
    locationToastTimer.current = setTimeout(() => setLocationToast(false), 2000);
  }

  /** The dead end's own way out. `blocked` has spent its one dialog, so the
   *  only thing left to offer is Settings; anything else may still ask. */
  async function allowLocation() {
    if (permState === 'blocked') {
      openAppSettings();
      return;
    }
    if (await ensurePermission('location')) setPermState('granted');
  }


  // The sheet and the story viewer used to be re-synced here after every fetch.
  // Both now read their rows out of the live lists as they render, so there is
  // nothing left to copy across.

  /** The control belongs to the map, not to the states that replace it: over
   * the permission dead end it duplicates the Allow button, and over the
   * full-screen "Locating you…" it is a spinner on top of a spinner. */
  const mapVisible = !(permState && permState !== 'granted') && !!displayCoords;

  // Parked directly over the Settings tab rather than in the corner, so it
  // reads as one column of controls with the nav instead of a stray button.
  // Derived before the clearance below, which measures from wherever it lands.
  const locateRight = useNavAlignedRight(LOCATE_SIZE, LOCATE_INSET);

  // Both navs span nearly the full width, so there is no free bottom corner:
  // the button clears whatever height the nav reaches across its own footprint.
  // The 8 is the gap above the nav — small, because sitting just clear of the
  // Settings tab is what makes the two read as related.
  const navClearance = useNavClearance(locateRight, LOCATE_SIZE);
  const locateBottom = bottomInset + navClearance + 8;

  // Whether the map's own controls are reachable at all. A sheet or a
  // full-screen viewer covers them with a backdrop, so anything left drawn
  // underneath is visible-but-dead rather than merely hidden.
  const chromeVisible =
    mapVisible && !selectedUser && !selectedMeetup && !selectedPin
    && !storyViewer && !composerOpen && !selectedVenue;

  // The strip directly under the top bar, where the map's notices sit.
  const overlayTop = topInset + 52 + (awaitingFix ? 46 : 0);

  // Paused takes the top of that strip, so anything else drawn there stacks
  // below it rather than on top of it — the basemap-offset notice is pinned to
  // the same line and the two would otherwise land exactly on each other.
  const ghostNoticeVisible = chromeVisible && ghost === true;
  const noticeTop = overlayTop + (ghostNoticeVisible ? 56 : 0);
  // The zone-boundary notice sits under the basemap-offset one when both are up.
  const zoneNoticeTop = noticeTop + (overlays.chinaOffsetNotice && mapVisible ? 56 : 0);
  // Not while ghosted: that notice already explains an empty map, and better.
  const zoneFallback = chromeVisible && ghost === false && selfZone?.boundary_missing
    ? { radius: selfZone.zone_radius, placeName: selfZone.place_name, retry: zoneRetry }
    : null;
  // Below whatever notices are showing, so the check-in pill steps under them.
  const checkInTop = zoneNoticeTop + (zoneFallback ? 64 : 0);

  const region: Region | undefined = displayCoords
    ? { ...displayCoords, latitudeDelta: 0.012, longitudeDelta: 0.012 }
    : undefined;

  return (
    <View style={styles.container}>
      {permState && permState !== 'granted' ? (
        <MapPermissionGate
          permState={permState}
          styles={styles}
          onAllow={allowLocation}
          onList={() => router.push('/nearby')}
        />
      ) : !displayCoords ? (
        <View style={styles.center} accessible accessibilityLabel="Finding your location">
          <ActivityIndicator color={colors.teal} size="large" />
          <Text style={styles.loadingText}>Locating you…</Text>
        </View>
      ) : (
        <MapCanvas
          mapRef={mapRef}
          styles={styles}
          themeMode={themeMode}
          region={region}
          displayCoords={displayCoords}
          colors={colors}
          overlays={overlays}
          slots={slots}
          visibleNearby={visibleNearby}
          motionTrails={motionTrails}
          reduceMotion={reduceMotion}
          friendIds={friendIds}
          connectionIds={connectionIds}
          selfProfile={selfProfile}
          selfZone={selfZone}
          ghost={ghost}
          storiesByAuthor={storiesByAuthor}
          clubMeetups={clubMeetups}
          pinnedPlaces={pinnedPlaces}
          venues={venues}
          onOpenVenue={setSelectedVenue}
          onMapLayout={onMapLayout}
          onRegionChangeComplete={onRegionChangeComplete}
          onPanDrag={() => stopFollowing('gesture')}
          onLongPress={openComposerHere}
          onOpenSheet={openSheet}
          onZoomToCluster={zoomToCluster}
          onOpenStories={openStoryViewer}
          onOpenMeetup={openMeetupSheet}
          onOpenPin={openPinSheet}
        />
      )}

      {/* Swipe right from the left edge to open the composer.
          A narrow strip rather than the whole map, because the map wants
          horizontal drags too — panning east would otherwise be indisting-
          uishable from asking to post something. This is the same edge the
          system's own back gesture used to occupy here, which is what the
          swipe already felt like reaching for; that one is off now (it was
          popping signed-in users out to the sign-up screen — see the
          `(tabs)` entry in app/_layout).
          Rendered directly after the map so every control below still takes
          the touch ahead of it. */}
      <GestureDetector gesture={composeEdge}>
        <View style={styles.composeEdge} />
      </GestureDetector>

      {/* Top bar */}
      <TopBar
        nearby={visibleNearby.length}
        pinCount={pinnedPlaces.length}
        onPinned={() => router.push('/pinned')}
        onZoneMusic={() => router.push('/zone')}
        onSearch={() => router.push('/search')}
        onList={() => router.push('/nearby')}
      />

      <MapNotices
        styles={styles}
        colors={colors}
        topInset={topInset}
        overlayTop={overlayTop}
        noticeTop={noticeTop}
        zoneNoticeTop={zoneNoticeTop}
        pending={chromeVisible && awaitingFix}
        ghostNotice={ghostNoticeVisible}
        offsetNotice={!!overlays.chinaOffsetNotice && mapVisible}
        zoneFallback={zoneFallback}
        onOpenPrivacy={() => router.push('/privacy')}
        onRetryZone={() => { retryZoneBoundary().catch(() => {}); }}
      />

      {/* Visibility to non-friends, this session only. Draws nothing when
          discovery is Private or Ghost Mode is on — see the component. */}
      {chromeVisible && <CheckInControl top={checkInTop} />}

      {venueError && chromeVisible && (
        <Pressable onPress={retryVenues} accessibilityRole="button"
          accessibilityLabel="Places unavailable. Retry loading venues"
          style={{ position: 'absolute', top: checkInTop + 48, alignSelf: 'center',
            backgroundColor: colors.bg, borderRadius: 12, padding: 10 }}>
          <Text style={{ color: colors.t2 }}>Places unavailable · Tap to retry</Text>
        </Pressable>
      )}
      <VenueSheet venue={selectedVenue} onClose={() => setSelectedVenue(null)} />

      <MapSheets
        sheetUser={sheetUser}
        selectedUser={selectedUser}
        sheetMeetup={sheetMeetup}
        selectedMeetup={selectedMeetup}
        sheetPin={sheetPin}
        selectedPin={selectedPin}
        sheetY={sheetY}
        storyViewer={storyViewer}
        currentUserId={currentUserId}
        friendIds={friendIds}
        goingToMeetup={goingToMeetup}
        onCloseSheet={closeSheet}
        onCloseMeetupSheet={closeMeetupSheet}
        onClosePinSheet={closePinSheet}
        onToggleGoing={toggleGoing}
        onUnpin={handleUnpin}
        onFriendChange={handleHiSent}
        onCloseStories={closeStoryViewer}
        onReact={reactToStory}
      />

      <CreateStoryModal
        visible={composerOpen}
        locationless={ghost === true || (!createStoryCoord && !coords)}
        onClose={closeComposer}
        onPost={(text, photoUri) => createStory(text, photoUri, createStoryCoord)}
      />

      <MapToasts
        styles={styles}
        colors={colors}
        top={overlayTop + 52}
        hiToast={hiToast}
        locationToast={locationToast}
        locationless={ghost === true || !coords}
      />

      {primer}

      <ApproxNav />

      {/* Locate / follow control.
          Rendered after the nav on purpose. The wheel's root is a full-width
          absolutely-positioned View with default pointerEvents and elevation
          10, so it swallows every touch inside its ~200pt-tall rectangle that
          doesn't land on one of its own tabs — anything drawn behind it there
          is visible but dead. It has to absorb those touches (otherwise drags
          on the opaque arc would pan the map underneath), so the button sits
          above it instead.

          Hidden while a sheet or full-screen overlay owns the screen: the user
          sheet reaches 400pt up with a backdrop over everything below it, so a
          button left there is both covered and unreachable. */}
      {chromeVisible && (
        <LocateButton
          state={locateState}
          bottom={locateBottom}
          right={locateRight}
          onPress={handleLocatePress}
        />
      )}

      {mapVisible && showStoryTutorial && (
        <StoryTutorialOverlay onDismiss={dismissStoryTutorial} />
      )}
    </View>
  );
}
