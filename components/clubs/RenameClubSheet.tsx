import { useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { SHEET_RISE } from '@/components/ui/sheetMotion';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { useKeyboardVisible } from '@/hooks/useKeyboardVisible';

/** The server's limit on a club name — clubs.models.Club.name. */
const MAX_NAME = 100;

/**
 * Renaming a club, from Manage on the club screen. A sheet rather than
 * `Alert.prompt`, which exists on iOS only.
 */
export function RenameClubSheet({ visible, current, saving, onCancel, onSave }: {
  visible: boolean;
  current: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* Keyed on the name it opened with, so reopening starts from it again. */}
      <RenameForm key={`${visible}-${current}`} current={current} saving={saving} onCancel={onCancel} onSave={onSave} />
    </Modal>
  );
}

function RenameForm({ current, saving, onCancel, onSave }: {
  current: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();
  const keyboardUp = useKeyboardVisible();
  const [name, setName] = useState(current);
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== current.trim() && !saving;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      accessibilityViewIsModal
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel" />
      <Animated.View entering={SHEET_RISE} style={[styles.sheet, { paddingBottom: keyboardUp ? 12 : bottom + 20 }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>Rename club</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Club name"
          placeholderTextColor={colors.t3}
          maxLength={MAX_NAME}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => { if (canSave) onSave(trimmed); }}
          accessibilityLabel="Club name"
        />
        <View style={styles.buttons}>
          <View style={styles.cell}>
            <Button label="Cancel" variant="secondary" size="md" fullWidth onPress={onCancel} />
          </View>
          <View style={styles.cell}>
            <Button label="Save" variant="primary" size="md" fullWidth loading={saving}
              disabled={!canSave} onPress={() => onSave(trimmed)} />
          </View>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.surface, paddingHorizontal: 20, gap: 16,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 10 },
  title: { fontFamily: fonts.display, fontSize: 20, fontWeight: '600', color: colors.t1 },
  input: {
    fontFamily: fonts.body, fontSize: 16, color: colors.t1,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.m, paddingHorizontal: 14, paddingVertical: 12,
  },
  buttons: { flexDirection: 'row', gap: 10 },
  cell: { flex: 1 },
});
