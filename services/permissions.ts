import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AppState, Linking, Platform } from 'react-native';
import { useSyncExternalStore } from 'react';

// Every OS permission the app touches, in one place.
//
// Two rules this module exists to enforce:
//
//  1. Nothing here prompts unless you call `request`. `check` is always
//     silent, so a screen can render its denied state without burning the one
//     dialog iOS will ever show for that permission.
//  2. A grant is never cached across a backgrounding. iOS "Allow Once" expires
//     the moment the app is backgrounded, and either OS lets the user revoke
//     from Settings while we are suspended — so the store re-checks on
//     foreground rather than trusting what it saw at launch.

export type PermissionKey =
  | 'camera'
  | 'location'
  | 'locationBackground'
  | 'notifications';

export type PermissionState =
  /** Usable. */
  | 'granted'
  /** Refused, but we may ask again. */
  | 'denied'
  /** Refused permanently — only the OS settings screen can change it. */
  | 'blocked'
  /** Never asked. This is the only state where priming is worth showing. */
  | 'undetermined'
  /** Not available on this platform/build. */
  | 'unsupported';

export interface PermissionInfo {
  key: PermissionKey;
  state: PermissionState;
  /** Extra nuance for the in-between grants — approximate location, or
   * while-in-use when we asked for always. Null when fully granted. */
  caveat: string | null;
}

/** What each permission buys the user. Shown in the primer and in Settings,
 * so the explanation and the request can never drift apart. */
export const PERMISSION_COPY: Record<PermissionKey, {
  title: string;
  /** Shown before the OS dialog. Say what it unlocks, not what it is. */
  primer: string;
  /** Shown in Settings → Permissions. */
  purpose: string;
  /** Shown when blocked. */
  denied: string;
}> = {
  camera: {
    title: 'Camera',
    primer:
      'Quests are verified from a photo you take right now, so Aura needs the camera. Photos are only sent when you submit a quest, a story, or a message.',
    purpose: 'Take quest proof photos, stories, and photos in chat.',
    denied:
      'Quests need a live camera photo to be verified, so they can’t be completed until camera access is on.',
  },
  location: {
    title: 'Location',
    primer:
      'Aura shows people with shared interests near you right now. Without location the map has nothing to show. You control how precise it is, and can pause it any time.',
    purpose: 'Find people nearby and place you on the map.',
    denied:
      'The map can’t show anyone nearby without location access.',
  },
  locationBackground: {
    title: 'Background location',
    primer:
      'Aura can keep finding people and sound zones while the app is closed. This is optional — everything works while the app is open without it.',
    purpose: 'Keep finding nearby people and zones while the app is closed.',
    denied:
      'Aura will only find people while the app is open.',
  },
  notifications: {
    title: 'Notifications',
    primer:
      'Get told when someone sends you a Hi, accepts your request, or messages you. Without this, you’ll only find out by opening the app.',
    purpose: 'Alerts for Hi requests, new friends, and messages.',
    denied:
      'You won’t be told about new Hi requests, friends, or messages.',
  },
};

// ─── Reading status ───────────────────────────────────────────────────────────
function toState(status: string, canAskAgain: boolean): PermissionState {
  if (status === 'granted') return 'granted';
  if (status === 'undetermined') return 'undetermined';
  return canAskAgain ? 'denied' : 'blocked';
}

async function readCamera(): Promise<PermissionInfo> {
  const r = await ImagePicker.getCameraPermissionsAsync();
  return { key: 'camera', state: toState(r.status, r.canAskAgain), caveat: null };
}

async function readLocation(): Promise<PermissionInfo> {
  const r = await Location.getForegroundPermissionsAsync();
  let caveat: string | null = null;
  // Android "approximate location" and iOS "Precise: Off" both still report
  // granted. The map works, but the fix is in OS settings, not in our app.
  if (r.granted && r.android?.accuracy === 'coarse') {
    caveat = 'Approximate only — precise location is off in system settings';
  }
  return { key: 'location', state: toState(r.status, r.canAskAgain), caveat };
}

