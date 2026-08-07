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

// app/_layout.tsx calls this on every AppState "active" transition as well as
// on login, so two calls landing close together is routine, not a caller bug
// — a screen lock and unlock right after opening the app fires both. Without
// this, a second `getExpoPushTokenAsync()` could start while the first was
// still settling; that call is not documented as safe to re-enter, and on at
// least one device the overlap crashed the app natively with nothing for the
// outer try/catch to catch. Sharing one in-flight promise makes a second call
// join the first instead of starting a second native request.
let inFlight: Promise<string | null> | null = null;

export function registerForPushNotifications(): Promise<string | null> {
  if (inFlight) return inFlight;
  inFlight = registerForPushNotificationsImpl().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function registerForPushNotificationsImpl(): Promise<string | null> {
  try {
    console.log('[Push] function called');

    // Remote push was pulled from Expo Go starting SDK 53 — this binary has
    // none of the native registration machinery `getExpoPushTokenAsync()`
    // needs, and calling it anyway is what crashed the app natively with
    // nothing for the try/catch below to catch. Same guard services/socialAuth
    // already uses for Google/Apple sign-in, for the same reason: a feature
    // Expo Go cannot run has to say so rather than reach the native call.
    if (Constants.appOwnership === 'expo') {
      console.log('[Push] skipped — not supported in Expo Go');
      return null;
    }

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
