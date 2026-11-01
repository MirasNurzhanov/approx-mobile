import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { SHEET_RISE } from '@/components/ui/sheetMotion';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  fetchMeetupResponses,
  type MeetupAnswer,
  type MeetupResponseSummary,
  type ResponsePerson,
} from '@/services/meetupResponses';

/**
 * Who is in for a meetup, on its card in the club chat.
 *
 * Two buttons for every member but the proposer — tapping your current answer
 * again takes it back — and, once anybody has answered, a row of faces with
 * the counts that opens the full list (`MeetupResponsesSheet`).
 */
export function MeetupResponseBar({ summary, canAnswer, busy, onAnswer, onShowAll }: {
  summary: MeetupResponseSummary;
  canAnswer: boolean;
  busy: boolean;
  onAnswer: (answer: MeetupAnswer | null) => void;
  onShowAll: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const mine = summary.my_answer ?? null;
  const answered = summary.in_count + summary.out_count;

  return (
    <View style={styles.wrap}>
      {canAnswer && (
        <View style={styles.buttons}>
          <Pressable
            style={[styles.button, mine === 'in' && styles.inOn, busy && styles.busy]}
            onPress={() => onAnswer(mine === 'in' ? null : 'in')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ selected: mine === 'in', busy }}
            accessibilityLabel={mine === 'in' ? "You're in. Tap to take it back." : "I'm in"}
          >
            <Ionicons name={mine === 'in' ? 'checkmark-circle' : 'checkmark-circle-outline'} size={18}
              color={mine === 'in' ? colors.bg : colors.teal} />
            <Text style={[styles.buttonText, { color: mine === 'in' ? colors.bg : colors.teal }]}>I'm in</Text>
          </Pressable>
          <Pressable
            style={[styles.button, mine === 'out' && styles.outOn, busy && styles.busy]}
            onPress={() => onAnswer(mine === 'out' ? null : 'out')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ selected: mine === 'out', busy }}
            accessibilityLabel={mine === 'out' ? 'You said nope. Tap to take it back.' : 'Nope'}
          >
            <Ionicons name={mine === 'out' ? 'close-circle' : 'close-circle-outline'} size={18}
              color={mine === 'out' ? '#FFFFFF' : colors.t2} />
            <Text style={[styles.buttonText, { color: mine === 'out' ? '#FFFFFF' : colors.t2 }]}>Nope</Text>
          </Pressable>
        </View>
      )}

      {answered > 0 && (
        <Pressable
          style={({ pressed }) => [styles.summary, pressed && styles.busy]}
          onPress={onShowAll}
          accessibilityRole="button"
          accessibilityLabel={`${summary.in_count} in${(summary.here_count ?? 0) > 0 ? `, ${summary.here_count} here` : ''}, ${summary.out_count} nope. Shows everyone who answered.`}
        >
          <View style={styles.faces}>
            {summary.preview.map((person, i) => (
              <View key={person.id} style={[styles.face, i > 0 && styles.faceOverlap]}>
                <Avatar uri={person.profile_picture ?? undefined} name={person.username} size="xs" />
              </View>
            ))}
          </View>
          <Text style={styles.counts}>
            <Text style={styles.countIn}>{summary.in_count} in</Text>
            {(summary.here_count ?? 0) > 0 ? ` · ${summary.here_count} here` : ''}
            {summary.out_count > 0 ? ` · ${summary.out_count} nope` : ''}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.t3} />
        </Pressable>
      )}
    </View>
  );
}

/** Everyone who answered, "in" first. Fetched when it opens, so it is current. */
export function MeetupResponsesSheet({ eventId, onClose }: { eventId: number | null; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();
  const [lists, setLists] = useState<{ in: ResponsePerson[]; out: ResponsePerson[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (eventId === null) return;
    let alive = true;
    setLists(null);
    setFailed(false);
    fetchMeetupResponses(eventId)
      .then((data) => { if (alive) setLists(data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [eventId]);

  return (
    <Modal visible={eventId !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay} accessibilityViewIsModal>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <Animated.View entering={SHEET_RISE} style={[styles.sheet, { paddingBottom: bottom + 16 }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Who's in</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.t2} />
            </Pressable>
          </View>
          {failed ? (
            <Text style={styles.note}>Could not load the answers. Try again in a moment.</Text>
          ) : lists === null ? (
            <ActivityIndicator color={colors.teal} style={styles.loading} />
          ) : (
            <ScrollView>
              <PeopleSection title={`In · ${lists.in.length}`} icon="checkmark-circle" tint={colors.teal}
                people={lists.in} empty="Nobody yet." styles={styles} />
              <PeopleSection title={`Nope · ${lists.out.length}`} icon="close-circle" tint={colors.t3}
                people={lists.out} empty="Nobody." styles={styles} />
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function PeopleSection({ title, icon, tint, people, empty, styles }: {
  title: string;
  icon: 'checkmark-circle' | 'close-circle';
  tint: string;
  people: ResponsePerson[];
  empty: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={16} color={tint} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {people.length === 0 ? <Text style={styles.note}>{empty}</Text> : people.map((person) => (
        <View key={person.id} style={styles.person}>
          <Avatar uri={person.profile_picture ?? undefined} name={person.username} size="sm" />
          <Text style={styles.personName}>@{person.username}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  wrap: { gap: 10, paddingHorizontal: 14, paddingBottom: 14 },
  buttons: { flexDirection: 'row', gap: 10 },
  button: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 42, borderRadius: radius.m, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  inOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  outOn: { backgroundColor: colors.t2, borderColor: colors.t2 },
  busy: { opacity: 0.6 },
  buttonText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  faces: { flexDirection: 'row' },
  face: { borderRadius: 999, borderWidth: 2, borderColor: colors.surface },
  faceOverlap: { marginLeft: -8 },
  counts: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.t2 },
  countIn: { color: colors.t1, fontWeight: '600' },

  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    maxHeight: '75%', backgroundColor: colors.surface, paddingHorizontal: 20,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  sheetTitle: { fontFamily: fonts.display, fontSize: 20, fontWeight: '600', color: colors.t1 },
  loading: { paddingVertical: 32 },
  section: { marginBottom: 18, gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.t2, textTransform: 'uppercase' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  personName: { fontFamily: fonts.body, fontSize: 15, color: colors.t1 },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.t3, paddingVertical: 4 },
});
