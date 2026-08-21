import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  NAV_ARC_H,
  NATIVE_TAB_BAR_H,
  navArcClearance,
  tabAlignedRightInset,
} from '@/components/navGeometry';
import { NAV_SECTIONS } from '@/components/navSections';
import { useNavStyle } from '@/context/NavStyleContext';

/**
 * How far above the safe-area inset a floating control has to sit to clear the
 * nav, whichever nav is on.
 *
 * `fromRight` and `width` describe the control's horizontal footprint. They
 * only matter for the wheel, whose height varies across the screen; the system
 * tab bar spans the full width and clears the same amount everywhere.
 */
export function useNavClearance(fromRight: number, width: number): number {
  const { navStyle } = useNavStyle();
  return navStyle === 'wheel' ? navArcClearance(fromRight, width) : NATIVE_TAB_BAR_H;
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
  return navStyle === 'wheel'
    ? edgeInset
    : tabAlignedRightInset(controlWidth, NAV_SECTIONS.length);
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
  return navStyle === 'wheel' ? NAV_ARC_H : NATIVE_TAB_BAR_H;
}

/** `useNavHeight` plus the safe-area inset and a little breathing room, ready
 *  to drop straight into a list's `paddingBottom`. */
export function useNavContentPadding(extra = 20): number {
  const { bottom } = useSafeAreaInsets();
  const navHeight = useNavHeight();
  return bottom + navHeight + extra;
}