async function readLocationBackground(): Promise<PermissionInfo> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) {
    // The OS refuses to even ask for background until foreground is granted.
    return { key: 'locationBackground', state: 'undetermined', caveat: 'Needs location access first' };
  }
  const r = await Location.getBackgroundPermissionsAsync();
  let caveat: string | null = null;
  if (!r.granted && foreground.ios?.scope === 'whenInUse') {
    caveat = 'Set to “While Using the App”';
  }
  return { key: 'locationBackground', state: toState(r.status, r.canAskAgain), caveat };
}

async function readNotifications(): Promise<PermissionInfo> {
  const r = await Notifications.getPermissionsAsync();
  let caveat: string | null = null;
  // iOS provisional authorization: notifications arrive silently, in the
  // notification centre only. Granted, but the user will not see banners.
  if (r.granted && Platform.OS === 'ios' && r.ios?.status === 2 /* provisional */) {
    caveat = 'Delivered quietly — no banners or sounds';
  }
  return { key: 'notifications', state: toState(r.status, r.canAskAgain), caveat };
}

const READERS: Record<PermissionKey, () => Promise<PermissionInfo>> = {
  camera: readCamera,
  location: readLocation,
  locationBackground: readLocationBackground,
  notifications: readNotifications,
};

/** Silent status read — never shows a dialog. */
export async function check(key: PermissionKey): Promise<PermissionInfo> {
  try {
    return await READERS[key]();
  } catch {
    return { key, state: 'unsupported', caveat: null };
  }
}

// ─── Requesting ───────────────────────────────────────────────────────────────
const REQUESTERS: Record<PermissionKey, () => Promise<{ status: string; canAskAgain: boolean }>> = {
  camera: () => ImagePicker.requestCameraPermissionsAsync(),
  location: () => Location.requestForegroundPermissionsAsync(),
  locationBackground: () => Location.requestBackgroundPermissionsAsync(),
  notifications: () => Notifications.requestPermissionsAsync(),
};

/**
 * Show the OS dialog. Call this only after the user has agreed to an in-app
 * explanation — see `usePermissionPrimer`. Requesting cold spends the single
 * dialog iOS allows, and a cold refusal is permanent until the user finds the
 * Settings app on their own.
 */
export async function request(key: PermissionKey): Promise<PermissionInfo> {
  try {
    await REQUESTERS[key]();
  } catch {
    // Fall through: re-reading gives us the real state either way.
  }
  const info = await check(key);
  setState({ ...state, [key]: info });
  return info;
}

export function openAppSettings(): void {
  Linking.openSettings().catch(() => {});
}

// ─── Store ────────────────────────────────────────────────────────────────────
type StoreState = Partial<Record<PermissionKey, PermissionInfo>>;

let state: StoreState = {};
const listeners = new Set<() => void>();

function setState(next: StoreState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePermissionStore(): StoreState {
  return useSyncExternalStore(subscribe, () => state);
}

export const ALL_PERMISSIONS: PermissionKey[] = [
  'location',
  'locationBackground',
  'camera',
  'notifications',
];

export async function refreshPermissions(
  keys: PermissionKey[] = ALL_PERMISSIONS,
): Promise<StoreState> {
  const results = await Promise.all(keys.map(check));
  const next = { ...state };
  for (const info of results) next[info.key] = info;
  setState(next);
  return next;
}

// A grant read at launch is not evidence of a grant now: iOS "Allow Once"
// lapses on backgrounding, and either OS can revoke from Settings while we are
// suspended. Re-read every time we come back to the foreground.
let appStateBound = false;

export function bindForegroundRefresh(): () => void {
  if (appStateBound) return () => {};
  appStateBound = true;
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active') refreshPermissions().catch(() => {});
  });
  return () => {
    sub.remove();
    appStateBound = false;
  };
}
