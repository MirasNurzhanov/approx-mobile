import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { IconCheck, IconClose, IconSearch } from '@/components/ui/icons';
import { GlassIconButton } from '@/components/ui/GlassSurface';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { sendablePeople, type Person } from '@/services/swiftComposer';

/**
 * Choosing who to send a Swift to privately.
 *
 * ## Two callers, one sheet
 *
 * The composer opens this *before* publishing, to pick who the Swift goes to
 * the moment it exists; the feed opens it on a Swift that is already up, to
 * forward one. The difference is entirely in what the caller does with the
 * ids — `mode` only changes the button's wording — because the choosing is the
 * same act either way and two sheets would drift apart in a week.
 *
 * Which is also why this sits beside the feed's components rather than under
 * `compose/`: everything in that folder belongs to the composer alone, and a
 * feed that imported from it would be reaching across a boundary the folder
 * exists to draw.
 *
 * ## Why the list is friends *and* connections
 *
 * A send is a direct message, and the DM rules count an accepted Hi as a
 * writable conversation (`friends.views._are_connected`). A sheet that listed
 * only friends would hide people the send would in fact reach, which reads as
 * the feature being broken rather than as a policy.
 *
 * The server checks all of this again per recipient, and can still refuse one
 * — somebody may have blocked you since this list loaded, or may not be
 * allowed to watch this particular Swift. That is why sending reports per
 * person rather than throwing: see `services/swiftComposer.sendSwiftTo`.
 */

interface Props {
  visible: boolean;
  /** Already-chosen ids, so reopening keeps the selection. */
  selected: number[];
  mode: 'queue' | 'send';
  onCancel: () => void;
  onConfirm: (userIds: number[]) => void;
  /** Set while a send is in flight, so the sheet cannot be double-submitted. */
  busy?: boolean;
}

export function SendToFriendsSheet(props: Props) {
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onCancel}
    >
      {props.visible && <SheetBody {...props} />}
    </Modal>
  );
}

function SheetBody({ selected, mode, onCancel, onConfirm, busy = false }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<number[]>(selected);

  useEffect(() => {
    let alive = true;
    sendablePeople()
      .then((list) => {
        if (!alive) return;
        setPeople(list);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((p) => p.username.toLowerCase().includes(needle));
  }, [people, query]);

  function toggle(id: number) {
    setChosen((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  }

  const label = mode === 'queue'
    ? chosen.length > 0 ? `Send to ${chosen.length}` : 'Send to nobody'
    : `Send${chosen.length > 0 ? ` (${chosen.length})` : ''}`;

  return (
    // Keeps a screen reader inside the sheet; see the note in
    // `MusicPickerSheet` and the test that asserts it for every Modal.
    <View
      style={[styles.root, { paddingTop: insets.top + 8 }]}
      accessibilityViewIsModal
    >
      <View style={styles.header}>
        <GlassIconButton
          onPress={onCancel}
          hitSlop={12}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <IconClose size={20} color={colors.t2} />
        </GlassIconButton>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
          Send privately
        </Text>
        <Pressable
          onPress={() => onConfirm(chosen)}
          // `queue` can confirm an empty list: clearing everybody is how you
          // change your mind about sending it at all. `send` cannot, because
          // there would be nothing to do.
          disabled={busy || (mode === 'send' && chosen.length === 0)}
          hitSlop={12}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          {busy ? (
            <ActivityIndicator color={colors.teal} />
          ) : (
            <Text
              style={[
                styles.headerAction,
                mode === 'send' && chosen.length === 0 && styles.headerActionOff,
              ]}
            >
              {mode === 'queue' ? 'Done' : 'Send'}
            </Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.blurb}>
        {mode === 'queue'
          ? 'They get it as a message as soon as your Swift is published.'
          : 'They get it as a message. Only people who can already watch it.'}
      </Text>

      <View style={styles.searchRow}>
        <IconSearch size={18} color={colors.t3} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={colors.t3}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search people"
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} />
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>
                {failed
                  ? 'Could not load your people. Try again in a moment.'
                  : query
                    ? 'Nobody matches that.'
                    : 'Nobody to send to yet. Say Hi to somebody first.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const picked = chosen.includes(item.id);
            return (
              <Pressable
                onPress={() => toggle(item.id)}
                style={[styles.person, picked && styles.personOn]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: picked }}
                accessibilityLabel={item.username}
              >
                <Avatar uri={item.profile_picture ?? null} size="md" name={item.username} />
                <Text style={styles.username} numberOfLines={1}>{item.username}</Text>
                <View style={[styles.tick, picked && styles.tickOn]}>
                  {picked && <IconCheck size={14} color={colors.bg} />}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  headerBtn: { minWidth: 56, paddingVertical: 4 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  headerAction: {
    textAlign: 'right',
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.teal,
  },
  headerActionOff: { color: colors.t3 },

  blurb: {
    paddingHorizontal: 18,
    paddingBottom: 12,
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.t3,
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  search: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: typography.body,
    color: colors.t1,
  },

  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    color: colors.t3,
    textAlign: 'center',
  },

  list: { padding: 16, gap: 8 },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  personOn: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  username: {
    flex: 1,
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.teal, borderColor: colors.teal },
});
