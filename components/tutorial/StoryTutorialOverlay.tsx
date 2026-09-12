import { useEffect } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Button } from '@/components/ui/Button';
import { useNavContentPadding } from '@/hooks/useNavMetrics';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { fonts, lightColors } from '@/constants/theme';

/** Hole radius as a fraction of the shorter screen dimension — big enough to
 *  read as "the map", small enough to still look like a spotlight. */
const HOLE_RATIO = 0.22;

/**
 * The scrim as a single path: the whole screen, with a circular hole cut out
 * by the `evenodd` fill rule. Deliberately not `<Mask>` — this app's only
 * other SVG (components/Speedometer.tsx) draws everything with plain `Path`,
 * which is proven to render on this build; `Mask`/`Defs` were untested here
 * and, on the New Architecture (`app.json`: `newArchEnabled`), a plausible
 * source of a native-level crash with no JS error to show for it.
 *
 * A circle needs two arcs to close — a single `A` command cannot return to
 * its own start point — which is why the hole is two commands, not one.
 */
function scrimPath(width: number, height: number, cx: number, cy: number, r: number): string {
  const outer = `M0,0 H${width} V${height} H0 Z`;
  const hole =
    `M${cx - r},${cy} ` +
    `A${r},${r} 0 1,0 ${cx + r},${cy} ` +
    `A${r},${r} 0 1,0 ${cx - r},${cy} Z`;
  return `${outer} ${hole}`;
}

export function StoryTutorialOverlay({ onDismiss }: { onDismiss: () => void }) {
  const { width, height } = useWindowDimensions();
  const { top } = useSafeAreaInsets();
  // Lifts the panel clear of whichever nav is drawn. "Got it" used to sit at
  // `bottom: 0`, which is underneath the nav — and the nav wins the touch on
  // every style: iOS bar style is a real UITabBar that UIKit draws outside
  // this view tree, where no zIndex here can reach it, and the wheel's root
  // absorbs every touch across its whole rectangle so its arc does not pan the
  // map. Either way the button rendered but could not be pressed, leaving a
  // first-run overlay with no way out.
  //
  // Through `useNavContentPadding` rather than the geometry constants, because
  // the wheel's arc is roughly 200pt tall against the capsule's 62 — a fixed
  // number is right for at most one nav style.
  const navPad = useNavContentPadding(24);
  const reduceMotion = useReduceMotion();
  const holeR = Math.min(width, height) * HOLE_RATIO;
  // Upper right rather than screen centre: the owner's own avatar sits at the
  // map's centre, so a spotlight there points the tutorial at yourself
  // instead of at the gesture. Floored against the top inset so the finger
  // above it never lands under the status bar on a short screen.
  const cx = width * 0.72;
  const cy = Math.max(height * 0.32, top + holeR + 70);

  // A still finger points at nothing in particular; the bounce is what reads
  // as "tap here". Reduce Motion drops the movement and keeps the finger put.
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(
      reduceMotion
        ? 0
        : withRepeat(
            withSequence(
              withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }),
              withTiming(0, { duration: 650, easing: Easing.in(Easing.cubic) }),
            ),
            -1,
          ),
    );
  }, [pulse, reduceMotion]);

  const fingerStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + pulse.get() * 0.45,
    transform: [{ translateY: pulse.get() * 8 }],
  }));

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.root]}
      accessible
      accessibilityViewIsModal
      accessibilityLabel="Press and hold anywhere on the map for 2 seconds to post a story"
    >
      {/* The scrim, with a circular hole punched over the centre of the map
          so the surface being taught is visible through it. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Path
          d={scrimPath(width, height, cx, cy, holeR)}
          fill="rgba(0,0,0,0.6)"
          fillRule="evenodd"
        />
      </Svg>

      <Animated.Text
        style={[styles.finger, fingerStyle, { top: cy - holeR - 56, left: cx - 22 }]}
        importantForAccessibility="no"
      >
        👇
      </Animated.Text>

      <View style={[styles.panel, { paddingBottom: navPad }]}>
        <Text style={styles.text}>
          Press and hold anywhere on the map for 2 seconds to post a story
        </Text>
        <Button label="Got it" onPress={onDismiss} size="lg" fullWidth />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the Speedometer's own zIndex (100) and the map's floating controls
  // — this step covers the whole screen, navbar included, per the spec.
  root: { zIndex: 1000, elevation: 11 },
  finger: {
    position: 'absolute',
    fontSize: 44,
  },
  panel: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 0,
    gap: 16,
    alignItems: 'center',
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
    // `lightColors.bg` rather than a text token: the scrim is dark regardless
    // of which theme the app is in, so this needs the light palette's near-
    // white background colour to read as light text, not its (dark) t1.
    color: lightColors.bg,
  },
});
