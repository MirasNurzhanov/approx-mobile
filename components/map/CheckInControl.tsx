import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { fonts } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { checkIn, checkOut, useCheckIn } from '@/services/checkIn';
import { useGhostMode, usePrivacySettings } from '@/services/privacy';

/**
 * Check in / check out, on the map — the only way to be seen by anybody who is
 * not a friend (App Review 5.1.2(i)).
 *
 * Drawn only when there is something to do: discovery is Discoverable and
 * Ghost Mode is off. Private means friends-only permanently, so there is no
 * control at all; Ghost means nobody sees anybody, so there is nothing a
 * check-in could add. Unknown (settings not loaded) draws nothing rather than
 * a button that might not work.
 *
 * Checking in is a tap and a confirmation that says what it means, every
 * session. Nothing else calls `checkIn` — see noAutomaticVisibility.test.ts.
 */
export function CheckInControl({ top }: { top: number }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { settings } = usePrivacySettings();
  const ghost = useGhostMode();
  const { checkedIn, expiresAt } = useCheckIn();
  const [busy, setBusy] = useState(false);

  if (!settings || settings.discovery_mode !== 'discoverable' || ghost !== false) return null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } catch (e: any) {
      Alert.alert('That didn’t work', e?.response?.data?.detail ?? 'Check your connection and try again.');
    }
    setBusy(false);
  }

  function confirmCheckIn() {
    Alert.alert(
      'Check in for this session?',
      'People nearby who aren’t your friends will see you on the map, as an area about 500 m across — and you’ll see them. '
        + 'It ends when you check out, close Approx, or after 8 hours. Your friends can see you either way.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Check in', onPress: () => run(checkIn) },
      ],
    );
  }

  function confirmCheckOut() {
    Alert.alert(
      'Check out?',
      'People who aren’t your friends will stop seeing you, and you’ll see only your friends. Your friends can still see you.',
      [
        { text: 'Stay checked in', style: 'cancel' },
        { text: 'Check out', style: 'destructive', onPress: () => run(checkOut) },
      ],
    );
  }

  const until = expiresAt
    ? new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top }]}>
      <Pressable
        onPress={checkedIn ? confirmCheckOut : confirmCheckIn}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={checkedIn
          ? `Checked in${until ? ` until ${until}` : ''}. People nearby can see you. Check out`
          : 'Friends only. Check in so people nearby can see you this session'}
        style={({ pressed }) => [styles.pill, checkedIn && styles.pillOn, pressed && { opacity: 0.8 }]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={checkedIn ? colors.bg : colors.teal} />
        ) : (
          <>
            <View style={[styles.dot, { backgroundColor: checkedIn ? colors.bg : colors.t3 }]} />
            <Text style={[styles.text, checkedIn && styles.textOn]}>
              {checkedIn ? `Checked in${until ? ` · until ${until}` : ''}` : 'Friends only'}
            </Text>
            <Text style={[styles.action, checkedIn && styles.textOn]}>
              {checkedIn ? 'Check out' : 'Check in'}
            </Text>
            <Ionicons name={checkedIn ? 'log-out-outline' : 'location-outline'} size={15}
              color={checkedIn ? colors.bg : colors.teal} />
          </>
        )}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    minHeight: 38, paddingHorizontal: 14, borderRadius: 100,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
  },
  pillOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontFamily: fonts.body, fontSize: 13, color: colors.t2 },
  action: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.teal },
  textOn: { color: colors.bg },
});
