import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Platform, Pressable, StyleSheet, TextInput } from 'react-native';

import { GlassSurface } from '@/components/ui/GlassSurface';
import { fonts } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { useKeyboardVisible } from '@/hooks/useKeyboardVisible';

/**
 * The message bar shared by direct messages and club chat.
 *
 * One component so the two cannot drift: they had grown into near-copies with
 * the same three faults — a send button whose fill was hidden under its own
 * glass (only the outline turned to the accent), home-indicator padding kept
 * while the keyboard covered the home indicator, and four filled circles
 * crowding a field that needs the width.
 */

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface ComposerAction {
  icon: IconName;
  label: string;
  onPress: () => void;
}

interface ChatComposerProps {
  text: string;
  canSend: boolean;
  /** Safe-area inset below the bar; only applies while the keyboard is down. */
  bottom: number;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** Camera, photo library, a meetup — in the order they should appear. */
  actions: ComposerAction[];
}

/** Black or white, whichever reads on `hex` — the accent differs per theme. */
export function onColour(hex: string): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return '#FFFFFF';
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#04211D' : '#FFFFFF';
}

export function ChatComposer({ text, canSend, bottom, onChangeText, onSend, actions }: ChatComposerProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const keyboardUp = useKeyboardVisible();

  return (
    <GlassSurface
      style={[styles.bar, { paddingBottom: keyboardUp ? 8 : bottom + 6 }]}
      // Heavier than a floating control: this sits over scrolling messages, and
      // a light wash would let text slide visibly under the composer.
      opacity={0.86}
    >
      {actions.map((action) => (
        <Pressable
          key={action.label}
          onPress={action.onPress}
          hitSlop={4}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Ionicons name={action.icon} size={23} color={colors.t2} />
        </Pressable>
      ))}

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={onChangeText}
        placeholder="Message…"
        placeholderTextColor={colors.t3}
        multiline
        maxLength={2000}
      />

      {/* A plain button, not a glass one: the glass wash is drawn above a
          view's own background, which is what hid the accent fill before. */}
      <Pressable
        onPress={onSend}
        disabled={!canSend}
        hitSlop={8}
        style={({ pressed }) => [
          styles.send,
          canSend ? { backgroundColor: colors.teal } : styles.sendIdle,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        accessibilityState={{ disabled: !canSend }}
      >
        <Ionicons name="arrow-up" size={20} color={canSend ? onColour(colors.teal) : colors.t3} />
      </Pressable>
    </GlassSurface>
  );
}

const SIZE = 36;

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  action: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: SIZE,
    maxHeight: 120,
    backgroundColor: colors.surface2,
    borderRadius: SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 8 : 6,
    paddingBottom: Platform.OS === 'ios' ? 8 : 6,
    fontFamily: fonts.body,
    color: colors.t1,
    fontSize: 15,
    lineHeight: 20,
  },
  send: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIdle: { backgroundColor: colors.surface2 },
  pressed: { opacity: 0.7 },
});
