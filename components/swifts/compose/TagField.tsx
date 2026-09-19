import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { IconAt, IconClose, IconHash } from '@/components/ui/icons';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  sendablePeople,
  suggestHashtags,
  type HashtagSuggestion,
  type Person,
} from '@/services/swiftComposer';
import {
  MAX_HASHTAGS,
  MAX_MENTIONS,
  normaliseTag,
  parseHashtags,
  parseMentions,
} from '@/services/swiftDraft';

/**
 * Hashtags and mentions on the publishing step.
 *
 * ## The chip row shows what will publish, not what was typed here
 *
 * A creator who writes `#astana` into the caption has tagged their Swift — the
 * server parses the caption on publish and attaches it (`swifts/tagging.py`).
 * If this row only listed tags entered into *this* field, the UI would be
 * telling them they have no tags while the published Swift has one.
 *
 * So the chips are the union, and the ones that came from the caption are
 * drawn without a remove button: taking them off here would not remove them,
 * because the caption still says so. Editing the caption is how you remove a
 * caption tag, and that is a true statement rather than a limitation being
 * hidden.
 *
 * ## Why mentions are suggested from people you know
 *
 * A mention only becomes a row if the username resolves to a reachable account
 * that has not blocked you — anything else stays plain text and notifies
 * nobody (`swifts.tagging.attach_mentions`). Suggesting from the people this
 * account is actually connected to means the names offered are the ones that
 * will work, rather than a global search whose results mostly will not.
 *
 * Typing a handle by hand still works and is still resolved server-side; the
 * suggestions are an assist, not the gate.
 */

interface Props {
  caption: string;
  hashtags: string[];
  mentions: string[];
  onChangeHashtags: (tags: string[]) => void;
  onChangeMentions: (handles: string[]) => void;
}

/** How long after a keystroke before asking the server for tag suggestions. */
const DEBOUNCE_MS = 220;

