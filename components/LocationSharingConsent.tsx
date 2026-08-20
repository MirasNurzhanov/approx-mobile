import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconClose, IconEye, IconEyeOff, IconLock } from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { LOCATION_SHARING_LABEL, type LocationSharing } from '@/services/privacy';

// What sharing your location means, said before it starts.
//
// The Live / Approximate / Paused buttons are the whole of the control over
// whether Aura publishes where you are, and Paused is where every account
// begins. This sheet is what stands between Paused and the other two: App
// Review rejected 5.1.2(i) against a build where being on the map followed
// from granting a location permission, and the answer is that it now follows
// from reading this and pressing the button underneath it.
//
// Shown only on the way *off* Paused. Moving between Live and Approximate is a
// change of precision by somebody already sharing, and Paused is always one
// press away with nothing in between — a confirmation on the way out would be
// a dialog standing between a user and hiding.
//
// Shown again on the next launch, because visibility does not outlive the run
// of the app that chose it (services/sharingSession.ts). That is why the copy
// below says "or close Aura" rather than only naming Paused: the sentence has
// to describe the whole of what was agreed to, including the end of it.

interface Props {
  /** The mode being moved to, or null when the sheet is closed. */
  mode: LocationSharing | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (mode: LocationSharing) => void;
}

const BODY: Record<'live' | 'approximate', string> = {
  live: 'Your live location will be visible to nearby Aura users until you set it back to Paused or close Aura.',
  approximate:
    'Your rough area — about 500m across, never your exact position — will be visible to nearby Aura users until you set it back to Paused or close Aura.',
};

export function LocationSharingConsent({ mode, busy, onCancel, onConfirm }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();

  // `paused` never opens this, so the body lookup below is total. Guarded
  // anyway rather than cast: a future fourth mode should render nothing here
  // instead of an empty sheet with a confirm button on it.
  const body = mode && mode !== 'paused' ? BODY[mode] : null;

  return (
    <Modal
      visible={body !== null}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={[styles.sheet, { paddingBottom: bottom + 20 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>
              Share your location{mode && mode !== 'paused'
                ? ` · ${LOCATION_SHARING_LABEL[mode]}`
                : ''}
            </Text>
            <Pressable
              onPress={onCancel}
              hitSlop={12}
              style={({ pressed }) => pressed && { opacity: 0.2 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <IconClose size={20} color={colors.t3} />
            </Pressable>
          </View>

          {/* The sentence the whole feature rests on. First, short, and
              deliberately not softened — anything vaguer would be the app
              being coy about the part that matters. */}
          <Text style={styles.consent}>{body}</Text>

          <View style={styles.facts}>
            <View style={styles.fact}>
              <IconEye size={16} color={colors.t3} />
              <Text style={styles.factText}>
                You stay visible with Aura in the background and your phone
                locked. Closing Aura ends it, and you choose again next time.
              </Text>
            </View>
            <View style={styles.fact}>
              <IconEyeOff size={16} color={colors.t3} />
              <Text style={styles.factText}>
                Choose Paused any time to disappear — we delete the location we
                were holding, and you can still browse the map.
              </Text>
            </View>
            <View style={styles.fact}>
              <IconLock size={16} color={colors.t3} />
              <Text style={styles.factText}>
                People you’ve blocked never see you, whichever mode you pick.
              </Text>
            </View>
          </View>

          <Pressable
            disabled={busy || !mode}
            onPress={() => mode && onConfirm(mode)}
            style={({ pressed }) => [
              styles.confirm,
              pressed && { opacity: 0.8 },
              busy && { opacity: 0.5 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Start sharing my location with nearby people"
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.bg} />
            ) : (
              <Text style={styles.confirmText}>Start sharing</Text>
            )}
          </Pressable>

          <Pressable
            disabled={busy}
            onPress={onCancel}
            style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Cancel and stay hidden"
          >
            <Text style={styles.cancelText}>Stay hidden</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)' },
  sheet: {
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: colors.surface,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18,
    marginTop: 6,
  },
  title: {
    flex: 1,
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 17,
    color: colors.t1,
  },
  //: Sized up rather than treated as body copy — it is the thing being agreed
  //: to, not context around it.
  consent: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.t1,
    marginBottom: 18,
  },
  facts: { gap: 12, marginBottom: 22 },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  factText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.t3,
  },
  confirm: {
    minHeight: 52,
    borderRadius: radius.m,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: 15,
    color: colors.bg,
  },
  cancel: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  cancelText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 14,
    color: colors.t3,
  },
});
