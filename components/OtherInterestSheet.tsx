import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { IconClose } from '@/components/ui/icons';
import { hobbyIcon } from '@/components/ui/hobbyIcons.generated';
import { lookupHobby, resolveInterest, suggest, type Hobby } from '@/services/interestResolver';
import { colors, fonts, radius } from '@/constants/theme';

const MAX_LEN = 40;

/**
 * Icon for an interest chip: the backend emoji when present, otherwise the
 * catalog's lucide icon (custom "Other" entries are stored with an empty icon).
 */
export function InterestChipIcon({ name, icon }: { name: string; icon?: string }) {
  if (icon) return <Text style={styles.chipEmoji}>{icon}</Text>;
  const hobby = lookupHobby(name);
  const Icon = hobbyIcon(hobby?.icon, hobby?.category);
  return <Icon size={16} color={colors.t2} strokeWidth={1.5} />;
}

export interface OtherInterestResult {
  /** Canonical catalog name when matched, otherwise the user's own text. */
  name: string;
  /** false → custom entry the backend should flag for review. */
  matched: boolean;
}

interface OtherInterestSheetProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (result: OtherInterestResult) => void;
}

function SuggestionRow({ hobby, onPress }: { hobby: Hobby; onPress: () => void }) {
  const Icon = hobbyIcon(hobby.icon, hobby.category);
  return (
    <Pressable
      style={({ pressed }) => [styles.suggestionRow, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.suggestionIcon}>
        <Icon size={18} color={colors.t2} strokeWidth={1.5} />
      </View>
      <Text style={styles.suggestionName} numberOfLines={1}>{hobby.name}</Text>
      <Text style={styles.suggestionCategory}>{hobby.category}</Text>
    </Pressable>
  );
}

export function OtherInterestSheet({ visible, onClose, onAdd }: OtherInterestSheetProps) {
  const { bottom } = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<Hobby[]>([]);
  const [didYouMean, setDidYouMean] = useState<Hobby[] | null>(null);

  useEffect(() => {
    if (!visible) {
      setText('');
      setSuggestions([]);
      setDidYouMean(null);
    }
  }, [visible]);

  function handleChange(value: string) {
    const next = value.slice(0, MAX_LEN);
    setText(next);
    setDidYouMean(null);
    setSuggestions(next.trim().length >= 2 ? suggest(next, 6) : []);
  }

  function add(result: OtherInterestResult) {
    onAdd(result);
    onClose();
  }

  function handleSubmit() {
    const trimmed = text.trim();
    if (trimmed.length < 2) return;

    const resolution = resolveInterest(trimmed);
    if (resolution.match) {
      add({ name: resolution.match.name, matched: true });
    } else if (resolution.status === 'ambiguous') {
      setDidYouMean(resolution.candidates.slice(0, 3));
    } else {
      add({ name: trimmed, matched: false });
    }
  }

  const canSubmit = text.trim().length >= 2;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flexEnd}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: bottom + 20 }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title}>Add your own</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <IconClose size={20} color={colors.t3} />
            </Pressable>
          </View>

          <View style={styles.inputBar}>
            <Ionicons name="search" size={18} color={colors.t3} />
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={handleChange}
              placeholder="Type a hobby or interest…"
              placeholderTextColor={colors.t3}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={MAX_LEN}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
            {text.length > 0 && (
              <Pressable onPress={() => handleChange('')} hitSlop={10}>
                <Ionicons name="close-circle" size={18} color={colors.t3} />
              </Pressable>
            )}
          </View>

          {didYouMean ? (
            <View style={styles.suggestions}>
              <Text style={styles.sectionLabel}>DID YOU MEAN</Text>
              {didYouMean.map((hobby) => (
                <SuggestionRow
                  key={hobby.id}
                  hobby={hobby}
                  onPress={() => add({ name: hobby.name, matched: true })}
                />
              ))}
              <Pressable
                style={({ pressed }) => [styles.keepRow, pressed && styles.pressed]}
                onPress={() => add({ name: text.trim(), matched: false })}
              >
                <Text style={styles.keepText}>Keep “{text.trim()}”</Text>
              </Pressable>
            </View>
          ) : suggestions.length > 0 ? (
            <ScrollView
              style={styles.suggestions}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {suggestions.map((hobby) => (
                <SuggestionRow
                  key={hobby.id}
                  hobby={hobby}
                  onPress={() => add({ name: hobby.name, matched: true })}
                />
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.hint}>
              {canSubmit
                ? 'No matches — you can still add it as your own.'
                : 'Start typing to see suggestions.'}
            </Text>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.addBtn,
              (!canSubmit || pressed) && styles.addBtnDimmed,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            <Text style={styles.addBtnText}>Add Interest</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chipEmoji: { fontSize: 17 },
  flexEnd: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  sheet: {
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 18,
    color: colors.t1,
  },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t1,
  },

  suggestions: {
    marginTop: 10,
    maxHeight: 240,
  },
  sectionLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    marginBottom: 6,
    marginTop: 2,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  suggestionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionName: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '500',
    color: colors.t1,
  },
  suggestionCategory: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.t3,
    textTransform: 'capitalize',
  },
  keepRow: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  keepText: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.teal,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t3,
    marginTop: 14,
    marginBottom: 4,
  },
  pressed: { opacity: 0.6 },

  addBtn: {
    marginTop: 14,
    backgroundColor: colors.teal,
    borderRadius: radius.m,
    paddingVertical: 14,
    alignItems: 'center',
  },
  addBtnDimmed: { opacity: 0.5 },
  addBtnText: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.bg,
  },
});
