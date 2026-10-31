// The map's own position, and the camera that follows it.
//
// Split out of app/(tabs)/map.tsx, where it was tangled through the polling
// and the sheets. It is one subsystem: a single `watchPositionAsync`
// subscription, the permission that feeds it, and the locate/follow control
// that reads from it. Nothing here fetches anything from the server.
//
// **This never transmits.** The locate control deliberately calls neither
// `reportLocation` nor the poll: a button that made the phone broadcast its
// position would be a way around Ghost Mode, which is the one thing Ghost Mode
// is supposed to guarantee. Recentering moves the camera and sends nothing.
// Keeping the transmit out of this file is what makes that checkable.

import * as Location from 'expo-location';
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import type MapView from 'react-native-maps';
import type { Region } from 'react-native-maps';

import { announce, useReduceMotion } from '@/hooks/useReduceMotion';
import { startBackgroundLocationUpdates } from '@/services/backgroundLocation';
import { atSharingPrecision, type Coordinates } from '@/services/location';
import type { GeoPoint } from '@/services/markerLayout';
import { recordSpeed } from '@/services/ownMotion';
import {
  getSmoothedPosition,
  pushFix,
  resetPositionSampleClock,
  resetPositionSmoothing,
  setSmoothingActive,
  setSmoothingReduceMotion,
  subscribeToSmoothedPosition,
} from '@/services/positionSmoothing';
import {
  bindForegroundRefresh,
  check as checkPermission,
  refreshPermissions,
  usePermissionStore,
  type PermissionState,
} from '@/services/permissions';

export type LocateState =
  /** Camera is free — wherever the user last left it. */
  | 'off'
  /** Camera tracks each new fix. */
  | 'following'
  /** No fix yet, or one is being resolved. */
  | 'locating'
  /** No permission, so there is nothing to centre on. */
  | 'unavailable';

// ── Locate control ──
/** Street-level, close enough to tell which side of the road you're on. */
const FOCUS_DELTA = 0.006;
/** Long enough to read as travel between two places rather than a cut. */
const RECENTER_MS = 450;
/**
 * How old the last fix may be before recentering re-reads it rather than
 * trusting it. The watcher only fires every 10m, so a still user's fix is old
 * and correct — age is not shown as staleness anywhere, it only decides
 * whether to ask the OS again first. Coming back from a long backgrounding is
 * the case this exists for: the alternative is confidently centring on where
 * the phone was an hour ago.
 */
const STALE_FIX_MS = 30_000;

/**
 * How old the fix may get before the map re-reads it on its own. A report
 * only carries a fix measured in the last two minutes (services/location.ts,
 * and the server checks the same), and a still phone's watcher goes quiet —
 * so without this somebody sitting still stopped reporting, and a new account
 * whose only fix aged out while the disclosure sheet was open never sent a
 * position at all, leaving its zone with nothing to resolve.
 */
const KEEP_FRESH_MS = 60_000;
const KEEP_FRESH_CHECK_MS = 15_000;

/** How still the camera must be before the marker layout reacts to a new zoom. */
const ZOOM_SETTLE_MS = 220;

/**
 * Widest span the layout will reason about, in degrees of latitude.
 *
 * Google Maps will happily zoom out to the whole globe, at which point a pixel
 * is worth tens of kilometres and `SELF_CLEAR_PX` worth of offset lands a badge
 * in another hemisphere — or past the poles, which is an invalid coordinate and
 * takes the native map down with it.
 */
const MAX_ZOOM_DELTA = 2;

/**
 * The zoom, rounded to half a power of two.
 *
 * The layout only needs a rough idea of how far out the camera is, and a
 * continuous value meant every marker re-rendered on every zoom event Android
 * emitted mid-pinch. Buckets reduce a whole pinch to a handful of updates.
 */
function zoomBucket(latitudeDelta: number): number {
  if (!Number.isFinite(latitudeDelta) || latitudeDelta <= 0) return 0.012;
  const clamped = Math.min(Math.max(latitudeDelta, 0.0005), MAX_ZOOM_DELTA);
  return 2 ** (Math.round(Math.log2(clamped) * 2) / 2);
}

