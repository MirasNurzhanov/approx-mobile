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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import type MapView from 'react-native-maps';
import type { Region } from 'react-native-maps';

import { announce, useReduceMotion } from '@/hooks/useReduceMotion';
import { startBackgroundLocationUpdates } from '@/services/backgroundLocation';
import { atSharingPrecision, type Coordinates } from '@/services/location';
import type { GeoPoint } from '@/services/markerLayout';
import { recordSpeed } from '@/services/ownMotion';
import {
  backgroundStatus,
  bindForegroundRefresh,
  check as checkPermission,
  refreshPermissions,
  SUPPORTS_BACKGROUND_LOCATION,
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
  useEffect(() => () => { if (zoomSettleRef.current) clearTimeout(zoomSettleRef.current); }, []);
  /** The position the camera was last sent to, so a fix that rounds to the
   * same approximate point doesn't re-issue an animation. */
  const centeredOnRef = useRef<Coordinates | null>(null);
  /** When `coords` was last measured, not when it was last rendered. */
  const fixAtRef = useRef(0);
  /** Latest platform speed estimate, in m/s; null when it has none. A ref, not
   * state — it changes on every fix and only the next poll reads it. */
  const speedRef = useRef<number | null>(null);
  const followingRef = useRef(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const startingWatchRef = useRef(false);
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
  const following = followRequested && locationGranted;
  useEffect(() => { followingRef.current = following; });

  /**
   * The one location subscription on this screen. The locate control and
   * follow mode read from it rather than opening a second one — two GPS
   * subscriptions on a screen people leave open is a real battery cost for no
   * extra information.
   *
   * Guarded so it can be called from both the mount effect and the
   * permission-regained effect without ever ending up with two watchers.
   */
  const startWatching = useCallback(async () => {
    if (watchRef.current || startingWatchRef.current) return;
    startingWatchRef.current = true;
    try {
      // Not asked for here — this fires on every watch (re)start, including
      // the permission-regained effect below, and re-asking on every one of
      // those would be a dialog storm. The one place that primes and requests
      // it is the mount effect, once, right after foreground is granted. This
      // call only starts the OS task if that already succeeded.
      await startBackgroundLocationUpdates();
      const init = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      fixAtRef.current = init.timestamp;
      setCoords({ latitude: init.coords.latitude, longitude: init.coords.longitude });
      recordSpeed(init.coords.speed);
      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        (loc) => {
          fixAtRef.current = loc.timestamp;
          setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          // The platform's own fused speed, which this watcher was already
          // receiving and discarding. Kept in a ref rather than state: it
          // changes on every fix and nothing renders from it directly, so
          // setting state here would re-render the whole map for nothing.
          speedRef.current = loc.coords.speed ?? null;
          recordSpeed(loc.coords.speed);
        },
      );
    } catch (e: any) {
      console.log('[Map] location watch failed:', e?.message);
    }
    // Always reached — the `catch` only logs — so the re-entrancy guard is
    // released on both paths without a `finally`, which React Compiler cannot
    // compile and which would cost this screen its auto-memoization.
    startingWatchRef.current = false;
  }, []);

  useEffect(() => {
    (async () => {
      // Primed, not cold. The sheet explains first so the one shot iOS gives a
      // cold "Don't Allow" is not spent on a dialog nobody had context for —
      // and, since 5.1.1(iv), that sheet has no way to defer the dialog once
      // it is up. See components/PermissionPrimer.
      const granted = await ensurePermission('location');
      if (!granted) {
        const info = await checkPermission('location');
        setPermState(info.state);
        return;
      }
      setPermState('granted');
      await startWatching();

      // **No background request here, and that absence is the fix.**
      //
      // This used to chain `requestPermission('locationBackground')` straight
      // off the foreground grant, so simply opening the map asked for Always.
      // Nobody had turned anything on; the map does not need it — everything on
      // this screen works while the app is open — and App Review rejected it
      // under 5.1.1(iv) as consent the app had gone looking for.
      //
      // Background location is still fully supported. It is now asked for from
      // Privacy & safety, when somebody turns on "Keep sharing while Approx is
      // closed", which is a feature that genuinely cannot work without it. See
      // services/permissions.requestBackground.
      //
      // What *is* still done here is starting the task for somebody who has
      // already granted Always on a previous run — that is honouring a choice
      // already made, not soliciting a new one, and it never shows a dialog.
      if (SUPPORTS_BACKGROUND_LOCATION) {
        if ((await backgroundStatus()) === 'granted') {
          await startBackgroundLocationUpdates();
        }
      }
    })();

    return () => {
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Permission can come back mid-session — from the locate button's primer, or
  // from the user flipping it in Settings and returning. The subscription died
  // with the revocation, so it has to be re-armed here or follow mode would
  // track a position that never updates again.
  useEffect(() => {
    if (locationGranted) startWatching();
  }, [locationGranted, startWatching]);

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

  // Track each new fix while following. The guard matters in approximate mode,
  // where consecutive fixes usually round to the same point and would
  // otherwise re-animate the camera to where it already is.
  useEffect(() => {
    if (!following || !displayCoords) return;
    const last = centeredOnRef.current;
    if (last && last.latitude === displayCoords.latitude && last.longitude === displayCoords.longitude) return;
    centerOnSelf(displayCoords, false);
  }, [following, displayCoords, centerOnSelf]);

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
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
      fixAtRef.current = fix.timestamp;
      setCoords(next);
      return atSharingPrecision(next);
    } catch {
      return null;
    }
  }, []);

  const startFollowing = useCallback((target: Coordinates) => {
    centerOnSelf(target, true);
    // Set before the re-render: stopFollowing reads the ref, and onPanDrag can
    // fire a frame ahead of the state update.
    followingRef.current = true;
    setFollowRequested(true);
    announce('Following your location');
  }, [centerOnSelf]);

  const handleLocatePress = useCallback(async () => {
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
    const target = await refreshFix();
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
    locationGranted, following, displayCoords,
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
    if (zoomSettleRef.current) clearTimeout(zoomSettleRef.current);
    zoomSettleRef.current = setTimeout(() => {
      const next = zoomBucket(r.latitudeDelta);
      setZoomDelta((prev) => (next === prev ? prev : next));
    }, ZOOM_SETTLE_MS);
  }, []);

  return {
    mapRef,
    coords,
    coordsRef,
    displayCoords,
    speedRef,
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
