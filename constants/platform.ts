import { Platform } from 'react-native';

/**
 * The major iOS version, or 0 anywhere that is not iOS.
 *
 * A pure function so the gate can be tested without mocking react-native, and
 * because getting this wrong is a silent cross-platform bug: `Platform.Version`
 * is a string like `"26.0"` on iOS but a *number* on Android — the API level.
 * Android 14 reports 34, which would sail straight past a bare `>= 26` and turn
 * on iOS-only behaviour there. Hence the OS check first, before any parsing.
 *
 * Anything unparseable answers 0 rather than throwing: an unrecognised version
 * should fall back to the behaviour every device already had, not take the app
 * down on launch.
 */
export function resolveIOSMajorVersion(os: string, version: unknown): number {
  if (os !== 'ios') return 0;
  const major = parseInt(String(version), 10);
  return Number.isFinite(major) && major > 0 ? major : 0;
}

export const IOS_MAJOR_VERSION = resolveIOSMajorVersion(Platform.OS, Platform.Version);

/**
 * iOS 26 or newer, where UIKit draws navigation bars with the Liquid Glass
 * appearance — so on those devices the app hands its headers to the system
 * instead of drawing its own.
 *
 * This is the single capability gate for that decision. Import it rather than
 * writing another `Platform.OS === 'ios' && …` check; `components/ui/ScreenHeader`
 * is the only place that should normally need it.
 */
export const isIOS26OrNewer = IOS_MAJOR_VERSION >= 26;
