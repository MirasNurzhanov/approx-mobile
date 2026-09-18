/**
 * The home-screen icon, kept in step with the in-app theme.
 *
 * A local native module rather than `@mozzius/expo-dynamic-app-icon`, which
 * this app used once and removed: on Android that library sends the app to the
 * background and then kills its process half a second later, and it disabled
 * `MainActivity` itself — the component the running screen belongs to. From
 * the user's side both are a crash. This module does neither:
 *
 *   Android  the launcher entries are two `activity-alias`es pointing at
 *            `MainActivity` (see app.plugin.js). A request is only recorded;
 *            the aliases are swapped once every screen of the app has stopped,
 *            i.e. when the user has left it, and only the aliases are touched,
 *            with DONT_KILL_APP. A permission dialog pauses the app but does
 *            not stop it, so it never triggers the swap.
 *   iOS      `setAlternateIconName` runs straight away, because iOS refuses it
 *            for an app in the background. The system shows its own "You have
 *            changed the icon" alert; that is the platform's behaviour and
 *            cannot be suppressed.
 *
 * Everything is best-effort. Expo Go, a development build made before this
 * module existed, web, or a launcher that refuses the change all end the same
 * way: the theme still switches and the icon stays as it was.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type AppIconName = 'light' | 'dark';

interface NativeAppIcon {
  /** Resolves true once the change is applied (iOS) or scheduled (Android). */
  setIcon(name: AppIconName): Promise<boolean>;
  getIcon(): Promise<AppIconName>;
}

// Optional, not required: the throwing variant would take the app down in any
// binary built without this module.
const native =
  Platform.OS === 'ios' || Platform.OS === 'android'
    ? requireOptionalNativeModule<NativeAppIcon>('ApproxAppIcon')
    : null;

/** Whether this build can change its icon at all. */
export function isAppIconSwitchingAvailable(): boolean {
  return native != null;
}

/** Ask for the icon that matches `name`. Never throws. */
export async function setAppIcon(name: AppIconName): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.setIcon(name);
  } catch {
    return false;
  }
}

/** The icon currently on the home screen, or null where that cannot be known. */
export async function getAppIcon(): Promise<AppIconName | null> {
  if (!native) return null;
  try {
    return await native.getIcon();
  } catch {
    return null;
  }
}
