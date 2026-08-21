import { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import { fonts, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

/**
 * A 0–100 level.
 *
 * Built on gesture-handler rather than a slider package, for the same reason
 * `TrimSlider` and `RadiusSlider` next door are: a native slider means a fresh
 * dev build for everybody before the app will start at all, and this is one
 * horizontal track with one thumb.
 *
 * Zero is a real position and is labelled "Muted" rather than "0%", because
 * that is what it means to the person setting it — and it is why there is no
 * separate mute switch to fall out of step with the number.
 */

const THUMB = 22;
const TRACK_H = 6;

interface Props {
  label: string;
  /** 0–100. */
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function VolumeSlider({ label, value, onChange, disabled = false }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [width, setWidth] = useState(0);

  const usable = Math.max(1, width - THUMB);
  const ratio = Math.min(1, Math.max(0, value / 100));

  function handleLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  function setFromX(x: number) {
    const next = Math.round(Math.min(1, Math.max(0, (x - THUMB / 2) / usable)) * 100);
    onChange(next);
  }

  // `scheduleOnRN` rather than `runOnJS`: Reanimated 4 renamed it, and the old
  // name is gone. Same job — hop from the UI thread back to JS.
  const pan = Gesture.Pan()
    .enabled(!disabled)
    .onBegin((e) => scheduleOnRN(setFromX, e.x))
    .onUpdate((e) => scheduleOnRN(setFromX, e.x))
    .shouldCancelWhenOutside(false);

  const tap = Gesture.Tap()
    .enabled(!disabled)
    .onEnd((e) => scheduleOnRN(setFromX, e.x));

  const gesture = Gesture.Race(pan, tap);

  return (
    <View style={[styles.root, disabled && styles.disabled]}>
      <View style={styles.header}>
        <Text style={styles.label} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
          {label}
        </Text>
        <Text style={styles.value} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
          {value === 0 ? 'Muted' : `${value}%`}
        </Text>
      </View>

      <GestureDetector gesture={gesture}>
        <View
          style={styles.hit}
          onLayout={handleLayout}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ min: 0, max: 100, now: value }}
          accessibilityState={{ disabled }}
          accessibilityActions={[
            { name: 'increment', label: 'louder' },
            { name: 'decrement', label: 'quieter' },
          ]}
          onAccessibilityAction={(e) => {
            if (disabled) return;
            const step = e.nativeEvent.actionName === 'increment' ? 10 : -10;
            onChange(Math.min(100, Math.max(0, value + step)));
          }}
        >
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
          </View>
          <View style={[styles.thumb, { left: ratio * usable }]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { width: '100%', gap: 6 },
  disabled: { opacity: 0.4 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.t1,
  },
  value: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    color: colors.t2,
    fontVariant: ['tabular-nums'],
  },

  hit: { height: 40, justifyContent: 'center' },
  track: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.teal },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.teal,
    borderWidth: 2,
    borderColor: colors.bg,
  },
});
