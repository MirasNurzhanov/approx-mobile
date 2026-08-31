import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { fonts, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import type { SwiftReviewState } from '@/services/swifts';

/**
 * What the creator is told while their Swift is being screened.
 *
 * Only ever shown to the author. The server does not send a real
 * `review_state` to anybody else — `SwiftSerializer.get_review_state` returns
 * `published` for every other viewer — because every other viewer can only be
 * looking at a Swift that already is published. There is no branch here that
 * could show a stranger a state, and there is nothing on this screen for one
 * to reach.
 *
 * Two rules the wording follows, and both are deliberate:
 *
 * **It never claims the Swift is live before it is.** "Publishing…" would be a
 * lie for the thirty seconds a classification takes, and the creator would find
 * out it was a lie by sending a friend a link that 404s. So the states before
 * approval say what is actually true — the video is being processed, or it is
 * being reviewed — and only `published` claims anything.
 *
 * **It does not accuse anybody.** A quarantine is a decision to *ask a human*,
 * not a finding, and the policy that produces it accepts false positives by
 * design so that genuine material is caught. Telling somebody they broke the
 * guidelines when a classifier was 0.4 sure about one frame of their video is
 * both wrong and, for the person it is wrong about, the whole experience of the
 * product. "may not follow" and "a person will take a look" are what that
 * uncertainty actually sounds like.
 *
 * And no numbers. A confidence score in front of a creator is a free tuning
 * signal for anybody trying to get material past the filter, one upload at a
 * time — see `SwiftSerializer.get_review_state`.
 */

interface SwiftReviewNoticeProps {
  state: SwiftReviewState;
  top: number;
}

const COPY: Record<Exclude<SwiftReviewState, 'published'>, {
  title: string;
  body: string;
  spinner: boolean;
}> = {
  processing: {
    title: 'Processing your Swift',
    body: 'This usually takes a few seconds.',
    spinner: true,
  },
  reviewing: {
    title: 'Your Swift is being reviewed',
    body: 'It will go live as soon as the review finishes. Only you can see it '
      + 'until then.',
    spinner: true,
  },
  needs_review: {
    title: 'This Swift is under review',
    body: 'It may not follow the Community Guidelines, so a person will take a '
      + 'look before it goes live. Only you can see it until then.',
    spinner: false,
  },
};

export function SwiftReviewNotice({ state, top }: SwiftReviewNoticeProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  if (state === 'published') return null;
  const copy = COPY[state];
  if (!copy) return null;

  return (
    <View
      style={[styles.card, { top }]}
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLabel={`${copy.title}. ${copy.body}`}
    >
      <View style={styles.row}>
        {copy.spinner && (
          <ActivityIndicator size="small" color={colors.teal} style={styles.spinner} />
        )}
        <Text style={styles.title} numberOfLines={2}>{copy.title}</Text>
      </View>
      <Text style={styles.body}>{copy.body}</Text>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  card: {
    position: 'absolute',
    left: 14,
    right: 14,
    padding: 14,
    borderRadius: 16,
    // Over video, always, so the palette's surface colour would be unreadable
    // on a bright frame. Same treatment as the close button on this screen.
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    gap: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spinner: { marginRight: 2 },
  title: {
    flex: 1,
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: '#FFFFFF',
  },
  body: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.78)',
  },
});
