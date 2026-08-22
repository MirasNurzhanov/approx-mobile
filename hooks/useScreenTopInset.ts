import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isIOS26OrNewer } from '@/constants/platform';

/**
 * The top padding a screen's root needs above its own content.
 *
 * Screens that draw their own header pad the root by the safe-area inset so the
 * header clears the status bar and notch. Where the *system* draws the header
 * instead, UIKit has already laid the content out beneath the navigation bar —
 * adding the inset again would push everything down by the height of a status
 * bar for no reason.
 *
 * Only meaningful on a screen whose header goes through `ScreenHeader`. A
 * screen still drawing its own header unconditionally wants `useSafeAreaInsets`
 * as before.
 */
export function useScreenTopInset(): number {
  const { top } = useSafeAreaInsets();
  return isIOS26OrNewer ? 0 : top;
}
