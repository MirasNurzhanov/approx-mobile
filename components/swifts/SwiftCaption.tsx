import { memo, useMemo } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { router } from 'expo-router';

import { parseHashtags } from '@/services/swiftDraft';
import type { SwiftMention } from '@/services/swifts';

/**
 * A caption, with its hashtags and mentions as things you can actually press.
 *
 * ## Why this is not just a regex over the text
 *
 * A hashtag is whatever was typed, so highlighting one only needs the pattern.
 * A **mention is a person**, and the caption does not contain that person — it
 * contains a string that was resolved to an account at publication and may not
 * resolve to the same one now. `@aisha` in a year-old caption might belong to
 * somebody who has since renamed, or to nobody at all.
 *
 * So mentions are matched against `swift.mentions`, which the server resolved
 * and which carries the `user_id` to open. A handle in the text with no row
 * behind it is drawn as plain text, because that is what it is: a string
 * somebody typed that names no one. Guessing — routing to a profile search, or
 * assuming the current holder of the name is who was meant — would send a
 * reader to a stranger.
 *
 * ## Why the parse is shared with the composer
 *
 * `parseHashtags` is the composer's own function, which mirrors
 * `swifts/tagging.py`. Three parsers for one idea is how a tag comes to be
 * highlighted here, attached on the server, and missing from the tag page —
 * each of them right about a slightly different definition of "tag".
 */

interface Props {
  caption: string;
  /** Resolved at publication by the server. A handle absent from this list is
   *  drawn as plain text — see the component note. */
  mentions?: SwiftMention[];
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

/** One run of the caption: either inert text or something pressable. */
type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; text: string; tag: string }
  | { kind: 'mention'; text: string; userId: number };

/**
 * Split a caption into runs.
 *
 * One pass, collecting both kinds of match and sorting by position, rather
 * than two passes that would each have to avoid the other's spans — a `#` run
 * and an `@` run cannot overlap, but a two-pass implementation has to be
 * written carefully to keep it that way, and this one cannot get it wrong.
 */
export function splitCaption(caption: string, mentions: SwiftMention[]): Segment[] {
  const text = caption ?? '';
  if (!text) return [];

  // Only handles the server actually resolved, keyed for lookup. Lowercased
  // because the caption may have written it in any case.
  const byHandle = new Map(
    mentions.map((m) => [m.username.toLowerCase(), m.user_id]),
  );
  const tags = new Set(parseHashtags(text));

  const matches: { start: number; end: number; segment: Segment }[] = [];

  for (const match of text.matchAll(/(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)/gu)) {
    const tag = match[1].toLowerCase();
    // Only tags the shared parser agreed were tags — `#2024` matches the
    // pattern's shape but is not one, and the composer says so too.
    if (!tags.has(tag)) continue;
    matches.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      segment: { kind: 'tag', text: match[0], tag },
    });
  }

  for (const match of text.matchAll(/(?<![\p{L}\p{N}_])@([A-Za-z0-9_.]{1,150})/gu)) {
    const handle = match[1].replace(/\.+$/, '');
    const userId = byHandle.get(handle.toLowerCase());
    if (userId === undefined) continue;
    const start = match.index ?? 0;
    matches.push({
      // The trailing full stop a handle may have picked up is punctuation, not
      // part of the name, so it stays outside the link.
      start,
      end: start + 1 + handle.length,
      segment: { kind: 'mention', text: `@${handle}`, userId },
    });
  }

  matches.sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let cursor = 0;
  for (const { start, end, segment } of matches) {
    // Defensive: two matches cannot overlap given the patterns above, but a
    // sorted walk that assumed it would produce duplicated text if they ever
    // could, which is a worse failure than skipping one.
    if (start < cursor) continue;
    if (start > cursor) out.push({ kind: 'text', text: text.slice(cursor, start) });
    out.push(segment);
    cursor = end;
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) });
  return out;
}

function SwiftCaptionImpl({
  caption, mentions = [], style, linkStyle, numberOfLines,
}: Props) {
  const segments = useMemo(
    () => splitCaption(caption, mentions),
    [caption, mentions],
  );

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return <Text key={index}>{segment.text}</Text>;
        }
        return (
          <Text
            key={index}
            style={[styles.link, linkStyle]}
            // `onPress` on a nested `Text` rather than wrapping each run in a
            // `Pressable`: a Pressable inside a Text breaks the line-wrapping
            // that makes this a caption rather than a row of chips.
            onPress={() => {
              if (segment.kind === 'tag') {
                router.push({
                  pathname: '/swifts/tag/[name]',
                  params: { name: segment.tag },
                } as never);
              } else {
                router.push({
                  pathname: '/profile/[id]',
                  params: { id: String(segment.userId) },
                } as never);
              }
            }}
            accessibilityRole="link"
            accessibilityLabel={
              segment.kind === 'tag'
                ? `Hashtag ${segment.tag}`
                : `${segment.text}, open profile`
            }
          >
            {segment.text}
          </Text>
        );
      })}
    </Text>
  );
}

/** `memo`, because this renders inside a feed card that re-renders on every
 *  scroll tick — the same reasoning as `SwiftActions`. */
export const SwiftCaption = memo(SwiftCaptionImpl);

const styles = StyleSheet.create({
  // Weight rather than colour alone: over arbitrary video a tint cannot be
  // relied on for contrast, and a link that is only distinguishable by hue
  // fails for anyone who cannot separate the two.
  link: { fontWeight: '700' },
});
