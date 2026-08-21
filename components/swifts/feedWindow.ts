/**
 * Which cards hold a video, and which one plays.
 *
 * Two one-line decisions, pulled out of `SwiftsFeed` for two reasons. They are
 * the whole of the feed's memory behaviour, so they are worth testing without
 * standing up a list and a renderer — and a plain module can be imported by
 * the component without either file losing its Fast Refresh boundary, which is
 * the same reason `navSections` and `navGeometry` are separate.
 */

/** How many cards ahead of the active one hold a real video source.
 *
 *  One. Two would make a fast scroll buffer three videos at once, which on a
 *  mid-range Android is where the decoder budget runs out — and the second
 *  card ahead is almost never reached before the first has finished loading
 *  anyway. */
export const PRELOAD_AHEAD = 1;

/** One behind, so scrolling back up is instant rather than a black frame. */
export const PRELOAD_BEHIND = 1;

/**
 * Whether the card at `index` should be handed a real video source.
 *
 * Everything outside this window gets `null` and keeps only its poster, so a
 * card five rows away costs an image rather than a decoder and several
 * megabytes of buffer.
 */
export function shouldPreload(index: number, activeIndex: number): boolean {
  return index >= activeIndex - PRELOAD_BEHIND
    && index <= activeIndex + PRELOAD_AHEAD;
}

/**
 * Whether the card at `index` is the one that should be playing.
 *
 * Three conditions folded into one value, which is the point: the failure this
 * prevents is two players running at once, and that happens precisely when
 * more than one place gets to decide. `playbackAllowed` carries screen focus
 * and app state; `index === activeIndex` carries the viewport.
 */
export function isCardActive(
  index: number,
  activeIndex: number,
  playbackAllowed: boolean,
): boolean {
  return index === activeIndex && playbackAllowed;
}
