import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';

interface SwiftProgressProps {
  /** 0–1. Values outside the range are clamped rather than trusted. */
  progress: number;
  bottom: number;
}

export function SwiftProgress({ progress, bottom }: SwiftProgressProps) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return (
    <View style={[styles.track, { bottom }]} pointerEvents="none">
      <View style={[styles.fill, { width: `${pct * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  fill: {
    height: 2,
    backgroundColor: colors.teal,
  },
});
