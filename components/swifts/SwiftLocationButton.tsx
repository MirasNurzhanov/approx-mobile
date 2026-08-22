import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { SwiftLocationIcon, type SwiftIconComponent } from '@/components/swifts/icons';
import { fonts, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';

/**
 * The reveal control on a Swift's action rail.
 *
 * Its own component rather than another entry in `SwiftActions`, because it is
 * the one control on the rail with a rule attached: it is rendered **only**
 * when `location_available` is true, which is a fact about this viewer rather
 * than about the Swift (see `swifts/visibility.py::location_available_for`).
 * Keeping it separate means that rule has somewhere to be written down, and
 * gives the reveal flow a single seam to test against.
 *
 * ## The icon
 *
 * `SwiftLocationIcon` by default — Aura's own drawing, a pin with a signal arc
 * that resolves to a filled pin once answered. `Glyph` stays a prop so the
 * artwork can be swapped without touching the rail or the card.
 *
 * ## What it deliberately does not receive
 *
 * No coordinate, no place name, no `SwiftLocation` — only whether one *can* be
 * asked for, and a callback. There is nothing in these props for a position to
 * arrive in early, which is what makes "not preloaded" a property of the code
 * rather than a promise about it.
 */

export type RevealState = 'idle' | 'loading' | 'revealed';

export interface SwiftLocationButtonProps {
  state: RevealState;
  onPress: () => void;
  /** Swap in different artwork without touching the rail. */
  Glyph?: SwiftIconComponent;
  tint?: string;
  activeTint?: string;
  size?: number;
}

/** Matches the rest of the rail: a 28pt glyph taken past the 44pt touch
 *  minimum by hitSlop rather than by padding, which would space the rail out
 *  until it covered the video. */
const GLYPH = 28;
const HIT_SLOP = { top: 10, bottom: 10, left: 12, right: 12 };

export function SwiftLocationButton({
  state,
  onPress,
  Glyph = SwiftLocationIcon,
  tint = '#FFFFFF',
  activeTint,
  size = GLYPH,
}: SwiftLocationButtonProps) {
  const revealed = state === 'revealed';

  return (
    <Pressable
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      onPress={onPress}
      disabled={state === 'loading'}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityState={{ busy: state === 'loading', selected: revealed }}
      accessibilityLabel={
        revealed
          ? 'Show where this Swift was made'
          : 'Reveal where this Swift was made'
      }
      // Spelled out because the button is the whole consent moment: a viewer
      // should know the creator learns they looked before they press it.
      accessibilityHint="The creator can see who looked up this location."
    >
      <View style={[styles.glyphSlot, { width: size, height: size }]}>
        {state === 'loading'
          ? <ActivityIndicator size="small" color={tint} />
          : <Glyph size={size} color={tint} on={revealed} onColor={activeTint} />}
      </View>
      <Text style={styles.label} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
        {revealed ? 'Place' : 'Where'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', gap: 3 },
  pressed: { opacity: 0.6 },
  glyphSlot: { alignItems: 'center', justifyContent: 'center' },
  label: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    fontWeight: '600',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
