import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { reportLocation } from './location';
import { getCachedGhostMode } from './privacy';

// Same guard as services/socialAuth.ts and services/notifications.ts, for the
// same reason: Expo Go's shell app has no way to declare the background modes
// and entitlements a *third-party* app's `startLocationUpdatesAsync` needs, so
// calling it there is a native call the binary cannot actually service —
// exactly the shape of crash that leaves no JS error to catch.
const isExpoGo = Constants.appOwnership === 'expo';

export const BACKGROUND_LOCATION_TASK = 'aura-background-location';

// Must be defined at module scope — runs when the JS bundle initialises,
// including when the OS wakes the app silently for a background update.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  BACKGROUND_LOCATION_TASK,
  async ({ data, error }) => {
    if (error) {
      // iOS can temporarily lack a location fix at startup. Core Location keeps
      // trying; skip this event without opening LogBox or restarting tracking.
      // SDK 54 exposes the NSError domain only in its description.
      const isLocationUnknown =
        Platform.OS === 'ios' &&
        (error.code === 0 || error.code === '0') &&
        /^Error Domain=kCLErrorDomain Code=0(?:\s|$)/.test(error.message);
      if (isLocationUnknown) {
        console.log('[BG Location] location temporarily unavailable; waiting for next update');
        return;
      }
      console.error('[BG Location] task error:', error.message);
      return;
    }
    const location = data?.locations?.reduce<Location.LocationObject | undefined>(
      (latest, fix) => Number.isFinite(fix.timestamp) &&
        (!latest || fix.timestamp > latest.timestamp) ? fix : latest,
      undefined,
    );
    if (!location) return;

    // Ghost Mode means there is nothing this task can usefully do. Checked
    // here as well as in `startBackgroundLocationUpdates` because the two
    // answer different questions: that one stops the OS task at the moment the
    // switch is flipped, this one covers a task the OS kept alive across an
    // app update or a reinstall — expo-task-manager restores registrations, so
    // a task can outlive the choice that started it.
    if (await getCachedGhostMode()) {
      console.log('[BG Location] ghost mode, nothing sent');
      await stopBackgroundLocationUpdates().catch(() => {});
      return;
    }

    try {
      // Honours both gates in services/location.ts: Ghost Mode sends nothing,
      // and neither does an install that has not shown the disclosure yet.
      const sent = await reportLocation(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        },
        location.coords.speed,
        location.coords.accuracy,
        location.timestamp,
      );
      if (!sent) {
        console.log('[BG Location] sharing paused, nothing sent');
        return;
      }
    } catch (e: any) {
      console.log('[BG Location] patch failed:', e?.response?.status);
    }

    // Entry alerts are server-only: nearby map distances may be stale or
    // privacy-adjusted and cannot establish physical presence in a music zone.

  },
);

export async function startBackgroundLocationUpdates(): Promise<void> {
  if (isExpoGo) {
    console.log('[BG Location] skipped — not supported in Expo Go');
    return;
  }

  // Ghost Mode should stop the phone tracking us at all, not just stop the
  // uploads: background tracking exists to keep a *published* position
  // current, and a background-location indicator burning on the status bar of
  // someone invisible to everyone is the app claiming a need it does not have.
  // The per-update check in the task is the correctness guarantee; this is the
  // one that saves the battery. Reached through `syncBackgroundLocation`, so
  // it starts on leaving Ghost Mode as well as stopping on entering it.
  if (await getCachedGhostMode()) {
    console.log('[BG Location] ghost mode, not starting');
    await stopBackgroundLocationUpdates();
    return;
  }

  const { status } = await Location.getBackgroundPermissionsAsync();
  if (status !== 'granted') {
    console.log('[BG Location] background permission not granted, skipping');
    return;
  }

  const already = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (already) {
    console.log('[BG Location] task already registered');
    return;
  }

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 30_000,
    distanceInterval: 50,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Approx',
      notificationBody: 'You are sharing your location — keeping your place on the map up to date',
      notificationColor: '#00b4a6',
    },
  });
  console.log('[BG Location] started');
}

/**
 * Start or stop OS-level tracking to match the state the app is actually in.
 *
 * Call after anything that changes either half of the answer — checking in,
 * checking out, or changing Location sharing — so it takes effect at that
 * moment rather than at the next app launch. `startBackgroundLocationUpdates`
 * owns the conditions; this exists so callers do not have to know what they
 * are, and so "stop" is reachable without them either.
 */
export async function syncBackgroundLocation(): Promise<void> {
  await startBackgroundLocationUpdates();
}

/** How old a fix may be and still stand for where the phone is now. */
const RECENT_FIX_MS = 60_000;

/**
 * One location report, right now — for the moment the app leaves the screen.
 *
 * The background task only reports once iOS wakes it, which is after the phone
 * has moved about 50 m. A phone locked straight after opening the app, before
 * the map's first report, would otherwise never learn it is standing in a
 * friend's music zone. Going through `reportLocation` keeps both of its gates
 * (Ghost Mode, the disclosure) and hands the answer to zone music as usual.
 */
export async function reportLocationNow(): Promise<boolean> {
  if (isExpoGo) return false;
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') return false;
  let fix = await Location.getLastKnownPositionAsync({ maxAge: RECENT_FIX_MS }).catch(() => null);
  if (!fix) fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
  if (!fix) return false;
  return reportLocation(
    { latitude: fix.coords.latitude, longitude: fix.coords.longitude },
    fix.coords.speed,
    fix.coords.accuracy,
    fix.timestamp,
  );
}

export async function stopBackgroundLocationUpdates(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (registered) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    console.log('[BG Location] stopped');
  }
}
