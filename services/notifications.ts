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
  try {
    console.log('[Push] function called');

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
    console.log('[Push] permission status:', status);
    if (status !== 'granted') {
      return null;
    }

    console.log('[Push] projectId:', Constants.expoConfig?.extra?.eas?.projectId);
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log('[Push] token received:', token?.data);

    console.log('[Push] sending to backend...');
    try {
      await api.patch('/api/users/profile/', { push_token: token.data });
      console.log('[Push] token saved successfully');
    } catch (error: any) {
      console.log('[Push] error:', error.response?.status, JSON.stringify(error.response?.data), error.message);
    }

    return token.data;
  } catch (e: any) {
    console.log('[Push] registration crashed:', e?.message ?? e);
    return null;
  }
}
