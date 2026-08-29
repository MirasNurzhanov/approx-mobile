import { Gesture } from 'react-native-gesture-handler';
import { withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/**
 * Pull a bottom sheet down to close it.
 *
 * ## Why this exists
 *
 * Every custom sheet in the app already drew a grab handle — the little
 * rounded bar under the top edge — and none of them could be grabbed. The
 * handle is a piece of affordance vocabulary that says "drag me", and it was
 * decoration: the only way to dismiss any of these was to tap the backdrop,
 * which is a different gesture in a different place. Somebody who reaches for
 * the handle first (which is what the handle is *for*) gets nothing, decides
 * the sheet is stuck, and taps around until something works.
 *
 * The two sheets that do drag — `SwiftCommentsSheet` and `SwiftLocationSheet`
 * — get it from `presentationStyle="pageSheet"`, i.e. from UIKit, for free.
 * This is the same behaviour for the sheets that are drawn rather than
 * presented.
 *
 * ## The rules it implements
 *
 * **Downward only.** `translationY` is clamped at 0, so dragging up does not
 * lift the sheet off the bottom of the screen and leave a gap under it. A
 * sheet that can be flung upward is a sheet with a second, undefined resting
 * position.
 *
 * **Distance or speed, either one.** Past `DISMISS_FRACTION` of its height it
 * closes; below that it closes anyway if the finger was moving down faster
 * than `DISMISS_VELOCITY`. Distance alone would refuse a quick flick — which
 * is how most people actually dismiss a sheet — and velocity alone would fire
 * on a slow deliberate drag that the user then decided against.
 *
 * **Otherwise it springs back**, with the same `spring` config the sheet was
 * opened with, so the return trip and the arrival look like one component
 * rather than two.
 *
 * ## Why the caller supplies `sheetY`
 *
 * The map already owns one `sheetY` shared value that both its sheets animate
 * from, and `openSheet`/`closeSheet` drive it. A hook that made its own would
 * be a second source of truth for one position — the sheet would be at 0
 * according to one and 560 according to the other the first time a drag and a
 * programmatic close overlapped. So this drives the value the screen already
 * has, and `onDismiss` is the screen's own close function, which means a
 * dragged dismiss and a backdrop-tapped dismiss run exactly the same code.
 */

/** How far down, as a fraction of the sheet's travel, before releasing closes
 *  it. A third: far enough that a small accidental drag springs back, near
 *  enough that dismissing does not feel like a haul. */
const DISMISS_FRACTION = 0.33;

/** Points per second past which a release closes the sheet whatever distance
 *  it covered. Tuned to the speed of a deliberate flick rather than the drift
 *  at the end of a slow drag. */
const DISMISS_VELOCITY = 900;

export interface SheetDragOptions {
  /** The shared value the sheet's `translateY` reads. 0 is open. */
  sheetY: SharedValue<number>;
  /** How far down the sheet travels to be fully off screen. */
  height: number;
  /** The screen's own close function — the same one the backdrop calls. */
  onDismiss: () => void;
  /** Spring used for the snap back. Pass the one the sheet opens with. */
  spring?: object;
  /** Set false to leave the sheet undraggable (a modal mid-submit, say). */
  enabled?: boolean;
}

export function useSheetDrag({
  sheetY,
  height,
  onDismiss,
  spring = { damping: 22, stiffness: 220, mass: 0.9 },
  enabled = true,
}: SheetDragOptions) {
  return Gesture.Pan()
    .enabled(enabled)
    // Only claim the gesture once the finger has actually travelled downward.
    // Without this the pan wins over a child's tap on touch-down and every
    // button inside the sheet stops responding.
    .activeOffsetY(8)
    .failOffsetY(-8)
    .onUpdate((e) => {
      'worklet';
      // Clamped at 0: down only. See the note above.
      sheetY.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      'worklet';
      const farEnough = e.translationY > height * DISMISS_FRACTION;
      const fastEnough = e.velocityY > DISMISS_VELOCITY;
      if (farEnough || fastEnough) {
        // `onDismiss` owns the exit animation *and* the state teardown — it is
        // the screen's own close function. Handing it back to the JS thread
        // rather than animating to `height` here is what keeps one close path
        // instead of two; `scheduleOnRN` is how the rest of this app crosses
        // that boundary (see `map.tsx`'s spring callbacks).
        scheduleOnRN(onDismiss);
        return;
      }
      sheetY.set(withSpring(0, spring));
    });
}
