/**
 * Keeps the home-screen icon in step with the in-app theme.
 *
 * The icon is swapped **when the app goes to the background**, never while the
 * user is looking at it. That is not a stylistic choice — both platforms make
 * an immediate swap hostile:
 *
 *   Android  changing the icon enables a different `activity-alias` and
 *            disables the current one, which force-stops the app. Doing that
 *            the instant somebody flips a switch in Settings would look
 *            exactly like a crash.
 *   iOS      `setAlternateIconName` posts a system alert — "You have changed
 *            the icon for Aura" — over whatever is on screen.
 *
 * Deferring costs nothing, because the only place the icon is visible is the
 * home screen, and to get there you have to background the app. By the time the
 * user can see the icon, it has already changed.
 *
 * Everything here is best-effort. A launcher that refuses the change, a build
 * without the native module (Expo Go, or a dev client built before this
 * plugin was added), or web all end in the same place: the theme still
 * switches, the icon just stays as it was.
 */
import { requireOptionalNativeModule } from 'expo';
import { AppState, type AppStateStatus, Platform } from 'react-native';

/** Icon names registered under the plugin in app.json. Keep the two in step. */
export type AppIconName = 'light' | 'dark';

/** What `getAppIcon()` reports when the primary icon is in use. */
const DEFAULT_ICON = 'DEFAULT';

let desired: AppIconName | null = null;
let subscription: { remove: () => void } | null = null;

/**
 * The native module, or null where there isn't one.
 *
 * Checked in two stages, and the order is the point. `@mozzius/expo-dynamic-app-icon`
 * resolves its native side by calling `expo-modules-core`'s `requireNativeModule`,
 * which *throws* the instant the wrapper package is first loaded if the native
 * module isn't compiled into this binary — exactly the case in Expo Go, or a
 * dev client built before this plugin was added.
 *
 * A plain `try { require(...) }` cannot catch that safely: Metro's dev-mode
 * loader reports a module factory's first-load error as fatal — a red LogBox
 * screen — before the exception ever reaches this function's catch block, so
 * the app *looks* crashed even though execution would have continued past it.
 *
 * `requireOptionalNativeModule` is the non-throwing half of that same check —
 * it returns null instead of throwing — so calling it first tells us whether
 * the wrapper package is safe to load at all, without ever triggering the
 * failing path Metro reports as fatal.
 */
function nativeIcons(): {
  setAppIcon: (name: string | null) => string | false;
  getAppIcon: () => string;
} | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  if (!requireOptionalNativeModule('ExpoDynamicAppIcon')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@mozzius/expo-dynamic-app-icon');
  } catch {
    return null;
  }
}

/**
 * Apply the queued icon now, if there is one and it is not already in use.
 *
 * Exported for the case the deferral cannot cover — see `flushAppIcon` — and
 * for tests, which have no app lifecycle to hook.
 */
export function applyPendingAppIcon(): void {
  if (desired === null) return;

  const icons = nativeIcons();
  if (!icons) return;

  try {
    // Skip a no-op swap. On Android this matters a great deal: calling
    // setAppIcon with the icon already in use would still restart the app.
    if (icons.getAppIcon() === desired) {
      desired = null;
      return;
    }
    icons.setAppIcon(desired);
    desired = null;
  } catch {
    // Leave `desired` set, so the next backgrounding tries again.
  }
}

function onAppStateChange(state: AppStateStatus): void {
  // 'inactive' is the iOS half-step — app switcher open, a call coming in —
  // and is deliberately not acted on: the user may well come straight back,
  // and on iOS the alert would then be waiting for them.
  if (state === 'background') applyPendingAppIcon();
}

/**
 * Ask for `name` to become the app icon at the next opportunity.
 *
 * Returns immediately. Call it as often as you like — only the last name asked
 * for is kept, so toggling the theme five times still costs one icon change.
 */
export function setDesiredAppIcon(name: AppIconName): void {
  desired = name;

  if (!subscription && nativeIcons()) {
    subscription = AppState.addEventListener('change', onAppStateChange);
  }

  // Already backgrounded — the listener will not fire again on its own.
  if (AppState.currentState === 'background') applyPendingAppIcon();
}

/**
 * Drop the queued change and stop listening. For sign-out and for tests; the
 * icon itself is left alone, since it is a device preference rather than
 * something belonging to the account.
 */
export function resetAppIconQueue(): void {
  desired = null;
  subscription?.remove();
  subscription = null;
}

/** The icon currently in use, as a theme name. Null when it cannot be read. */
export function currentAppIcon(): AppIconName | null {
  const icons = nativeIcons();
  if (!icons) return null;
  try {
    const name = icons.getAppIcon();
    // The primary icon is the light one — see `icon` in app.json.
    if (name === DEFAULT_ICON) return 'light';
    return name === 'dark' || name === 'light' ? name : null;
  } catch {
    return null;
  }
}
