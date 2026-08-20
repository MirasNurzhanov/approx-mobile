/**
 * Geometry of the nav arc, separate from the component that draws it.
 *
 * The map and the Swifts feed both need to know how much room the arc takes so
 * their floating controls clear it, and importing that from Speedometer.tsx
 * would cost that file its Fast Refresh boundary.
 */
import { Dimensions } from 'react-native';

const { width: W } = Dimensions.get('window');

/** Outer radius of the arc. Speedometer builds the rest of its geometry on it. */
export const NAV_ARC_R_OUT = W / 2 - 4;

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
