import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SWIFT_EFFECTS } from '@/constants/swiftEffects';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { GlassSurface } from '@/components/ui/GlassSurface';
import {
  COUNTDOWN_CHOICES,
  DURATION_CHOICES,
  SPEED_CHOICES,
  type SwiftRotation,
} from '@/services/swiftDraft';

/**
 * The trays that slide up over the camera: speed, effects, timer, rotation.
 *
 * One file for four of them because they are the same control — a row of
 * mutually exclusive chips over a dark scrim — differing only in what they
 * list. Four files would be four copies of the same forty lines of styling,
 * and the styling is the part that has to stay identical: these open in the
 * same place, over the same preview, and a chip row that is 2pt taller in one
 * of them is visible as a jump when the creator switches trays.
 *
 * ## Why these are chips and not sliders
 *
 * Every value here is one the creator picks *while holding a phone up at a
 * scene*. A slider needs a drag and a look; a chip needs a thumb. Speed in
 * particular has five real values people use, and a continuous dial would
 * offer 1.37× as prominently as 2× while being harder to hit than either.
 *
 * The one continuous control in the composer — effect intensity — is a slider,
 * and it lives in the editor rather than here, because it is a thing you tune
 * while looking at a result rather than while filming.
 */

// ── Speed ────────────────────────────────────────────────────────────────────

/** How each speed is labelled. Written the way people say them. */
const SPEED_LABELS: Record<number, string> = {
  30: '0.3×',
  50: '0.5×',
  100: '1×',
  200: '2×',
  300: '3×',
};

interface SpeedProps {
  value: number;
  onChange: (speedPercent: number) => void;
  /** Recording is under way; speed is fixed for the take once it starts. */
  disabled?: boolean;
}

/**
 * How fast the recording plays back.
 *
 * Worth being precise about what this does, because it is not what the label
 * suggests: the camera always records at its own frame rate, and this sets the
 * rate the *player* runs at. So 2× is not "record faster" — it is "record
 * normally, play at double", which is why a 2× take may roll for two minutes
 * and still be a sixty-second Swift. `recordLimitMs` does that conversion, and
 * the shutter's own ceiling follows from it.
 */
