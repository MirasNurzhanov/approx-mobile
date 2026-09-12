import { useWindowDimensions } from 'react-native';

/**
 * How much room there is, expressed the way Apple asks foldables to be reasoned
 * about: **size classes, never orientation and never a device model.**
 *
 * iPhone Duo is what forces this. Its two displays are not two orientations of
 * one phone — they are two different amounts of space:
 *
 *   closed   5.4", 1398 × 2034 px — compact width, regular height. An iPhone.
 *   open     7.6", 1878 × 2670 px (~669 × 951 pt) — **regular in both
 *            dimensions**, the way an iPad reports, not the way a phone does.
 *
 * Two consequences that make the old habits actively wrong rather than merely
 * coarse:
 *
 *   1. The inner display does not honour an app's supported interface
 *      orientations. `orientation: "portrait"` in app.json does not constrain
 *      it, so any layout branch written as "portrait vs landscape" answers a
 *      question the device is no longer being asked. Width is the signal.
 *
 *   2. The fold is live. Someone can open the phone mid-task, and the HIG is
 *      explicit that the screen they were on, what they had selected and where
 *      they had scrolled all have to survive it. So this is a hook reading
 *      `useWindowDimensions`, which re-renders on the transition, rather than a
 *      value captured once at module scope — a `Dimensions.get('window')`
 *      constant is frozen at whichever pose the app launched in.
 *
 * The 600pt threshold is where a compact width stops being compact. It sits
 * above every iPhone in portrait, above the Duo's own cover display (~466pt),
 * and below the Duo's inner display (669pt) — so it separates the two poses
 * with room to spare in both directions rather than being tuned to one device.
 * An iPad, a Duo held open, and a future device with the same room all take the
 * same branch, which is the point of a size class.
 */

/** Where a compact width ends. Not a device measurement — a threshold. */
export const REGULAR_WIDTH_BREAKPOINT = 600;

/** Above this, a single column of text is running too long to read comfortably,
 *  regardless of how much room the display has. */
export const MAX_TEXT_COLUMN = 560;

export type SizeClass = 'compact' | 'regular';

export interface LayoutSize {
  width: number;
  height: number;
  /** The signal to branch on. Everything else here is derived from it. */
  widthClass: SizeClass;
  heightClass: SizeClass;
  /**
   * Regular width — there is room for two columns, a sidebar, a split view.
   *
   * Named for the *space*, not for the hardware. It is true on an unfolded
   * iPhone Duo and equally true on an iPad, and no caller should have to know
   * or care which one it is looking at.
   */
  isRegularWidth: boolean;
  /** Horizontal page margin. Wider surfaces get more, so content does not sit
   *  flush against a much larger bezel. */
  gutter: number;
  /** Cap for a single column of running text or form controls. */
  maxContentWidth: number;
  /** How many columns a grid of cards should use here. */
  columns: number;
}

export function useLayoutSize(): LayoutSize {
  const { width, height } = useWindowDimensions();

  const widthClass: SizeClass = width >= REGULAR_WIDTH_BREAKPOINT ? 'regular' : 'compact';
  const heightClass: SizeClass = height >= REGULAR_WIDTH_BREAKPOINT ? 'regular' : 'compact';
  const isRegularWidth = widthClass === 'regular';

  return {
    width,
    height,
    widthClass,
    heightClass,
    isRegularWidth,
    gutter: isRegularWidth ? 28 : 20,
    maxContentWidth: isRegularWidth ? MAX_TEXT_COLUMN : width,
    columns: isRegularWidth ? 2 : 1,
  };
}

/**
 * A centred column that stops growing once it is wide enough to read.
 *
 * The failure this prevents is the one that makes an unstretched phone app look
 * broken on a bigger display: every control stretched edge to edge across
 * 669pt, a toggle with its label at one end of the screen and its switch at the
 * other, body text at a line length nobody can track back from. Filling the
 * width is not the same as using it.
 *
 * Spread onto the *content container* of a scroll view, or onto a plain view.
 */
export function contentColumn(layout: LayoutSize) {
  return {
    width: '100%' as const,
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center' as const,
  };
}
