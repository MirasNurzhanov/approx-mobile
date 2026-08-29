import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconClose } from '@/components/ui/icons';
import { useSheetDrag } from '@/components/ui/useSheetDrag';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  REPORT_REASONS,
  ReportFailed,
  reportContent,
  type ReportTarget,
} from '@/services/reporting';

/**
 * Travel used to work out the drag-to-dismiss threshold.
 *
 * A fixed number rather than a measured one because this sheet has no fixed
 * height — it is `maxHeight: '88%'` and sizes to whichever of its three states
 * is showing, so "a third of its height" would mean a different distance on the
 * confirmation screen than on the reason list. A constant makes the pull the
 * same everywhere, and 420 puts the threshold at ~140pt: the same reach as the
 * map's sheets.
 */
const DRAG_HEIGHT = 420;

// One sheet for reporting anything: a Swift, a story, a comment, a message, an
// account. The only thing that varies is the URL, and services/reporting knows
// which one — so every surface in the app files the same shape of report and a
// moderator sees one vocabulary.
//
// The three things this gets right that the screen it replaces did not:
//
//   * **A category is required.** Free text alone is unroutable; a moderation
//     queue is triaged by reason long before anybody reads a sentence.
//   * **Success is the server's word, not ours.** The old profile flow posted
//     to a URL that did not exist, swallowed the 404 and said "Reported —
//     thank you" regardless. Here the confirmation state is only reachable
//     after the request resolves.
//   * **Failure is shown.** Every error path lands on a message with a retry.
//
// Dismissible in every way a sheet should be — backdrop, X, Cancel, Android
// back. It is not in front of a native permission dialog, so nothing about
// Apple's pre-permission rule applies to it. See PermissionPrimer for the
// other case, where the opposite is true.

interface Props {
  visible: boolean;
  target: ReportTarget;
  targetId: number | string | null;
  /** "@ada" or "this Swift" — goes into the title so the user can see they are
   *  reporting the thing they meant to. */
  subject: string;
  onClose: () => void;
  /** Called after a report is accepted, so the caller can also hide the content
   *  or offer a block. Not called on failure. */
  onReported?: () => void;
}

