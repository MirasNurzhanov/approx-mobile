import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconEye } from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// The second half of what App Review asked for on 5.1.2(i).
//
// services/sharingSession.ts already stops visibility from *persisting*
// automatically — a genuine relaunch that cannot present a session token gets
// checked out before anything renders. What that mechanism deliberately does
// not do is act on a resume from the background (locking the phone, switching
// apps), because treating that as a checkout is the exact bug it was built to
// avoid. So a reviewer who backgrounds and reopens the app mid-session lands
// back on the map with nothing having asked them — checked in correctly, but
// silently so.
//
// This is that moment made visible instead of silent. It does not change
// anything by itself: "Stay Active" is a no-op, and "Go Invisible" is the same
// pause any other screen offers. It only ever appears in front of an already
// affirmative choice, said back to the user before they see anyone else on
// the map this run.

interface Props {
  visible: boolean;
  busy: boolean;
  onStayActive: () => void;
  onGoInvisible: () => void;
}

export function LocationLaunchPrompt({ visible, busy, onStayActive, onGoInvisible }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android back button: staying active is the non-destructive default,
      // matching what dismissing an alert without choosing normally means.
      onRequestClose={onStayActive}
    >
      <View style={styles.root}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <IconEye size={26} color={colors.teal} />
          </View>

          <Text style={styles.title}>You are currently Active</Text>
          <Text style={styles.body}>People nearby can see you. Continue?</Text>

          <Pressable
            disabled={busy}
            onPress={onStayActive}
            accessibilityRole="button"
            accessibilityLabel="Stay active and visible to people nearby"
            style={({ pressed }) => [
              styles.primary,
              pressed && { opacity: 0.85 },
              busy && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.primaryText}>Stay Active</Text>
          </Pressable>

          <Pressable
            disabled={busy}
            onPress={onGoInvisible}
            accessibilityRole="button"
            accessibilityLabel="Go invisible and hide my location"
            style={({ pressed }) => [
              styles.secondary,
              pressed && { opacity: 0.7 },
              busy && { opacity: 0.5 },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.t2} />
            ) : (
              <Text style={styles.secondaryText}>Go Invisible</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    alignItems: 'center',
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.tealTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 18,
    color: colors.t1,
    textAlign: 'center',
    marginBottom: 6,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.t2,
    textAlign: 'center',
    marginBottom: 20,
  },
  primary: {
    width: '100%',
    minHeight: 50,
    borderRadius: radius.m,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  primaryText: { fontFamily: fonts.body, fontWeight: '700', fontSize: 15, color: colors.bg },
  secondary: {
    width: '100%',
    minHeight: 50,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { fontFamily: fonts.body, fontWeight: '600', fontSize: 15, color: colors.t1 },
});