export interface MapLocation {
  mapRef: React.RefObject<MapView | null>;
  /** The device's true position, or null before the first fix. */
  coords: { latitude: number; longitude: number } | null;
  /** Mirror of the above for callbacks that must not re-subscribe on it. */
  coordsRef: React.RefObject<{ latitude: number; longitude: number } | null>;
  /** What the owner's own view draws, at the precision the wire uses. */
  displayCoords: GeoPoint | null;
  /** Latest platform speed estimate, in m/s; null when it has none. */
  speedRef: React.RefObject<number | null>;
  /** Latest accepted fix's confidence radius in metres, or null if unknown. */
  accuracyRef: React.RefObject<number | null>;
  fixTimestampRef: React.RefObject<number>;
  permState: PermissionState | null;
  setPermState: (state: PermissionState) => void;
  locationGranted: boolean;
  locateState: LocateState;
  handleLocatePress: () => void;
  stopFollowing: (reason: 'gesture' | 'tap') => void;
  zoomToCluster: (center: GeoPoint) => void;
  /** Coarse viewport zoom, for turning pixel thresholds into map metres. */
  zoomDelta: number;
  /** Measured map height in points; 0 until the first layout. */
  mapH: number;
  onMapLayout: (height: number) => void;
  onRegionChangeComplete: (region: Region) => void;
}

