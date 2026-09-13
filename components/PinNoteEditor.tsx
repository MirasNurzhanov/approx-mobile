import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { IconClose } from '@/components/ui/icons';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { MAX_NOTE_LENGTH } from '@/services/pinnedPlaces';

/**
 * The note on a pinned place: write one, change it, or take it off.
 *
 * Shared by the map's pinned-place card and the pinned-places list, because
 * both are looking at the same row and a note written in one has to be the
 * note read in the other. Being one component is also what keeps the removal
 * rule in one place — see below.
 *
 * ## Removing
 *
 * Two ways out, deliberately, because they mean different things. **Remove
 * note** is explicit and only appears once there is something to remove.
 * Clearing the field and saving does the same thing, since an empty note and
 * no note are the same state (`services/pinnedPlaces.setPinnedNote`) — a
 * person who deletes the text and presses Save should not then have to find a
 * second button to make it stick.
 *
 * The pin itself is not removed from here. Deleting the note you wrote about a
 * place and deleting the place are different intentions, and the card behind
 * this modal has its own control for the second one.
 */
interface Props {
  visible: boolean;
  placeId: string;
  /** What the note is about, shown so the field is never ambiguous when two
   *  pins sit at the same spot. */
  placeTitle: string;
  /** The note as it stands. Empty or absent means there is none yet. */
  note?: string;
  onClose: () => void;
  /** Called with the new text — empty removes the note. */
  onSave: (note: string) => void;
}

export function PinNoteEditor({ visible, placeId, ...props }: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <PinNoteForm key={JSON.stringify([placeId, visible, props.note ?? ''])} {...props} />
    </Modal>
  );
}

function PinNoteForm({ placeTitle, note, onClose, onSave }: Omit<Props, 'visible' | 'placeId'>) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();
  const [draft, setDraft] = useState(note ?? '');

  const trimmed = draft.trim();
  const hasNote = !!note && note.trim().length > 0;
  const changed = trimmed !== (note ?? '').trim();

  function save() {
    onSave(trimmed);
    onClose();
  }

  function remove() {
    onSave('');
    onClose();
  }

  return (
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.sheet, { paddingBottom: bottom + 20 }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
                {hasNote ? 'Edit note' : 'Add a note'}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>{placeTitle}</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Close without saving"
            >
              <IconClose size={16} color={colors.t2} />
            </Pressable>
          </View>

          <TextInput
            style={styles.field}
            value={draft}
            onChangeText={setDraft}
            placeholder="Why you saved this — what to remember, who you're meeting"
            placeholderTextColor={colors.t3}
            multiline
            autoFocus
            maxLength={MAX_NOTE_LENGTH}
            textAlignVertical="top"
            accessibilityLabel={`Note about ${placeTitle}`}
          />

          <View style={styles.metaRow}>
            {/* Said once, here, rather than implied by the absence of a share
                control: a note is the only thing on a pin the person wrote,
                and where it goes is worth knowing before they write it. */}
            <Text style={styles.privacyNote}>Only you can see this.</Text>
            <Text style={styles.counter} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
              {draft.length}/{MAX_NOTE_LENGTH}
            </Text>
          </View>

          <View style={styles.actions}>
            {hasNote ? (
              <View style={styles.actionCell}>
                <Button
                  label="Remove note"
                  variant="dangerTint"
                  size="md"
                  fullWidth
                  onPress={remove}
                  accessibilityLabel={`Remove the note about ${placeTitle}`}
                />
              </View>
            ) : null}
            <View style={styles.actionCell}>
              <Button
                label="Save"
                variant="primary"
                size="md"
                fullWidth
                disabled={!changed}
                onPress={save}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  pressed: { opacity: 0.5 },

  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    borderTopWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 12,
  },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1, gap: 2 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.title,
    color: colors.t1,
  },
  subtitle: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3 },
  close: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  field: {
    minHeight: 110,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    padding: 14,
    fontFamily: fonts.body,
    fontSize: typography.body,
    lineHeight: 21,
    color: colors.t1,
  },

  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  privacyNote: { flex: 1, fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3 },
  counter: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3 },

  actions: { flexDirection: 'row', gap: 10 },
  actionCell: { flex: 1 },
});
