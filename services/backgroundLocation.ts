import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';

import { api } from './api';
import { reportLocation } from './location';
import { getCachedLocationSharing } from './privacy';

// Same guard as services/socialAuth.ts and services/notifications.ts, for the
// same reason: Expo Go's shell app has no way to declare the background modes
// and entitlements a *third-party* app's `startLocationUpdatesAsync` needs, so
// calling it there is a native call the binary cannot actually service —
// exactly the shape of crash that leaves no JS error to catch.
const isExpoGo = Constants.appOwnership === 'expo';

const LAST_ZONE_NOTIFIED_KEY = 'last_zone_notified';
const ZONE_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;

interface LastZoneNotified {
  username: string;
  timestamp: number;
}

export const BACKGROUND_LOCATION_TASK = 'aura-background-location';

// Must be defined at module scope — runs when the JS bundle initialises,
// including when the OS wakes the app silently for a background update.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  BACKGROUND_LOCATION_TASK,
  async ({ data, error }) => {
    if (error) {
      console.error('[BG Location] task error:', error.message);
      return;
    }
    const location = data?.locations?.at(-1);
    if (!location) return;

    try {
      // Honours the Location sharing setting: paused sends nothing at all,
      // approximate coarsens before transmitting.
      const sent = await reportLocation(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        },
        location.coords.speed,
        location.coords.accuracy,
      );
      if (!sent) {
        console.log('[BG Location] sharing paused, nothing sent');
        return;
      }
    } catch (e: any) {
      console.log('[BG Location] patch failed:', e?.response?.status);
    }

    try {
      const { data: nearbyUsers } = await api.get<
        {
          id: number; username: string; distance_km?: number;
          zone_audio_url?: string | null;
          music_zone_radius?: number;
        }[]
      >('/api/proximity/nearby/');

      // "You entered a zone — tap to listen", so this has to agree with what is
      // actually audible. Two rules, both mirroring _trigger_zone_music_alerts
      // on the server, because a push that fires on different terms to the
      // server's own alert is two features disagreeing about one event.
      const zoneUser = nearbyUsers.find((u) => {
        // 1. There must be something to listen to. Not `zone_active` — that
        //    switch removes the circle drawn around someone on the map, which
        //    is a different question. The server only sends `zone_audio_url`
        //    to viewers allowed to hear it, and withholds it entirely from
        //    someone who has switched their music zone off, so its presence
        //    already means all three of "there is music", "it is playing" and
        //    "you may play it".
        if (!u.zone_audio_url) return false;

        // 2. The music zone, not the map zone. `music_zone_radius` is always
        //    the music zone's own number — it never inherits `zone_radius`,
        //    and `zone_mode` does not come into it: a music zone is a circle
        //    even for someone whose map zone is a city border. Comparing
        //    against `zone_radius` fired at the wrong distance in both
        //    directions.
        const reach = u.music_zone_radius ?? 0;
        return (u.distance_km ?? Infinity) * 1000 < reach;
      });
      if (zoneUser) {
        const stored = await AsyncStorage.getItem(LAST_ZONE_NOTIFIED_KEY);
        const lastNotified: LastZoneNotified | null = stored ? JSON.parse(stored) : null;
        const withinCooldown =
          lastNotified != null &&
          lastNotified.username === zoneUser.username &&
          Date.now() - lastNotified.timestamp < ZONE_NOTIFICATION_COOLDOWN_MS;

        if (!withinCooldown) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '🎵 You entered a zone!',
              body: `You are in @${zoneUser.username}'s zone - tap to listen`,
            },
            trigger: null,
          });
          await AsyncStorage.setItem(
            LAST_ZONE_NOTIFIED_KEY,
            JSON.stringify({ username: zoneUser.username, timestamp: Date.now() }),
          );
        }
      } else {
        await AsyncStorage.removeItem(LAST_ZONE_NOTIFIED_KEY);
      }
    } catch (e: any) {
      console.log('[BG Task] nearby fetch failed:', e?.response?.status);
    }
  },
);

export async function startBackgroundLocationUpdates(): Promise<void> {
  if (isExpoGo) {
    console.log('[BG Location] skipped — not supported in Expo Go');
    return;
  }

  // Android has no ACCESS_BACKGROUND_LOCATION to grant, so the permission
  // check below could only ever refuse. See SUPPORTS_BACKGROUND_LOCATION.
  //
  // Unregister rather than just returning: a build from before background
  // location was disabled may have left this task registered, and
  // expo-task-manager restores registrations across an app update.
  if (Platform.OS === 'android') {
    await stopBackgroundLocationUpdates();
    return;
  }

  // "Pause location sharing entirely" should stop the phone tracking us at
  // all, not just stop the uploads. The per-update check in the task is the
  // correctness guarantee; this is the one that saves the battery.
  if ((await getCachedLocationSharing()) === 'paused') {
    console.log('[BG Location] sharing paused, not starting');
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
      notificationTitle: 'Aura',
      notificationBody: 'Updating your location to find nearby people',
      notificationColor: '#00b4a6',
    },
  });
  console.log('[BG Location] started');
}

/** Start or stop OS-level tracking to match the current sharing mode. Call
 * after changing Location sharing so pausing takes effect immediately rather
 * than at the next app launch. */
export async function syncBackgroundLocationSharing(): Promise<void> {
  if ((await getCachedLocationSharing()) === 'paused') {
    await stopBackgroundLocationUpdates();
    return;
  }
  await startBackgroundLocationUpdates();
}

export async function stopBackgroundLocationUpdates(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (registered) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    console.log('[BG Location] stopped');
  }
}
