import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { fonts, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// A slider built on gesture-handler rather than @react-native-community/slider.
//
// Not invented-here: adding that package means a native module, and a native
// module means every developer and tester needs a fresh dev build before the
// app will start at all. This screen does not justify that. Everything below is
// the same primitives DraggableTabs already uses.
//
// The scale is deliberately non-linear. On a linear track the difference
// between a 50m and a 300m zone — the range where the choice actually changes
// who hears you — occupies 5% of the width and cannot be hit with a thumb.
// A square curve gives the small end about a third of the track.

const THUMB = 28;
const TRACK_H = 6;
const SPRING = { damping: 18, stiffness: 240 };

/** Position (0–1) → value. Squared, so the low end gets the room. */
function positionToValue(t: number, min: number, max: number): number {
  return min + (max - min) * t * t;
}

/** Value → position (0–1). The inverse of the above. */
function valueToPosition(value: number, min: number, max: number): number {
  const normalised = (value - min) / (max - min);
  return Math.sqrt(Math.max(0, Math.min(1, normalised)));
}

/** Round to something a person would say out loud. A slider that lands on
 *  "1,347 m" invites fiddling for a number that has no meaning; the steps get
 *  coarser as the values get bigger, matching how the precision stops
 *  mattering. */
function snap(value: number): number {
  if (value < 200) return Math.round(value / 10) * 10;
  if (value < 1000) return Math.round(value / 50) * 50;
  return Math.round(value / 100) * 100;
}

interface Props {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Fired once when the thumb is released — the cue to save. */
  onCommit: (value: number) => void;
  format: (value: number) => string;
  /** What this dial sizes, for assistive tech. There are two of them now — a
   *  zone's reach and how far its music carries — and "Zone radius" spoken
   *  twice would make them indistinguishable. */
  label?: string;
  disabled?: boolean;
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { width: '100%' },
  // Taller than the track it draws: the visible bar is 6pt, which is far below
  // the 44pt minimum touch target, so the hit area is padded out around it.
  trackArea: { height: 44, justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  track: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: colors.surface2,
  },
  fill: {
    position: 'absolute',
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: colors.teal,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.t1,
    borderWidth: 3,
    borderColor: colors.teal,
  },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  scaleText: { fontFamily: fonts.body, fontSize: typography.micro, color: colors.t3 },
});

export function RadiusSlider({
  value, min, max, onChange, onCommit, format, label = 'Zone radius', disabled,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const position = useSharedValue(valueToPosition(value, min, max));
  const scale = useSharedValue(1);
  /** True between onBegin and onFinalize. The effect below must not yank the
   *  thumb back to the prop while a finger is still moving it — the prop is
   *  one render behind the gesture for the whole drag. */
  const dragging = useSharedValue(false);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  // Follow a value that arrives from somewhere other than this control — the
  // server's stored radius landing after the first render, or the a11y
  // actions. Without this the thumb sits at its initial position forever.
  useEffect(() => {
    if (dragging.get()) return;
    position.set(withSpring(valueToPosition(value, min, max), SPRING));
  }, [value, min, max, position, dragging]);

  const emit = useCallback((t: number, commit: boolean) => {
    const next = snap(positionToValue(t, min, max));
    if (commit) {
      onCommit(next);
      // Announced because the thumb carries no text of its own — the readout
      // beside it is a separate node a screen reader would not connect.
      AccessibilityInfo.announceForAccessibility?.(format(next));
    } else {
      onChange(next);
    }
  }, [min, max, onChange, onCommit, format]);

  const travel = Math.max(width - THUMB, 1);

  // `e.x`, not `e.absoluteX`: the former is relative to the track, the latter
  // to the screen, and the track does not start at the screen edge.
  const pan = Gesture.Pan()
    .enabled(!disabled)
    // This control lives inside a vertical ScrollView, and without an
    // activation threshold the scroll wins every ambiguous touch — badly so on
    // Android, where the native scroll container claims the gesture early and
    // the thumb simply refuses to move. Six pixels of horizontal travel says
    // "this is a drag, not a scroll" before the scroll can take it.
    .activeOffsetX([-6, 6])
    // A finger tracing a 6pt track drifts off it constantly. Losing the drag
    // because you strayed above the bar is not a rule anyone would guess.
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      dragging.set(true);
      scale.set(withSpring(1.15, SPRING));
    })
    .onUpdate((e) => {
      const t = Math.max(0, Math.min(1, (e.x - THUMB / 2) / travel));
      position.set(t);
      scheduleOnRN(emit, t, false);
    })
    .onEnd(() => { scheduleOnRN(emit, position.get(), true); })
    .onFinalize(() => {
      dragging.set(false);
      scale.set(withSpring(1, SPRING));
    });

  // A tap anywhere on the track jumps there, so a big change does not require
  // dragging the whole way.
  const tap = Gesture.Tap()
    .enabled(!disabled)
    .onEnd((e) => {
      const t = Math.max(0, Math.min(1, (e.x - THUMB / 2) / travel));
      position.set(withSpring(t, SPRING));
      scheduleOnRN(emit, t, true);
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: position.get() * travel },
      { scale: scale.get() },
    ],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: position.get() * travel + THUMB / 2,
  }));

  return (
    <View
      style={styles.root}
      onLayout={onLayout}
      // The whole control is one adjustable thing to assistive tech; the
      // gestures above are not reachable without sight, so the a11y actions
      // are what make it operable at all.
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: format(value) }}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (disabled) return;
        // A tenth of the range per press: enough to cross the track in ten
        // gestures, fine enough to land on a specific size.
        const step = (max - min) / 10;
        const next = snap(Math.max(min, Math.min(max,
          value + (e.nativeEvent.actionName === 'increment' ? step : -step),
        )));
        position.set(withSpring(valueToPosition(next, min, max), SPRING));
        onChange(next);
        onCommit(next);
      }}
    >
      <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
        <View style={[styles.trackArea, disabled && styles.disabled]}>
          <View style={styles.track} />
          <Animated.View style={[styles.fill, fillStyle]} />
          <Animated.View style={[styles.thumb, thumbStyle]} />
        </View>
      </GestureDetector>

      <View style={styles.scale}>
        <Text style={styles.scaleText}>{format(min)}</Text>
        <Text style={styles.scaleText}>{format(max)}</Text>
      </View>
    </View>
  );
}