export function useMapLocation(
  /** The primed permission request — see components/PermissionPrimer. */
  ensurePermission: (key: 'location') => Promise<boolean>,
): MapLocation {
  const reduceMotion = useReduceMotion();
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const screenActive = focused && appActive;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [permState, setPermState] = useState<PermissionState | null>(null);
  const [followRequested, setFollowRequested] = useState(false);
  const [locating, setLocating] = useState(false);

  const coordsRef = useRef(coords);
  const mapRef = useRef<MapView | null>(null);
  /** Last region the map settled on, so recentering can keep the user's zoom
   * instead of snapping back to the default every time they move. */
  const regionRef = useRef<Region | null>(null);
  /** Viewport, for turning the marker fan's pixel thresholds into map metres.
   *
   * State rather than a ref because the fan is rendered from it — but coarse
   * state: `zoomDelta` only moves when the zoom changes materially, so panning
   * (which never changes latitudeDelta) re-renders nothing, and a pinch
   * re-rasterizes the markers once instead of continuously. */
  const [zoomDelta, setZoomDelta] = useState(() => zoomBucket(0.012));
  const [mapH, setMapH] = useState(0);
  /** Debounce for the above — see `onRegionChangeComplete`. */
  const zoomSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settledZoomRef = useRef(zoomBucket(0.012));
  const pendingZoomRef = useRef<number | null>(null);
  useEffect(() => () => { if (zoomSettleRef.current) clearTimeout(zoomSettleRef.current); }, []);
  /** The position the camera was last sent to, so a fix that rounds to the
   * same approximate point doesn't re-issue an animation. */
  const centeredOnRef = useRef<Coordinates | null>(null);
  const recenterUntilRef = useRef(0);
  /** When `coords` was last measured, not when it was last rendered. */
  const fixAtRef = useRef(0);
  const fixClock = useRef({ offset: Date.now() - performance.now(), generation: 0 });
  /** Latest platform speed estimate, in m/s; null when it has none. A ref, not
   * state — it changes on every fix and only the next poll reads it. */
  const speedRef = useRef<number | null>(null);
  const accuracyRef = useRef<number | null>(null);
  const followingRef = useRef(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const trackingVersion = useRef(0);
  const trackingActive = useRef(false);
  const locateVersion = useRef(0);
  const permissionPrompted = useRef(false);
  // Mirrors state for the polling and location callbacks. This hook is called
  // before the ones that read `coordsRef`, so on any commit where both run this
  // effect lands first.
  useEffect(() => { coordsRef.current = coords; });

  // ── Location accuracy ──
  // The owner's own view is the easiest place to leak the precise position of
  // someone sharing approximately, so everything drawn for them — the marker,
  // their zone circle, and where the locate button centres — goes through the
  // same rounding the network layer applies, so the marker and the wire agree.
  //
  // No longer gated on knowing the sharing mode first: there is one precision
  // now, and the owner always sees their own true position. What other people
  // see is decided per viewer on the server — see users.visibility, and the
  // note in services/location.ts.
  const displayCoords = useMemo(
    () => (coords ? atSharingPrecision(coords) : null),
    [coords],
  );

  // ── Location permission, re-read on every foreground ──
  // A grant seen when the map mounted is not a grant now: iOS "Allow Once"
  // lapses the moment the app is backgrounded, and either OS can revoke from
  // Settings while we are suspended. This is the same store Settings →
  // Permissions reads, so the two can't disagree.
  const permissions = usePermissionStore();
  useEffect(() => {
    refreshPermissions(['location']).catch(() => {});
    return bindForegroundRefresh();
  }, []);
  const locationState = permissions.location?.state ?? permState;
  const locationGranted = locationState === 'granted';

  // Following depends on the permission that feeds it, so it is stated as a
  // condition rather than a flag some effect has to switch off afterwards.
  // Losing location mid-follow now stops it in the same render; before, the
  // camera stayed locked to a position that would never update again until an
  // effect noticed and re-rendered.
  // `following` itself is still derived in render, so the condition above still
  // holds the moment the permission drops. Only the ref mirror — read by
  // `stopFollowing`, which both gestures and taps reach after a commit — waits
  // for the effect. The handlers that need it sooner still set it themselves.
  const following = followRequested && locationGranted && screenActive;
  useEffect(() => { followingRef.current = following; });

  // GPS timestamps use wall time, unlike drawing/recenter deadlines. Rebase
  // ordering after a clock correction, retaining the position already drawn.
  const syncFixClock = useCallback(() => {
    const offset = Date.now() - performance.now();
    if (Math.abs(offset - fixClock.current.offset) > 5_000) {
      fixClock.current = { offset, generation: fixClock.current.generation + 1 };
      fixAtRef.current = 0;
      resetPositionSampleClock();
    }
    return fixClock.current.generation;
  }, []);

  // Every input path uses the same validation and timestamp ordering. A slow
  // one-shot read must not move a marker backwards after a newer watch fix.
  const acceptFix = useCallback((fix: Location.LocationObject): Coordinates | null => {
    syncFixClock();
    const next = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
    if (!Number.isFinite(fix.timestamp) || fix.timestamp <= fixAtRef.current
      || Math.abs(Date.now() - fix.timestamp) > STALE_FIX_MS
      || !pushFix(next, fix.timestamp)) return null;
    fixAtRef.current = fix.timestamp;
    coordsRef.current = next;
    setCoords(next);
    const speed = fix.coords.speed;
    const accuracy = fix.coords.accuracy;
    accuracyRef.current = typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null;
    speedRef.current = typeof speed === 'number' && Number.isFinite(speed) && speed >= 0 ? speed : null;
    recordSpeed(speedRef.current);
    return atSharingPrecision(next);
  }, [syncFixClock]);

  // Prime the foreground request once, while the map is visible. Background
  // permission is still requested only by the existing explicit sharing control.
  useEffect(() => {
    if (!screenActive || permissionPrompted.current) return;
    permissionPrompted.current = true;
    let cancelled = false;
    void ensurePermission('location').then(async granted => {
      if (cancelled) return;
      if (granted) setPermState('granted');
      else {
        const info = await checkPermission('location');
        if (!cancelled) setPermState(info.state);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [screenActive, ensurePermission]);

  // Tabs stay mounted. Stop the foreground watcher and drawing timer on blur,
  // background or revocation; the separately consented background task keeps
  // its existing lifecycle. An asynchronously created watcher is removed even
  // when its creation finishes after this effect has already been cleaned up.
  useEffect(() => {
    const version = ++trackingVersion.current;
    let disposed = false;
    trackingActive.current = screenActive && locationGranted;
    setSmoothingActive(trackingActive.current);
    const current = () => !disposed && version === trackingVersion.current;

    if (trackingActive.current) {
      // A newly created watcher is a new acquisition session. The lifecycle
      // generation excludes old callbacks even if the device clock went back.
      fixAtRef.current = 0;
      fixClock.current = {
        offset: Date.now() - performance.now(), generation: fixClock.current.generation + 1,
      };
      resetPositionSampleClock();
      void (async () => {
        const permission = await checkPermission('location');
        if (!current()) return;
        if (permission.state !== 'granted') {
          setPermState(permission.state);
          void refreshPermissions(['location']).catch(() => {});
          return;
        }
        // Starting a previously permitted background task must not delay the
        // map's first fix. This helper never asks for a new permission.
        void startBackgroundLocationUpdates().catch(() => {});
        const clock = syncFixClock();
        void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          .then(fix => {
            if (current() && syncFixClock() === clock) acceptFix(fix);
          }).catch(() => {});
        const subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
          fix => { if (current()) acceptFix(fix); },
        );
        if (current()) watchRef.current = subscription;
        else subscription.remove();
      })().catch(() => {});
    }
    if (!locationGranted) {
      coordsRef.current = null;
      fixAtRef.current = 0;
      speedRef.current = null;
      accuracyRef.current = null;
      setCoords(null);
      setFollowRequested(false);
      resetPositionSmoothing();
    }
    return () => {
      disposed = true;
      trackingVersion.current += 1;
      trackingActive.current = false;
      locateVersion.current += 1;
      setLocating(false);
      watchRef.current?.remove();
      watchRef.current = null;
      setSmoothingActive(false);
    };
  }, [screenActive, locationGranted, acceptFix, syncFixClock]);

  useEffect(() => () => { resetPositionSmoothing(); }, []);

  // ── Locate / follow ─────────────────────────────────────────────────────────
  //
  // It reuses the map's existing watchPositionAsync subscription rather than
  // opening its own. A second GPS subscription on a screen people leave open is
  // a real battery cost for no new information.
  const centerOnSelf = useCallback(
    (target: Coordinates, resetZoom: boolean) => {
      const map = mapRef.current;
      if (!map) return;
      const current = regionRef.current;
      const zoomed = resetZoom || !current;
      centeredOnRef.current = target;
      recenterUntilRef.current = performance.now() + (reduceMotion ? 0 : RECENTER_MS);
      map.animateToRegion(
        {
          ...target,
          latitudeDelta:  zoomed ? FOCUS_DELTA : current!.latitudeDelta,
          longitudeDelta: zoomed ? FOCUS_DELTA : current!.longitudeDelta,
        },
        // Both platforms treat a zero duration as an instant move, so Reduce
        // Motion gets a real jump rather than a very fast animation.
        reduceMotion ? 0 : RECENTER_MS,
      );
    },
    [reduceMotion],
  );

  // Guarded through a ref, not through the state updater: onPanDrag fires on
  // every frame of a drag, and announcing from inside a setState callback
  // would repeat for each one.
  const stopFollowing = useCallback((reason: 'gesture' | 'tap') => {
    // A gesture also cancels a locate waiting for its first fix. The fix may
    // still update the dot, but must not take the camera back from the user.
    locateVersion.current += 1;
    setLocating(false);
    if (!followingRef.current) return;
    followingRef.current = false;
    setFollowRequested(false);
    announce(
      reason === 'gesture'
        ? 'Stopped following your location, map moved'
        : 'Stopped following your location',
    );
  }, []);

  /**
   * Tapping a headcount goes in far enough to break the pile up.
   *
   * A third of the current span per tap, so a badge over a dense spot can be
   * opened by tapping it again rather than by guessing a zoom level. Following is
   * released first: the camera is being sent where the user chose, and the next
   * position fix would otherwise haul it straight back.
   */
  const zoomToCluster = useCallback(
    (center: GeoPoint) => {
      const map = mapRef.current;
      if (!map) return;
      stopFollowing('tap');
      const current = regionRef.current;
      const delta = Math.max(0.0015, (current?.latitudeDelta ?? zoomDelta) / 3);
      map.animateToRegion(
        { ...center, latitudeDelta: delta, longitudeDelta: delta },
        reduceMotion ? 0 : RECENTER_MS,
      );
    },
    [reduceMotion, stopFollowing, zoomDelta],
  );

  // Reduce Motion is an instruction not to animate, and a glide is animation.
  // Mirrored into the smoother rather than branched on at each draw, so the
  // marker and the camera cannot end up disagreeing about it.
  useEffect(() => {
    if (reduceMotion) recenterUntilRef.current = 0;
    setSmoothingReduceMotion(reduceMotion);
  }, [reduceMotion]);

  /**
   * Keep the camera on the smoothed position while following.
   *
   * A subscription and a direct `setCamera`, not a `useEffect` on a piece of
   * state — this fires around fifteen times a second and going through React
   * would re-render the whole map screen for each one.
   *
   * `setCamera`, not `animateToRegion`, and that is the other half of the fix.
   * Per-fix animations can overlap when GPS updates arrive in bursts. Their
   * actual cadence varies by device; 450 ms animations do not overlap a
   * steady 600 ms cadence. Continuous centers also remove the pauses between
   * separated animations without changing the GPS sampling settings.
   *
   * Only `center` is passed. A `Partial<Camera>` leaves everything else alone,
   * so the zoom, pitch and heading the user set are not quietly reset fifteen
   * times a second.
   */
  useEffect(() => {
    if (!following) return;
    const move = () => {
      const map = mapRef.current;
      const next = getSmoothedPosition();
      if (!followingRef.current || !trackingActive.current || !map || !next
        || performance.now() < recenterUntilRef.current) return;
      const at = atSharingPrecision(next);
      const last = centeredOnRef.current;
      // Standing still, the same point arrives repeatedly as the fix wobbles
      // under the rounding. Moving the camera to where it already is costs a
      // native call per frame and, on Android, an onRegionChange for each.
      if (last && last.latitude === at.latitude && last.longitude === at.longitude) return;
      centeredOnRef.current = at;
      map.setCamera({ center: at });
    };
    move();
    // Let the explicit locate animation finish before streaming centers;
    // otherwise the first smoothed fix cancels the user's requested zoom.
    const resume = setTimeout(move, Math.max(0, recenterUntilRef.current - performance.now()));
    const unsubscribe = subscribeToSmoothedPosition(move);
    return () => { clearTimeout(resume); unsubscribe(); };
  }, [following, reduceMotion]);

  const explainUnavailable = useCallback(async () => {
    // The primer already covers both shapes of this: the reason plus the OS
    // dialog while we may still ask, and the reason plus Linking.openSettings()
    // once it has been permanently refused. A second explanation of our own
    // here would only be a worse copy of it.
    if (await ensurePermission('location')) {
      setPermState('granted');
      await refreshPermissions(['location']);
    }
  }, [ensurePermission]);

  /** Ask the OS for a fresh fix and feed it into the shared position state. */
  const refreshFix = useCallback(async (): Promise<Coordinates | null> => {
    const version = trackingVersion.current;
    if (!trackingActive.current) return null;
    const clock = syncFixClock();
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (version !== trackingVersion.current || !trackingActive.current) return null;
      if (syncFixClock() !== clock) return coordsRef.current ? atSharingPrecision(coordsRef.current) : null;
      return acceptFix(fix) ?? (coordsRef.current ? atSharingPrecision(coordsRef.current) : null);
    } catch {
      return null;
    }
  }, [acceptFix, syncFixClock]);

  // See KEEP_FRESH_MS. Foreground only: `screenActive` drops on blur and
  // background, which is when the background task takes over.
  useEffect(() => {
    if (!screenActive || !locationGranted) return;
    const id = setInterval(() => {
      if (Date.now() - fixAtRef.current > KEEP_FRESH_MS) void refreshFix();
    }, KEEP_FRESH_CHECK_MS);
    return () => clearInterval(id);
  }, [screenActive, locationGranted, refreshFix]);

  const startFollowing = useCallback((target: Coordinates) => {
    centerOnSelf(getSmoothedPosition() ?? target, true);
    // Set before the re-render: stopFollowing reads the ref, and onPanDrag can
    // fire a frame ahead of the state update.
    followingRef.current = true;
    setFollowRequested(true);
    announce('Following your location');
  }, [centerOnSelf]);

  const handleLocatePress = useCallback(async () => {
    if (!screenActive) return;
    if (!locationGranted) {
      explainUnavailable();
      return;
    }
    if (following) {
      stopFollowing('tap');
      return;
    }

    // Move on the fix we already have. The watcher only fires every 10m, so a
    // still user's fix is minutes old and perfectly accurate — blocking on the
    // GPS first made the button do nothing for the second or two a fresh fix
    // takes, which reads as broken.
    if (displayCoords) {
      startFollowing(displayCoords);
      // If it really is old enough to predate a backgrounding, re-read in the
      // background; follow mode moves the camera the moment the fix lands.
      if (Date.now() - fixAtRef.current > STALE_FIX_MS) refreshFix();
      return;
    }

    // Nothing to centre on at all. This is the only case that waits, and it
    // waits rather than falling back to a hardcoded coordinate.
    setLocating(true);
    const version = trackingVersion.current;
    const locate = ++locateVersion.current;
    const target = await refreshFix();
    if (version !== trackingVersion.current || locate !== locateVersion.current
      || !trackingActive.current) return;
    setLocating(false);
    if (!target) {
      Alert.alert(
        'Can’t find you yet',
        'Approx couldn’t get a location fix. Move somewhere with a clearer view of the sky and try again.',
      );
      return;
    }
    startFollowing(target);
  }, [
    screenActive, locationGranted, following, displayCoords,
    explainUnavailable, stopFollowing, startFollowing, refreshFix,
  ]);

  const locateState: LocateState =
    !locationGranted ? 'unavailable'
    : locating || !displayCoords ? 'locating'
    : following ? 'following'
    : 'off';

  const onMapLayout = useCallback((height: number) => setMapH(height), []);

  const onRegionChangeComplete = useCallback((r: Region) => {
    regionRef.current = r;
    // Android fires this repeatedly through a continuous pinch, and each
    // pass re-renders every marker on the map. So the layout's zoom is
    // updated once the camera has been still for a moment, and only when
    // it lands in a different bucket — a pinch costs one re-render at the
    // end instead of one per frame, and a pan costs none.
    const next = zoomBucket(r.latitudeDelta);
    if (next === pendingZoomRef.current) return;
    if (zoomSettleRef.current) clearTimeout(zoomSettleRef.current);
    zoomSettleRef.current = null;
    pendingZoomRef.current = null;
    if (next === settledZoomRef.current) return;
    pendingZoomRef.current = next;
    zoomSettleRef.current = setTimeout(() => {
      zoomSettleRef.current = null;
      pendingZoomRef.current = null;
      settledZoomRef.current = next;
      setZoomDelta(next);
    }, ZOOM_SETTLE_MS);
  }, []);

  return {
    mapRef,
    coords,
    coordsRef,
    displayCoords,
    speedRef,
    accuracyRef,
    fixTimestampRef: fixAtRef,
    permState,
    setPermState,
    locationGranted,
    locateState,
    handleLocatePress,
    stopFollowing,
    zoomToCluster,
    zoomDelta,
    mapH,
    onMapLayout,
    onRegionChangeComplete,
  };
}
