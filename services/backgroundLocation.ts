import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { api } from './api';

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

    const lat = parseFloat(location.coords.latitude.toFixed(6));
    const lng = parseFloat(location.coords.longitude.toFixed(6));
    console.log('[BG Task] running, checking zones...');
    console.log('[BG Location] update:', lat, lng);

    try {
      await api.patch('/api/proximity/location/', { latitude: lat, longitude: lng });
    } catch (e: any) {
      console.log('[BG Location] patch failed:', e?.response?.status);
    }

    try {
      const { data: nearbyUsers } = await api.get<
        { id: number; username: string; zone_active?: boolean; zone_radius?: number; distance_km?: number }[]
      >('/api/proximity/nearby/');
      console.log('[BG Task] nearby users:', nearbyUsers.length);

      const zoneUser = nearbyUsers.find(
        (u) => u.zone_active && (u.distance_km ?? Infinity) * 1000 < (u.zone_radius ?? 500),
      );
      console.log('[BG Task] zone found:', zoneUser?.username);
    } catch (e: any) {
      console.log('[BG Task] nearby fetch failed:', e?.response?.status);
    }
  },
);

export async function startBackgroundLocationUpdates(): Promise<void> {
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

export async function stopBackgroundLocationUpdates(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (registered) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    console.log('[BG Location] stopped');
  }
}
