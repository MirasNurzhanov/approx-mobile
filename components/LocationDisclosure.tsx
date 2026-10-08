import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// What being on the map means, said once, before the first position is sent.
//
// This is the affirmative moment in the new model. Sharing follows the OS
// location permission — there is no check-in and no Live/Approximate choice —
// so without this nobody is ever told, in the app's own words, that other
// people can see where they are. `services/locationDisclosure.ts` holds the
// flag and `services/location.ts` refuses to transmit until it is set, so the
// screen is genuinely upstream of the first pin rather than beside it.
//
// One button and no dismissal. Not a consent gate in the sense the OS dialog
// is — the OS asked its own question already and Apple is specific that
// nothing may stand between a custom explainer and it (5.1.1(iv), which this
// app has been rejected under once; see components/PermissionPrimer). What
// this adds is the part the system dialog cannot say: who sees you, how
// precisely, and where the off switch is.
//
// The three facts are stated in the order somebody would ask them, and the
// third is the one that makes the first two acceptable to read.

interface Props {
  visible: boolean;
  onAcknowledge: () => void;
}

const POINTS: { title: string; body: string }[] = [
  {
    title: 'Your friends see exactly where you are',
    body: 'Friends see your precise position on the map whenever Ghost Mode is off — including while Approx is closed, if you allowed that. There’s nothing to switch on for them.',
  },
  {
    title: 'Nobody else, unless you check in',
    body: 'People who aren’t your friends see you only after you tap Check in on the map, and only until you close Approx — as a rough area of about 500m. Opening Approx never checks you in.',
  },
  {
    title: 'Ghost Mode hides you from everyone',
    body: 'One switch in Privacy & safety. While it is on nobody can see you — friends included — you cannot see anyone either, and the rest of Approx keeps working.',
  },
];

export function LocationDisclosure({ visible, onAcknowledge }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <Modal visible={visible} transparent animationType="fade">
      {/* Not a Pressable, and `onRequestClose` is absent: there is nothing to
          dismiss this with, because a screen somebody can swipe past has not
          told them anything. */}
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal accessible={false}>
          <Text style={styles.title} accessibilityRole="header">
            Who sees you on the map
          </Text>

          {POINTS.map((point) => (
            <View key={point.title} style={styles.point}>
              <Text style={styles.pointTitle}>{point.title}</Text>
              <Text style={styles.body}>{point.body}</Text>
            </View>
          ))}

          <Pressable
            onPress={onAcknowledge}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Got it"
            accessibilityHint="Closes this and lets Approx start sharing your location"
          >
            <Text style={styles.primaryText}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 28,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    gap: 14,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.title,
    color: colors.t1,
  },
  point: { gap: 2 },
  pointTitle: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: typography.body,
    color: colors.t1,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: typography.body,
    lineHeight: typography.body * 1.45,
    color: colors.t2,
  },
  primary: {
    backgroundColor: colors.teal,
    borderRadius: radius.m,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryText: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: typography.body,
    color: colors.bg,
  },
  pressed: { opacity: 0.7 },
});
