import { useLayoutEffect, useState } from 'react';
import { AccessibilityInfo, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { fonts, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// Two handles over a track, marking the slice that loops.
//
// Built on gesture-handler like RadiusSlider next door, and for the same
// reason: a native slider package means a fresh dev build for everybody before
// the app will start at all. This one needs two thumbs anyway, which no
// off-the-shelf slider gives you.
//
// The scale is linear, unlike RadiusSlider's. Time is the one quantity where
// people already have an exact mental model — a second at 0:04 is the same
// length as a second at 2:30 — so bending the axis would make the control lie.
//
// A playhead rides over the top while the preview is running. Without it the
// two handles are an abstract range; with it, you can see the loop turn over.

const THUMB = 26;
const TRACK_H = 40;

/** Milliseconds → pixels along the usable track.
 *
 *  A module-level function rather than a closure over the component's own
 *  `safeDuration`/`travel`, so the layout effect that syncs the handles can
 *  depend on those two numbers instead of on a callback identity that changes
 *  on every render. */
function msToX(ms: number, duration: number, travel: number): number {
  return (Math.max(0, Math.min(duration, ms)) / duration) * travel;
}

interface Props {
  /** The whole track, in milliseconds. */
  duration: number;
  startMs: number;
  endMs: number;
  /** Continuous, while a handle is moving. */
  onChange: (start: number, end: number) => void;
  /** Once, on release — the cue to save. */
  onCommit: (start: number, end: number) => void;
  /** Playback position, drawn as a line. Null when nothing is playing. */
  positionMs?: number | null;
  /** Shortest loop worth allowing; the handles cannot close past it. */
  minLengthMs: number;
  format: (ms: number) => string;
  disabled?: boolean;
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { width: '100%' },
  trackArea: { height: 56, justifyContent: 'center' },
  disabled: { opacity: 0.4 },

  track: {
    height: TRACK_H,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  /** The part that survives the trim. Everything outside it is dimmed rather
   *  than hidden, so the cut is visible as a proportion of the whole. */
  selection: {
    position: 'absolute',
    height: TRACK_H,
    backgroundColor: colors.tealTint,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.tealLine,
  },
  playhead: {
    position: 'absolute',
    width: 2,
    height: TRACK_H,
    backgroundColor: colors.t1,
    borderRadius: 1,
  },
  handle: {
    position: 'absolute',
    width: THUMB,
    height: TRACK_H + 8,
    borderRadius: 8,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Two lines on the handle, the universal "grab here". */
  grip: { width: 2, height: 14, borderRadius: 1, backgroundColor: colors.bg, marginHorizontal: 1.5 },
  gripRow: { flexDirection: 'row' },

  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  scaleText: { fontFamily: fonts.body, fontSize: typography.micro, color: colors.t3 },
});

export function TrimSlider({
  duration, startMs, endMs, onChange, onCommit, positionMs,
  minLengthMs, format, disabled,
}: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  };

  const travel = Math.max(width - THUMB, 1);
  const safeDuration = Math.max(duration, 1);

  const toX = (ms: number) => msToX(ms, safeDuration, travel);

  // Where each handle is being dragged to, in pixels. Shared values so the
  // drag is drawn on the UI thread; the millisecond values follow on the JS
  // side one render later, which is fine for text but not for a thumb.
  const startX = useSharedValue(0);
  const endX = useSharedValue(0);

  // Pulling the handles back in line with the props — after a nudge, after the
  // first `onLayout` gives `travel` a real width, and on the return leg of a
  // drag.
  //
  // `useLayoutEffect`, not the render body. These two writes used to sit bare
  // in the render, which Reanimated's strict mode reports as "Writing to
  // `value` during component render": a render can be thrown away or replayed,
  // and a shared value written from one escapes React entirely. A plain
  // `useEffect` would fix the warning and cost a frame — the handles would
  // paint at the old positions and jump on the next tick. A layout effect runs
  // synchronously after the commit and before the paint, so the position lands
  // in the same frame the render did.
  useLayoutEffect(() => {
    startX.set(msToX(startMs, safeDuration, travel));
    endX.set(msToX(endMs, safeDuration, travel));
  }, [startMs, endMs, safeDuration, travel, startX, endX]);

  const emit = (xStart: number, xEnd: number, commit: boolean) => {
    const start = Math.round((xStart / travel) * safeDuration);
    const end = Math.round((xEnd / travel) * safeDuration);
    if (commit) {
      onCommit(start, end);
      // The handles carry no text of their own, and the readout beside them is
      // a separate node a screen reader would not connect to the gesture.
      AccessibilityInfo.announceForAccessibility?.(`Loop ${format(start)} to ${format(end)}`);
    } else {
      onChange(start, end);
    }
  };

  /** Pixels the handles must stay apart to honour `minLengthMs`. */
  const minGap = (minLengthMs / safeDuration) * travel;

  // The gestures live on the handles, not the track, so neither `e.x` (which
  // would be relative to the handle itself, and tiny) nor `e.absoluteX` (which
  // is relative to the screen, and the track does not start there) is the
  // number wanted. `translationX` against the position the drag began at is.
  const grabbedAt = useSharedValue(0);

  // Both handles sit inside the trim screen's ScrollView. Without an activation
  // threshold Android's scroll container claims the touch first and the handles
  // never move; `shouldCancelWhenOutside(false)` keeps the drag alive when a
  // finger wanders off the 40pt track, which on a small handle is constant.
  const dragStart = Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX([-6, 6])
    .shouldCancelWhenOutside(false)
    .onBegin(() => { grabbedAt.set(startX.get()); })
    .onUpdate((e) => {
      // Clamped against the other handle, not just the track: the two cannot
      // cross, and cannot close to a stutter.
      startX.set(Math.max(
        0, Math.min(grabbedAt.get() + e.translationX, endX.get() - minGap),
      ));
      scheduleOnRN(emit, startX.get(), endX.get(), false);
    })
    .onEnd(() => { scheduleOnRN(emit, startX.get(), endX.get(), true); });

  const dragEnd = Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX([-6, 6])
    .shouldCancelWhenOutside(false)
    .onBegin(() => { grabbedAt.set(endX.get()); })
    .onUpdate((e) => {
      endX.set(Math.min(
        travel, Math.max(grabbedAt.get() + e.translationX, startX.get() + minGap),
      ));
      scheduleOnRN(emit, startX.get(), endX.get(), false);
    })
    .onEnd(() => { scheduleOnRN(emit, startX.get(), endX.get(), true); });

  const startStyle = useAnimatedStyle(() => ({ transform: [{ translateX: startX.get() }] }));
  const endStyle = useAnimatedStyle(() => ({ transform: [{ translateX: endX.get() }] }));
  const selectionStyle = useAnimatedStyle(() => ({
    left: startX.get() + THUMB / 2,
    width: Math.max(0, endX.get() - startX.get()),
  }));

  const playheadX = positionMs != null ? toX(positionMs) + THUMB / 2 : null;

  /** One a11y action steps by a twentieth of the track, which crosses it in
   *  twenty gestures and still lands on a specific second. */
  const step = safeDuration / 20;
  const nudge = (which: 'start' | 'end', delta: number) => {
    if (disabled) return;
    const next = which === 'start'
      ? [Math.max(0, Math.min(startMs + delta, endMs - minLengthMs)), endMs]
      : [startMs, Math.min(safeDuration, Math.max(endMs + delta, startMs + minLengthMs))];
    onChange(next[0], next[1]);
    onCommit(next[0], next[1]);
  };

  return (
    <View style={styles.root} onLayout={onLayout}>
      <View style={[styles.trackArea, disabled && styles.disabled]}>
        <View style={styles.track} />
        <Animated.View style={[styles.selection, selectionStyle]} />
        {playheadX != null && (
          <View style={[styles.playhead, { left: playheadX }]} pointerEvents="none" />
        )}

        <GestureDetector gesture={dragStart}>
          <Animated.View
            style={[styles.handle, startStyle]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Loop start"
            accessibilityValue={{ text: format(startMs) }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) =>
              nudge('start', e.nativeEvent.actionName === 'increment' ? step : -step)}
          >
            <View style={styles.gripRow}>
              <View style={styles.grip} />
              <View style={styles.grip} />
            </View>
          </Animated.View>
        </GestureDetector>

        <GestureDetector gesture={dragEnd}>
          <Animated.View
            style={[styles.handle, endStyle]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Loop end"
            accessibilityValue={{ text: format(endMs) }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) =>
              nudge('end', e.nativeEvent.actionName === 'increment' ? step : -step)}
          >
            <View style={styles.gripRow}>
              <View style={styles.grip} />
              <View style={styles.grip} />
            </View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.scale}>
        <Text style={styles.scaleText}>0:00</Text>
        <Text style={styles.scaleText}>{format(duration)}</Text>
      </View>
    </View>
  );
}