export function ReportSheet({
  visible, target, targetId, subject, onClose, onReported,
}: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();

  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Pull the sheet down to close it, the same way the map's sheets and iOS's
  // own page sheets do. `handleClose` is the shared exit — the backdrop, the
  // X button and this all run it — so a dragged dismiss resets the form
  // exactly like every other way out.
  const sheetY = useSharedValue(0);
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.get() }],
  }));
  const drag = useSheetDrag({
    sheetY,
    height: DRAG_HEIGHT,
    onDismiss: handleClose,
    // Not while the report is in flight. `handleClose` is a no-op mid-submit
    // anyway, but a sheet that visibly follows the finger and then refuses to
    // go reads as broken rather than as busy.
    enabled: !busy,
  });

  function reset() {
    setReason(null);
    setNote('');
    setBusy(false);
    setError(null);
    setDone(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function submit() {
    if (!reason || targetId == null) return;
    setBusy(true);
    setError(null);
    try {
      await reportContent(target, targetId, reason, note);
      setDone(true);
      onReported?.();
    } catch (e) {
      setError(
        e instanceof ReportFailed
          ? e.message
          : 'Could not send that report. Please try again.',
      );
    }
    // Not a `finally` — React Compiler bails on any component containing one,
    // and both exits above are covered.
    setBusy(false);
  }

  // Nothing at all while closed.
  //
  // React Native's `Modal` still mounts its children when `visible` is false,
  // so returning the tree unconditionally meant every render of a host screen
  // also rendered this sheet's eight reason rows, its ScrollView and its
  // TextInput. On the Swifts feed — which re-renders on every scroll tick and
  // every optimistic count change — that is a lot of work for something nobody
  // is looking at, and it showed up first as the feed's own tests crossing
  // their time budget.
  //
  // The hooks above run either way, so this is a render bail, not a
  // conditional hook.
  if (!visible) return null;

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <Animated.View style={[styles.sheet, { paddingBottom: bottom + 20 }, sheetStyle]}>
          {/* The gesture is on this padded row, not on the 4pt bar inside it —
              a 4pt drag target is smaller than the finger reaching for it. */}
          <GestureDetector gesture={drag}>
            <View style={styles.grab}>
              <View style={styles.handle} />
            </View>
          </GestureDetector>

          {done ? (
            // The confirmation, reachable only after the server said yes.
            <View style={styles.doneWrap}>
              <Text style={styles.doneTitle}>Report sent</Text>
              <Text style={styles.doneBody}>
                Thank you. Our moderation team reviews every report, and we act
                on anything that breaks the Community Guidelines — Aura has zero
                tolerance for objectionable content and abusive users.
              </Text>
              <Text style={styles.doneBody}>
                If you want to stop hearing from this person entirely, you can
                also block them.
              </Text>
              <Pressable
                onPress={handleClose}
                style={({ pressed }) => [styles.confirm, pressed && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityLabel="Done"
              >
                <Text style={styles.confirmText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <Text style={styles.title}>Report {subject}</Text>
                <Pressable
                  onPress={handleClose}
                  hitSlop={12}
                  style={({ pressed }) => pressed && { opacity: 0.2 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <IconClose size={20} color={colors.t3} />
                </Pressable>
              </View>

              <Text style={styles.lead}>
                What is wrong with it? Choosing the closest category is what gets
                it in front of the right person fastest.
              </Text>

              <ScrollView
                style={styles.reasons}
                contentContainerStyle={styles.reasonsContent}
                showsVerticalScrollIndicator={false}
              >
                {REPORT_REASONS.map((r) => {
                  const selected = reason === r.value;
                  return (
                    <Pressable
                      key={r.value}
                      onPress={() => setReason(r.value)}
                      disabled={busy}
                      style={({ pressed }) => [
                        styles.reason,
                        selected && styles.reasonSelected,
                        pressed && { opacity: 0.8 },
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: busy }}
                      accessibilityLabel={r.label}
                      accessibilityHint={r.hint}
                    >
                      <View style={[styles.radio, selected && styles.radioOn]}>
                        {selected ? <View style={styles.radioDot} /> : null}
                      </View>
                      <View style={styles.reasonText}>
                        <Text style={[styles.reasonLabel, selected && styles.reasonLabelOn]}>
                          {r.label}
                        </Text>
                        {r.hint ? <Text style={styles.reasonHint}>{r.hint}</Text> : null}
                      </View>
                    </Pressable>
                  );
                })}

                <TextInput
                  value={note}
                  onChangeText={setNote}
                  editable={!busy}
                  multiline
                  maxLength={500}
                  placeholder="Anything else we should know? (optional)"
                  placeholderTextColor={colors.t3}
                  style={styles.note}
                  accessibilityLabel="Additional details, optional"
                />
              </ScrollView>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Pressable
                onPress={submit}
                disabled={busy || !reason}
                style={({ pressed }) => [
                  styles.confirm,
                  pressed && { opacity: 0.8 },
                  (busy || !reason) && { opacity: 0.5 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send report"
                accessibilityState={{ disabled: busy || !reason, busy }}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.bg} />
                ) : (
                  <Text style={styles.confirmText}>Send report</Text>
                )}
              </Pressable>

              <Pressable
                onPress={handleClose}
                disabled={busy}
                style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)' },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: colors.surface,
  },
  /** The draggable strip. The 14pt that used to be the handle's `marginBottom`
   *  is this row's `paddingBottom`, so the spacing is unchanged and is now
   *  part of what can be grabbed. */
  grab: {
    alignSelf: 'stretch',
    paddingTop: 4,
    paddingBottom: 14,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
  },
  title: {
    flex: 1,
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 18,
    color: colors.t1,
  },
  lead: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.t2,
    marginBottom: 12,
  },

  reasons: { flexGrow: 0 },
  reasonsContent: { gap: 6, paddingBottom: 8 },
  reason: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 52,
  },
  reasonSelected: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioOn: { borderColor: colors.teal },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.teal },
  reasonText: { flex: 1, gap: 2 },
  reasonLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 14,
    color: colors.t1,
  },
  reasonLabelOn: { color: colors.teal },
  reasonHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.t3,
  },

  note: {
    marginTop: 6,
    minHeight: 76,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t1,
    textAlignVertical: 'top',
  },

  error: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.red,
    marginTop: 10,
    marginBottom: 2,
  },

  confirm: {
    marginTop: 12,
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
    marginTop: 2,
  },
  cancelText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 14,
    color: colors.t3,
  },

  doneWrap: { gap: 12, paddingTop: 4 },
  doneTitle: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 20,
    color: colors.t1,
  },
  doneBody: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.t2,
  },
});