export function SpeedTray({ value, onChange, disabled = false }: SpeedProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <GlassSurface style={styles.tray} tone="dark" opacity={SCRIM}>
      <Text style={styles.trayLabel} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
        Speed
      </Text>
      <View style={styles.row}>
        {SPEED_CHOICES.map((speed) => {
          const active = value === speed;
          return (
            <Pressable
              key={speed}
              onPress={() => onChange(speed)}
              disabled={disabled}
              style={[
                styles.chip,
                active && styles.chipOn,
                disabled && styles.chipOff,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={`Play at ${SPEED_LABELS[speed]} speed`}
            >
              <Text
                style={[styles.chipText, active && styles.chipTextOn]}
                maxFontSizeMultiplier={MAX_SCALE_FIXED}
              >
                {SPEED_LABELS[speed]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </GlassSurface>
  );
}

// ── Effects ──────────────────────────────────────────────────────────────────

interface EffectProps {
  value: string;
  onChange: (effect: string) => void;
}

/**
 * The colour treatment, chosen before filming.
 *
 * Before filming rather than after, deliberately — the effect is live on the
 * preview, so the creator frames the shot under the look it will publish
 * under. It is still fully reversible in the editor; nothing is baked.
 */
export function EffectTray({ value, onChange }: EffectProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <GlassSurface style={styles.tray} tone="dark" opacity={SCRIM}>
      <Text style={styles.trayLabel} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
        Effect
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollRow}
      >
        {SWIFT_EFFECTS.map((effect) => {
          const active = value === effect.key;
          return (
            <Pressable
              key={effect.key || 'original'}
              onPress={() => onChange(effect.key)}
              style={[styles.chip, active && styles.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${effect.label} effect`}
            >
              {/* A swatch of the effect's own first layer, so the chip shows
                  what it does rather than only naming it. The original gets a
                  neutral outline instead, because "no colour" has no swatch. */}
              <View
                style={[
                  styles.swatch,
                  effect.layers.length > 0
                    ? { backgroundColor: effect.layers[0].color }
                    : styles.swatchNone,
                ]}
              />
              <Text
                style={[styles.chipText, active && styles.chipTextOn]}
                maxFontSizeMultiplier={MAX_SCALE_FIXED}
              >
                {effect.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </GlassSurface>
  );
}

// ── Timer ────────────────────────────────────────────────────────────────────

interface TimerProps {
  countdownS: number;
  limitMs: number | null;
  onCountdown: (seconds: number) => void;
  onLimit: (ms: number | null) => void;
}

/**
 * Hands-free recording: a countdown before it starts, a ceiling on how long.
 *
 * The two together are what make it possible to film yourself: the countdown
 * buys the seconds it takes to put the phone down and step back, and the limit
 * stops the take without anybody having to walk over and press the button
 * again. Either alone is close to useless for that, which is why they are one
 * tray rather than two.
 *
 * The limit is in **played** milliseconds — "a 15-second Swift" means fifteen
 * seconds as watched — so at 0.5× the camera actually rolls for seven and a
 * half. `recordLimitMs` on the draft does that conversion; nothing here has to
 * know about it.
 */
export function TimerTray({ countdownS, limitMs, onCountdown, onLimit }: TimerProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <GlassSurface style={styles.tray} tone="dark" opacity={SCRIM}>
      <Text style={styles.trayLabel} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
        Countdown
      </Text>
      <View style={styles.row}>
        {COUNTDOWN_CHOICES.map((seconds) => {
          const active = countdownS === seconds;
          return (
            <Pressable
              key={seconds}
              onPress={() => onCountdown(seconds)}
              style={[styles.chip, active && styles.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={seconds === 0 ? 'No countdown' : `${seconds} second countdown`}
            >
              <Text
                style={[styles.chipText, active && styles.chipTextOn]}
                maxFontSizeMultiplier={MAX_SCALE_FIXED}
              >
                {seconds === 0 ? 'Off' : `${seconds}s`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.trayLabel, styles.trayLabelSpaced]} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
        Stop after
      </Text>
      <View style={styles.row}>
        {DURATION_CHOICES.map((ms) => {
          const active = limitMs === ms;
          return (
            <Pressable
              key={ms}
              // Pressing the active one clears it: the ceiling is a convenience
              // and has to be as easy to take off as to put on.
              onPress={() => onLimit(active ? null : ms)}
              style={[styles.chip, active && styles.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Stop recording after ${ms / 1000} seconds`}
            >
              <Text
                style={[styles.chipText, active && styles.chipTextOn]}
                maxFontSizeMultiplier={MAX_SCALE_FIXED}
              >
                {ms / 1000}s
              </Text>
            </Pressable>
          );
        })}
      </View>
    </GlassSurface>
  );
}

// ── Rotation ─────────────────────────────────────────────────────────────────

interface RotationProps {
  value: SwiftRotation;
  onChange: (rotation: SwiftRotation) => void;
}

const ROTATIONS: SwiftRotation[] = [0, 90, 180, 270];

/**
 * A quarter turn, applied at playback.
 *
 * Needed because a phone's recorded orientation and the orientation somebody
 * was holding it in are not always the same — a clip filmed on a tripod, or
 * imported from a library that wrote its rotation into a container flag some
 * decoders ignore, arrives sideways. Correcting it here is one number; asking
 * every player to guess consistently is not.
 */
export function RotationTray({ value, onChange }: RotationProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <GlassSurface style={styles.tray} tone="dark" opacity={SCRIM}>
      <Text style={styles.trayLabel} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
        Rotate
      </Text>
      <View style={styles.row}>
        {ROTATIONS.map((deg) => {
          const active = value === deg;
          return (
            <Pressable
              key={deg}
              onPress={() => onChange(deg)}
              style={[styles.chip, active && styles.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={deg === 0 ? 'No rotation' : `Rotate ${deg} degrees`}
            >
              <Text
                style={[styles.chipText, active && styles.chipTextOn]}
                maxFontSizeMultiplier={MAX_SCALE_FIXED}
              >
                {deg}°
              </Text>
            </Pressable>
          );
        })}
      </View>
    </GlassSurface>
  );
}

/** The wash over the camera preview, matching `CaptureStep`'s own chrome. */
const SCRIM = 0.55;

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  tray: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.m,
    gap: 8,
  },
  trayLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.micro,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.72)',
  },
  trayLabelSpaced: { marginTop: 6 },

  row: { flexDirection: 'row', gap: 8 },
  scrollRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 52,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  chipOff: { opacity: 0.4 },
  chipText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    color: '#FFFFFF',
  },
  chipTextOn: { color: '#111111' },

  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  swatchNone: {
    backgroundColor: 'transparent',
    borderColor: colors.t3,
    borderWidth: 1.5,
  },
});
