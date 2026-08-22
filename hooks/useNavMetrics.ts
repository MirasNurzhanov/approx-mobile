import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  NAV_ARC_H,
  NAV_BAR_GAP,
  NAV_BAR_H,
  NATIVE_TAB_BAR_H,
  navArcClearance,
  tabAlignedRightInset,
} from '@/components/navGeometry';
import { NAV_SECTIONS } from '@/components/navSections';
import { BAR_STYLE_IS_NATIVE, isIOS26OrNewer } from '@/constants/platform';
import { useNavStyle } from '@/context/NavStyleContext';

/**
 * Bar style's height above the safe-area inset, whichever bar is actually
 * drawn — the real native one where `BAR_STYLE_IS_NATIVE` (iOS), this app's
 * own floating capsule (`components/nav/AuraTabBar`) everywhere else.
 */
function barHeightAboveInset(): number {
  return BAR_STYLE_IS_NATIVE ? NATIVE_TAB_BAR_H : NAV_BAR_H + NAV_BAR_GAP;
}

/**
 * How far above the safe-area inset a floating control has to sit to clear the
 * nav, whichever nav is on.
 *
 * `fromRight` and `width` describe the control's horizontal footprint. They
 * only matter for the wheel, whose height varies across the screen; every bar
 * — native or `AuraTabBar` — spans the full width and clears the same amount
 * everywhere.
 */
export function useNavClearance(fromRight: number, width: number): number {
  const { navStyle } = useNavStyle();
  return navStyle === 'wheel' ? navArcClearance(fromRight, width) : barHeightAboveInset();
}

/**
 * Where a floating control on the right should sit horizontally, so it stacks
 * over the nav's last item (Settings) rather than hard against the edge.
 *
 * The wheel gets `edgeInset` back unchanged: its Settings wedge sits on an arc,
 * not a tab grid, and the arc's own clearance already accounts for where a
 * control is horizontally.
 */
export function useNavAlignedRight(controlWidth: number, edgeInset: number): number {
  const { navStyle } = useNavStyle();
  if (navStyle === 'wheel') return edgeInset;
  // AuraTabBar always floats in from the edges, same as the native bar does
  // from iOS 26 on — see tabAlignedRightInset.
  const floating = !BAR_STYLE_IS_NATIVE || isIOS26OrNewer;
  return tabAlignedRightInset(controlWidth, NAV_SECTIONS.length, floating);
}

/**
 * The nav's height above the safe-area inset — what scrolling content has to
 * clear at the bottom so its last row isn't left underneath the nav.
 *
 * Measured against the wheel expanded rather than collapsed: overshooting
 * leaves trailing space, undershooting hides a row behind opaque chrome.
 */
export function useNavHeight(): number {
  const { navStyle } = useNavStyle();
  return navStyle === 'wheel' ? NAV_ARC_H : barHeightAboveInset();
}

/** `useNavHeight` plus the safe-area inset and a little breathing room, ready
 *  to drop straight into a list's `paddingBottom`. */
export function useNavContentPadding(extra = 20): number {
  const { bottom } = useSafeAreaInsets();
  const navHeight = useNavHeight();
  return bottom + navHeight + extra;
}
