import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { api } from './api';
import { reportLocation } from './location';
import { getCachedLocationSharing } from './privacy';

const LAST_ZONE_NOTIFIED_KEY = 'last_zone_notified';

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
          id: number; username: string; zone_active?: boolean; zone_radius?: number;
          zone_mode?: 'radius' | 'region'; distance_km?: number;
          zone_audio_url?: string | null;
          music_zone_radius?: number; music_zone_separate?: boolean;
        }[]
      >('/api/proximity/nearby/');

      // "You entered a zone — tap to listen", so this has to agree with what is
      // actually audible. Three rules, all mirroring _trigger_zone_music_alerts
      // on the server, because a push that fires on different terms to the
      // server's own alert is two features disagreeing about one event.
      const zoneUser = nearbyUsers.find((u) => {
        // 1. There must be something to listen to. Not `zone_active` — that
        //    switch removes the circle drawn around someone on the map, which
        //    is a different question. The server only sends `zone_audio_url`
        //    to viewers allowed to hear it, so its presence already means both
        //    "there is music" and "you may play it".
        if (!u.zone_audio_url) return false;

        // 2. A region zone is a city border, not a listening range, and its
        //    owner never chose it as one. Walking into a 500m circle is an
        //    event; being in the same city as a friend is the standing state
        //    of most friendships, and pushing on it would fire for every
        //    friend who lives there. Giving the music its own range is exactly
        //    how someone in region mode opts back in — that range is a circle.
        if (u.zone_mode === 'region' && !u.music_zone_separate) return false;

        // 3. Earshot, not the zone. `music_zone_radius` arrives already
        //    resolved — the server sends `music_radius_m`, which is the
        //    separate dial or the zone's own radius inherited — so this is the
        //    distance the track really carries. Comparing against
        //    `zone_radius` fired at the wrong distance in both directions for
        //    anyone who had separated the two.
        const earshot = u.music_zone_radius ?? u.zone_radius ?? 500;
        return (u.distance_km ?? Infinity) * 1000 < earshot;
      });
      if (zoneUser) {
        const lastNotified = await AsyncStorage.getItem(LAST_ZONE_NOTIFIED_KEY);
        if (lastNotified !== zoneUser.username) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '🎵 You entered a zone!',
              body: `You are in @${zoneUser.username}'s zone - tap to listen`,
            },
            trigger: null,
          });
          await AsyncStorage.setItem(LAST_ZONE_NOTIFIED_KEY, zoneUser.username);
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