export function TagField({
  caption, hashtags, mentions, onChangeHashtags, onChangeMentions,
}: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [tagDraft, setTagDraft] = useState('');
  const [mentionDraft, setMentionDraft] = useState('');
  const [tagIdeas, setTagIdeas] = useState<HashtagSuggestion[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  // Out-of-order guard: a slow response for an old prefix must not replace a
  // fast one for the current prefix. Same reasoning as the music picker.
  const generation = useRef(0);

  // What the caption already contributes. These are not removable here — see
  // the component note.
  const fromCaption = useMemo(() => ({
    tags: parseHashtags(caption),
    handles: parseMentions(caption),
  }), [caption]);

  const ownTags = useMemo(
    () => hashtags.filter((t) => !fromCaption.tags.includes(t)),
    [hashtags, fromCaption.tags],
  );
  const ownMentions = useMemo(
    () => mentions.filter((h) => !fromCaption.handles.includes(h)),
    [mentions, fromCaption.handles],
  );

  const totalTags = fromCaption.tags.length + ownTags.length;
  const totalMentions = fromCaption.handles.length + ownMentions.length;

  useEffect(() => {
    const mine = ++generation.current;
    const timer = setTimeout(() => {
      suggestHashtags(normaliseTag(tagDraft)).then((results) => {
        if (mine === generation.current) setTagIdeas(results);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [tagDraft]);

  useEffect(() => {
    let alive = true;
    sendablePeople()
      .then((list) => { if (alive) setPeople(list); })
      .catch(() => { if (alive) setPeople([]); });
    return () => { alive = false; };
  }, []);

  function addTag(raw: string) {
    const tag = normaliseTag(raw);
    if (!tag) return;
    setTagDraft('');
    if (totalTags >= MAX_HASHTAGS) return;
    if (fromCaption.tags.includes(tag) || ownTags.includes(tag)) return;
    onChangeHashtags([...hashtags, tag]);
  }

  function addMention(raw: string) {
    const handle = raw.trim().replace(/^@+/, '').toLowerCase();
    if (!handle) return;
    setMentionDraft('');
    if (totalMentions >= MAX_MENTIONS) return;
    if (fromCaption.handles.includes(handle) || ownMentions.includes(handle)) return;
    onChangeMentions([...mentions, handle]);
  }

  const peopleIdeas = useMemo(() => {
    const needle = mentionDraft.trim().replace(/^@+/, '').toLowerCase();
    const already = new Set([...fromCaption.handles, ...ownMentions]);
    return people
      .filter((p) => !already.has(p.username.toLowerCase()))
      .filter((p) => !needle || p.username.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [people, mentionDraft, fromCaption.handles, ownMentions]);

  return (
    <View style={styles.root}>
      {/* ── Hashtags ───────────────────────────────────────────────────────── */}
      <View style={styles.block}>
        <View style={styles.blockHead}>
          <IconHash size={16} color={colors.t3} />
          <Text style={styles.blockLabel}>Hashtags</Text>
          <Text style={styles.counter} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
            {totalTags}/{MAX_HASHTAGS}
          </Text>
        </View>

        {totalTags > 0 && (
          <View style={styles.chips}>
            {fromCaption.tags.map((tag) => (
              <View key={`c-${tag}`} style={[styles.chip, styles.chipFixed]}>
                <Text style={styles.chipText}>#{tag}</Text>
              </View>
            ))}
            {ownTags.map((tag) => (
              <Pressable
                key={`o-${tag}`}
                onPress={() => onChangeHashtags(hashtags.filter((t) => t !== tag))}
                style={styles.chip}
                accessibilityRole="button"
                accessibilityLabel={`Remove hashtag ${tag}`}
              >
                <Text style={styles.chipText}>#{tag}</Text>
                <IconClose size={12} color={colors.teal} />
              </Pressable>
            ))}
          </View>
        )}

        {fromCaption.tags.length > 0 && (
          <Text style={styles.note}>
            Tags in your caption are added automatically. Edit the caption to
            change them.
          </Text>
        )}

        <TextInput
          style={styles.input}
          value={tagDraft}
          onChangeText={setTagDraft}
          onSubmitEditing={() => addTag(tagDraft)}
          placeholder={totalTags >= MAX_HASHTAGS ? 'That is the limit' : 'Add a hashtag'}
          placeholderTextColor={colors.t3}
          editable={totalTags < MAX_HASHTAGS}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          maxLength={64}
          accessibilityLabel="Add a hashtag"
        />

        {tagIdeas.length > 0 && totalTags < MAX_HASHTAGS && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.ideaRow}
          >
            {tagIdeas
              .filter((idea) => !hashtags.includes(idea.name)
                && !fromCaption.tags.includes(idea.name))
              .map((idea) => (
                <Pressable
                  key={idea.name}
                  onPress={() => addTag(idea.name)}
                  style={styles.idea}
                  accessibilityRole="button"
                  accessibilityLabel={`Add hashtag ${idea.display}`}
                >
                  <Text style={styles.ideaText}>#{idea.display}</Text>
                  {idea.swift_count > 0 && (
                    <Text style={styles.ideaCount}>{idea.swift_count}</Text>
                  )}
                </Pressable>
              ))}
          </ScrollView>
        )}
      </View>

      {/* ── Mentions ───────────────────────────────────────────────────────── */}
      <View style={styles.block}>
        <View style={styles.blockHead}>
          <IconAt size={16} color={colors.t3} />
          <Text style={styles.blockLabel}>Mention friends</Text>
          <Text style={styles.counter} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
            {totalMentions}/{MAX_MENTIONS}
          </Text>
        </View>

        {totalMentions > 0 && (
          <View style={styles.chips}>
            {fromCaption.handles.map((handle) => (
              <View key={`c-${handle}`} style={[styles.chip, styles.chipFixed]}>
                <Text style={styles.chipText}>@{handle}</Text>
              </View>
            ))}
            {ownMentions.map((handle) => (
              <Pressable
                key={`o-${handle}`}
                onPress={() => onChangeMentions(mentions.filter((h) => h !== handle))}
                style={styles.chip}
                accessibilityRole="button"
                accessibilityLabel={`Remove mention of ${handle}`}
              >
                <Text style={styles.chipText}>@{handle}</Text>
                <IconClose size={12} color={colors.teal} />
              </Pressable>
            ))}
          </View>
        )}

        <TextInput
          style={styles.input}
          value={mentionDraft}
          onChangeText={setMentionDraft}
          onSubmitEditing={() => addMention(mentionDraft)}
          placeholder={
            totalMentions >= MAX_MENTIONS ? 'That is the limit' : 'Search your people'
          }
          placeholderTextColor={colors.t3}
          editable={totalMentions < MAX_MENTIONS}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          maxLength={150}
          accessibilityLabel="Mention somebody"
        />

        {peopleIdeas.length > 0 && totalMentions < MAX_MENTIONS && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.ideaRow}
          >
            {peopleIdeas.map((person) => (
              <Pressable
                key={person.id}
                onPress={() => addMention(person.username)}
                style={styles.idea}
                accessibilityRole="button"
                accessibilityLabel={`Mention ${person.username}`}
              >
                <Text style={styles.ideaText}>@{person.username}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <Text style={styles.note}>
          They get a notification. Anyone who has blocked you, or whose account
          is gone, is skipped.
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { gap: 24 },
  block: { gap: 10 },

  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  blockLabel: {
    flex: 1,
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.t3,
  },
  counter: {
    fontFamily: fonts.body,
    fontSize: typography.micro,
    color: colors.t3,
    fontVariant: ['tabular-nums'],
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.tealLine,
    backgroundColor: colors.tealTint,
  },
  // Came from the caption: no remove affordance, because removing it here
  // would not remove it from the Swift.
  chipFixed: { opacity: 0.75 },
  chipText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    color: colors.teal,
  },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: fonts.body,
    fontSize: typography.body,
    color: colors.t1,
  },

  ideaRow: { gap: 7, paddingRight: 8 },
  idea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ideaText: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    color: colors.t2,
  },
  ideaCount: {
    fontFamily: fonts.body,
    fontSize: typography.micro,
    color: colors.t3,
    fontVariant: ['tabular-nums'],
  },

  note: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.t3,
  },
});
