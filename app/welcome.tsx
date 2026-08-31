import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApproxMark } from '@/components/ui/ApproxMark';
import { fonts, radius } from '@/constants/theme';

const LIGHT = {
  bg:     '#faf9f5',
  t1:     '#2D2A22',
  t2:     '#6B6455',
  teal:   '#E8714A',
  border: '#E8E4DA',
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: LIGHT.bg },
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
    color: LIGHT.t1,
    letterSpacing: 48 * 0.34,
    paddingLeft: 48 * 0.34,
  },
  buttons: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    gap: 12,
  },
  btnPrimary: {
    backgroundColor: LIGHT.teal,
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
    borderColor: LIGHT.border,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabelPrimary: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 17,
    color: LIGHT.bg,
  },
  btnLabelGhost: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 17,
    color: LIGHT.t1,
  },
  pressed: { opacity: 0.75 },
});

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.hero}>
        <ApproxMark size={80} color={LIGHT.teal} />
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
