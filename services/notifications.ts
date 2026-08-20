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

// One Android channel per kind of news, matching notifications/push.py's
// CATEGORIES — the server stamps `channelId` on every message it sends.
//
// The channels are the point, not decoration. Android exposes them
// individually in system settings, so a member of six noisy clubs can mute
// club chat there and keep direct messages loud, at whatever importance and
// sound they prefer, without the app needing to offer that control itself.
// One 'default' channel meant every notification was the same notification.
//
// Names and descriptions are user-facing: this is the list someone reads in
// Settings → Apps → Aura → Notifications.
//
// A channel's importance is fixed at creation — Android ignores later changes
// to one that already exists, and only the user can move it after that. Which
// is the intended behaviour here: their choice outranks ours on every launch.
const ANDROID_CHANNELS: {
  id: string;
  name: string;
  description: string;
  importance: Notifications.AndroidImportance;
}[] = [
  {
    id: 'messages',
    name: 'Messages',
    description: 'Direct messages from people you are connected to.',
    importance: Notifications.AndroidImportance.MAX,
  },
  {
    id: 'clubs',
    name: 'Club chat',
    description: 'New messages in clubs you have joined.',
    importance: Notifications.AndroidImportance.DEFAULT,
  },
  {
    id: 'events',
    name: 'Meetups',
    description: 'Meetups proposed, confirmed or declined in your clubs.',
    importance: Notifications.AndroidImportance.HIGH,
  },
  {
    id: 'social',
    name: 'Requests & activity',
    description: 'Hi requests, new connections, and reactions to your stories.',
    importance: Notifications.AndroidImportance.HIGH,
  },
  {
    id: 'default',
    name: 'Other',
    description: 'Anything that does not belong to the categories above.',
    importance: Notifications.AndroidImportance.DEFAULT,
  },
];

async function ensureAndroidChannels(): Promise<void> {
  await Promise.all(
    ANDROID_CHANNELS.map((channel) =>
      Notifications.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        description: channel.description,
        importance: channel.importance,
        vibrationPattern: [0, 250, 250, 250],
      }).catch((e: unknown) => {
        // One unsupported channel must not stop the others, and must not stop
        // registration — a phone with no channels still receives pushes.
        console.log(`[Push] channel ${channel.id} failed:`, (e as Error)?.message ?? e);
      }),
    ),
  );
}

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
      await ensureAndroidChannels();
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
