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

// Both platforms declare ACCESS_BACKGROUND_LOCATION now: app.json sets
// expo-location's `isAndroidBackgroundLocationEnabled: true` (with
// `isAndroidForegroundServiceEnabled` alongside it, since Android will not keep
// updates flowing while backgrounded without a foreground service). Location
// sharing is otherwise account-scoped, not app-lifecycle-scoped — it should
// stop only on sign-out or the user choosing Paused, not on backgrounding.
export const SUPPORTS_BACKGROUND_LOCATION = true;

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
  /**
   * Withheld by something outside the user's control — Screen Time,
   * parental controls, or an MDM profile. Distinct from `blocked` because the
   * remedy is different and often not the user's to apply: Settings will show
   * the switch greyed out rather than flippable.
   *
   * expo-location does not surface iOS's `restricted` authorization status
   * directly, so this is only reached when the platform reports it explicitly.
   * When it cannot be told apart from a permanent refusal it reads as
   * `blocked`, which points at the same screen and is the safe direction to be
   * wrong in.
   */
  | 'restricted'
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
      'Approx needs the camera to post a story or send a photo in chat. Photos are only sent when you choose to share one.',
    purpose: 'Take stories and photos in chat.',
    denied:
      'Stories and photos in chat need camera access before you can capture one.',
  },
  location: {
    title: 'Location',
    primer:
      'Approx shows your friends where you are, and shows you people nearby who share your interests. Friends see you whenever Ghost Mode is off; anyone else only after you tap Check in on the map, for that session. Granting this never makes you visible to them by itself.',
    purpose: 'Show you to your friends, and find people nearby.',
    denied:
      'The map can’t show anyone nearby without location access.',
  },
  locationBackground: {
    title: 'Keep sharing while Approx is closed',
    primer:
      'iOS will ask whether Approx may use your location Always. That keeps your place on your friends’ maps current while Approx is closed and your phone is locked — and, during a session you checked in, on the maps of people nearby. It stops when you turn this off or turn on Ghost Mode.',
    purpose: 'Keep your place on your friends’ maps current while Approx is closed.',
    denied:
      'Approx will only update your location while the app is open. You can change this in Settings → Approx → Location.',
  },
  notifications: {
    title: 'Notifications',
    primer:
      'Get told when someone sends you a Hi, accepts your request, messages you, or posts in your clubs. Without this, you’ll only find out by opening the app.',
    purpose: 'Alerts for Hi requests, new friends, messages and club chat.',
    denied:
      'You won’t be told about new Hi requests, friends, messages or club chat.',
  },
};

// ─── Reading status ───────────────────────────────────────────────────────────
function toState(status: string, canAskAgain: boolean): PermissionState {
  if (status === 'granted') return 'granted';
  if (status === 'undetermined') return 'undetermined';
  // Only reached when the platform names it. See the `restricted` note on
  // PermissionState for why this is defensive rather than load-bearing.
  if (status === 'restricted') return 'restricted';
  return canAskAgain ? 'denied' : 'blocked';
}

/** Whether the OS will still show a dialog for this state.
 *
 * The single question `PermissionPrimer` branches on, and the reason it lives
 * here rather than in the component: "may this sheet offer a way out" is the
 * same question, and getting it wrong in either direction is an App Store
 * rejection. See the header note in components/PermissionPrimer.
 */
export function canStillPrompt(state: PermissionState): boolean {
  return state === 'undetermined' || state === 'denied';
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
  if (!SUPPORTS_BACKGROUND_LOCATION) {
    return { key: 'locationBackground', state: 'unsupported', caveat: null };
  }
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
  locationBackground: async () => {
    if (!SUPPORTS_BACKGROUND_LOCATION) return { status: 'denied', canAskAgain: false };
    return Location.requestBackgroundPermissionsAsync();
  },
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

// ─── Background location ──────────────────────────────────────────────────────
//
// Kept apart from the generic `request` because the iOS flow genuinely is
// different, and because *when* it is asked for is the thing App Review
// rejected the app over.
//
// The rule, stated once: **nothing requests background location because a
// screen mounted.** It is requested when somebody turns on a feature that
// cannot work without it — keeping their location current while Approx is closed
// — and at no other time. `app/(tabs)/map.tsx` used to chain it off the
// foreground grant on mount, which is a request nobody asked for.
//
// The iOS sequence this has to respect:
//
//   1. Background cannot be asked for at all until foreground is granted. iOS
//      simply refuses, and expo-location reports it as denied — which would
//      look to us like the user said no.
//   2. With foreground granted as "While Using the App", asking for background
//      shows Apple's *upgrade* prompt ("Change to Always Allow?"). That is the
//      legitimate path and it is the one this takes.
//   3. iOS offers that upgrade prompt a limited number of times. Once it stops,
//      the only remaining route is Settings, and pretending otherwise leaves a
//      button that does nothing.

export type BackgroundOutcome =
  /** Always / background is granted. */
  | 'granted'
  /** Foreground is not granted, so iOS will not even consider background. */
  | 'needs_foreground'
  /** Asked, and the user chose to stay on While Using the App. */
  | 'declined'
  /** No dialog left. Settings is the only route. */
  | 'needs_settings'
  | 'unsupported';

/**
 * Read the background state without prompting.
 *
 * Answers `granted` when Always is already in force — which is what stops this
 * from asking a second time. iOS treats a repeat request as a no-op anyway, but
 * a UI that offers to turn on something already on is its own bug.
 */
export async function backgroundStatus(): Promise<BackgroundOutcome> {
  if (!SUPPORTS_BACKGROUND_LOCATION) return 'unsupported';
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) return 'needs_foreground';

  const background = await Location.getBackgroundPermissionsAsync();
  if (background.granted) return 'granted';
  return background.canAskAgain ? 'declined' : 'needs_settings';
}

/**
 * Ask for background location, through iOS's own upgrade flow.
 *
 * Call this only from an explicit user action that turns on continuous
 * location — never speculatively. The caller is expected to have shown its own
 * explanation first; `PERMISSION_COPY.locationBackground` is that text, so the
 * explanation and the request cannot drift apart.
 *
 * Returns what actually happened, so the caller can tell "they said no" from
 * "iOS would not ask" and show the right thing. Both are ordinary outcomes and
 * neither is an error.
 */
export async function requestBackground(): Promise<BackgroundOutcome> {
  const before = await backgroundStatus();
  // Already on, or nothing to ask. Asking again would be noise at best.
  if (before !== 'declined') return before;

  try {
    await Location.requestBackgroundPermissionsAsync();
  } catch {
    // Fall through — re-reading below gives the real state either way.
  }
  await refreshPermissions(['locationBackground']);
  return backgroundStatus();
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
  ...(SUPPORTS_BACKGROUND_LOCATION ? (['locationBackground'] as PermissionKey[]) : []),
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
