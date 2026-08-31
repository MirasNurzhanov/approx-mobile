/**
 * Geometry of the two bottom navs, separate from the components that draw them.
 *
 * The map and the Swifts feed both need to know how much room the nav takes so
 * their floating controls clear it, and importing that from the components
 * would cost those files their Fast Refresh boundary.
 *
 * Which of the two is on screen is a user setting, so nothing here should be
 * read directly by a screen — go through `hooks/useNavMetrics`, which picks the
 * right set for the nav actually being drawn.
 */
import { Dimensions, Platform } from 'react-native';

const { width: W } = Dimensions.get('window');

// ─── Wheel (components/Speedometer) ───────────────────────────────────────────

/** Outer radius of the arc. Speedometer builds the rest of its geometry on it. */
export const NAV_ARC_R_OUT = W / 2 - 4;

/** The arc's full height when expanded, matching Speedometer's own `SVG_H`. */
export const NAV_ARC_H = NAV_ARC_R_OUT + 6;

/**
 * How far above the safe-area inset a control of `width`, inset `fromRight`
 * points from the right edge, has to sit to clear the nav arc.
 *
 * Takes the control's whole footprint rather than a single x on purpose: the
 * arc rises toward the middle of the screen, so a control near the right edge
 * is tallest under its *inner* edge. Measuring at its centre leaves the arc
 * cutting through the bottom corner nearest the middle.
 *
 * Measured against the expanded arc, not the collapsed slim bar: overshooting
 * while collapsed only leaves a larger gap, whereas undershooting overlaps.
 */
export function navArcClearance(fromRight: number, width: number): number {
  const centre = W / 2;
  const near = fromRight;          // the control's right side
  const far = fromRight + width;   // its left side
  // Closest the footprint gets to the arc's apex, where the arc is tallest.
  const d =
    near <= centre && far >= centre
      ? 0
      : Math.min(Math.abs(centre - near), Math.abs(centre - far));
  return d >= NAV_ARC_R_OUT ? 0 : Math.sqrt(NAV_ARC_R_OUT * NAV_ARC_R_OUT - d * d);
}

// ─── Bar (components/nav/ApproxTabBar) ──────────────────────────────────────────
//
// iOS draws this only on `/market`, the one screen outside the tab group —
// inside it, iOS's bar style is the real native tab bar, which reports its
// own height through the safe-area inset and needs no measurements from here.
// Android has no native bar for its own bar style to inherit (see
// constants/platform's `BAR_STYLE_IS_NATIVE`), so every Android screen
// measures against this instead, standalone or not.

/** The bar itself, not counting the gap beneath it. */
export const NAV_BAR_H = 62;

/** Gap between the bottom of the bar and the safe-area inset. */
export const NAV_BAR_GAP = 10;

/** Side margin. The bar floats in from both edges rather than spanning them. */
export const NAV_BAR_INSET = 16;

// ─── Bar (the system tab bar, app/(tabs)/_layout) ─────────────────────────────

/**
 * How far above the safe-area inset the *system* tab bar reaches.
 *
 * A constant, because neither react-native-screens nor expo-router exposes the
 * live height, and it has to be a constant of this shape: the tab bar sits on
 * top of the inset rather than inside it. React Navigation models its own bar
 * the same way — `TABBAR_HEIGHT_UIKIT (49) + insets.bottom` — so anything
 * floating above the bar needs `insets.bottom + this`.
 *
 * This was briefly 0, on the assumption that UIKit folds the bar into the
 * bottom safe-area inset. It does not, and the map's locate button ended up
 * underneath the tab bar. Erring high on purpose, for the reason
 * `navArcClearance` gives: overshooting leaves a slightly larger gap,
 * undershooting hides the control.
 *
 * iOS 49 is the classic UIKit height; iOS 26's floating bar is taller and
 * carries its own margin, hence 68. Android's Material 3 navigation bar is
 * 80dp.
 */
export const NATIVE_TAB_BAR_H = Platform.select({ ios: 68, android: 84, default: 68 });

/**
 * The right inset that centres a floating control of `controlWidth` over the
 * *last* tab item — Settings — instead of hard against the screen edge.
 *
 * `floating` is true wherever the bar floats in from both edges rather than
 * spanning them — iOS 26's own tab bar, and Android's ApproxTabBar, which
 * always floats — so its items sit across a narrower strip than the screen.
 * Every other case spans edge to edge. `NAV_BAR_INSET` stands in for both:
 * Apple's floating margin is within a couple of points of it, and it is
 * ApproxTabBar's actual margin.
 */
export function tabAlignedRightInset(controlWidth: number, tabCount: number, floating: boolean): number {
  const barEdge = floating ? NAV_BAR_INSET : 0;
  const lastItemCentreFromRight = barEdge + (W - barEdge * 2) / (tabCount * 2);
  return Math.max(8, Math.round(lastItemCentreFromRight - controlWidth / 2));
}
