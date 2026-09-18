import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApproxMark } from '@/components/ui/ApproxMark';
import { fonts, radius, type ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

const makeStyles = (c: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  wordmark: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 48,
    color: c.t1,
    letterSpacing: 48 * 0.34,
    paddingLeft: 48 * 0.34,
  },
  buttons: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    gap: 12,
  },
  btnPrimary: {
    backgroundColor: c.teal,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabelPrimary: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 17,
    color: c.bg,
  },
  btnLabelGhost: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 17,
    color: c.t1,
  },
  pressed: { opacity: 0.75 },
});

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  // The screen a signed-out user lands on, so it has to match the theme they
  // signed out of.
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.hero}>
        <ApproxMark size={80} color={colors.teal} />
        <Text style={styles.wordmark}>APPROX</Text>
      </View>

      <View style={styles.buttons}>
        <Pressable
          onPress={() => router.push('/login')}
          style={({ pressed }) => [styles.btnPrimary, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Log in"
        >
          <Text style={styles.btnLabelPrimary}>Log in</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/register')}
          style={({ pressed }) => [styles.btnGhost, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Create account"
        >
          <Text style={styles.btnLabelGhost}>Create account</Text>
        </Pressable>
      </View>
    </View>
  );
}
