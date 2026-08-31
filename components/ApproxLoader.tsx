import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { fonts, withAlpha } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

const N_PARTICLES = 12;
const DISTANCE    = 88;
const CORE_R      = 12;
const PARTICLE_R  = 5;
const RING_BASE   = 56;

function Core({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.set(
      withRepeat(
        withSequence(
          withTiming(1.18, { duration: 900, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      ),
    );
  }, [scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return <Animated.View style={[styles.core, style]} />;
}

function Particle({ styles, index, color }: {
  styles: ReturnType<typeof makeStyles>; index: number; color: string;
}) {
  const anim = useSharedValue(0);
  const angle = (2 * Math.PI * index) / N_PARTICLES;
  const dx = DISTANCE * Math.cos(angle);
  const dy = DISTANCE * Math.sin(angle);

  useEffect(() => {
    anim.set(
      withDelay(
        (index / N_PARTICLES) * 1300,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 650, easing: Easing.in(Easing.quad) }),
          ),
          -1,
        ),
      ),
    );
  }, [anim, index]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(anim.get(), [0, 1], [0, dx]) },
      { translateY: interpolate(anim.get(), [0, 1], [0, dy]) },
    ],
  }));

  return <Animated.View style={[styles.particle, { backgroundColor: color }, style]} />;
}

function Ring({ styles, index, color }: {
  styles: ReturnType<typeof makeStyles>; index: number; color: string;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.55);

  useEffect(() => {
    const delay = (index / 3) * 1700;
    scale.set(
      withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(3.4, { duration: 1700, easing: Easing.out(Easing.quad) }),
            withTiming(1, { duration: 0 }),
          ),
          -1,
        ),
      ),
    );
    opacity.set(
      withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(0, { duration: 1700, easing: Easing.out(Easing.quad) }),
            withTiming(0.55, { duration: 0 }),
          ),
          -1,
        ),
      ),
    );
  }, [scale, opacity, index]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ scale: scale.get() }],
  }));

  return <Animated.View style={[styles.ring, { borderColor: color }, style]} />;
}

export function ApproxLoader() {
  const { colors } = useTheme();
  // Kept despite react-doctor/react-compiler-no-manual-memoization: dropping it
  // is not a no-op here. Compiling this file with and without the wrapper shows
  // the cache shrinking from 37 slots to 23 — the compiler stops caching
  // `makeStyles(colors)` and, with it, every `styles.*` read downstream.
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        {/* Wave rings */}
        {Array.from({ length: 3 }, (_, i) => (
          <Ring key={i} styles={styles} index={i} color={i === 1 ? colors.purple : colors.teal} />
        ))}

        {/* Particles */}
        {Array.from({ length: N_PARTICLES }, (_, i) => (
          <Particle
            key={i}
            styles={styles}
            index={i}
            color={i % 2 === 0 ? colors.teal : colors.purple}
          />
        ))}

        {/* Core */}
        <Core styles={styles} />
      </View>

      <Text style={styles.wordmark}>APPROX</Text>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 48,
  },
  stage: {
    width:          DISTANCE * 2,
    height:         DISTANCE * 2,
    alignItems:     'center',
    justifyContent: 'center',
  },
  ring: {
    position:     'absolute',
    width:        RING_BASE,
    height:       RING_BASE,
    borderRadius: RING_BASE / 2,
    borderWidth:  1.5,
  },
  particle: {
    position:     'absolute',
    width:        PARTICLE_R * 2,
    height:       PARTICLE_R * 2,
    borderRadius: PARTICLE_R,
  },
  core: {
    position:      'absolute',
    width:         CORE_R * 2,
    height:        CORE_R * 2,
    borderRadius:  CORE_R,
    backgroundColor: colors.teal,
    boxShadow:     `0 0 14px ${withAlpha(colors.teal, 0.85)}`,
  },
  wordmark: {
    fontFamily:    fonts.display,
    color:         colors.t1,
    fontSize:      26,
    fontWeight:    '800',
    letterSpacing: 8,
    textAlign:     'center',
    alignSelf:     'center',
    width:         '100%',
    paddingLeft:   8,
  },
});
