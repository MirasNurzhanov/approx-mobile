import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  // Deliberately does NOT request. This runs on login, and prompting here
  // meant the very first thing a new user saw was an unexplained system
  // dialog — iOS only ever shows it once, so a reflexive "Don't Allow" killed
  // push for good. The ask now lives behind an explanation in
  // Settings → Permissions; this only picks up a grant that already exists.
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });

  console.log('[Push] sending token to backend:', tokenResponse.data);
  try {
    await api.patch('/api/users/profile/', { push_token: tokenResponse.data });
    console.log('[Push] token saved to backend successfully');
  } catch (e) {
    console.warn('[Push] failed to save token to backend:', e);
  }

  return tokenResponse.data;
}
