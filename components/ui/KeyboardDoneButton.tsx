import { Keyboard, Pressable, StyleSheet, Text } from 'react-native';

import { fonts, type, withAlpha, type ColorPalette } from '@/constants/theme';

/**
 * "Done" pill that closes the keyboard, for search bars that sit above a list.
 *
 * Those lists all set `keyboardShouldPersistTaps="handled"` so the first tap on
 * a result selects it instead of being eaten to dismiss the keyboard. The cost
 * is that tapping the list cannot dismiss it either, and once results fill the
 * panel there is no backdrop left to tap — so on a short list there was no way
 * out of the keyboard at all except the hardware back button. Dragging the list
 * now dismisses as well (`keyboardDismissMode="on-drag"`), but a two-row result
 * list has nowhere to drag. This is the affordance that always works.
 *
 * Sits inside the search bar rather than floating over the keyboard: an
 * `InputAccessoryView` would be the iOS-native home for it, but it is iOS-only
 * and this has to work the same on both.
 *
 * Rendered only while the field holds focus, so the bar looks unchanged at rest.
 */
export function KeyboardDoneButton({
  visible,
  palette,
  label = 'Done',
}: {
  visible: boolean;
  palette: ColorPalette;
  label?: string;
}) {
  if (!visible) return null;

  return (
    <Pressable
      onPress={() => Keyboard.dismiss()}
      hitSlop={10}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: withAlpha(palette.t1, 0.1) },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Close keyboard"
    >
      {/* t1, not t2: this is an action, and at 13pt t3 fails AA on surface. */}
      <Text style={[styles.label, { color: palette.t1 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pressed: { opacity: 0.6 },
  label: {
    fontFamily: fonts.body,
    fontSize: type.small,
    fontWeight: '600',
  },
});
