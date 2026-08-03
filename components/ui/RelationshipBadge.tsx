import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, radius, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// The avatar ring colour (blue / orange / white) was the only thing telling
// friend, connection and stranger apart. That disappears entirely in
// greyscale, for the ~8% of men with red-green colour blindness, and for
// anyone using a screen reader.
//
// So each tier gets three redundant cues: colour, a distinct glyph, and a
// word. Any one of them is enough on its own.

export type Relationship = 'stranger' | 'hi_sent' | 'hi_received' | 'connected' | 'friend';

interface Descriptor {
  label: string;
  /** Shape cue — survives greyscale and colour blindness. */
  glyph: string;
  color: string;
}

const makeRelationship = (colors: ColorPalette): Record<Relationship, Descriptor> => ({
  friend:      { label: 'Friend',      glyph: '★', color: colors.blue },
  connected:   { label: 'Connected',   glyph: '●', color: colors.orange },
  hi_sent:     { label: 'Hi sent',     glyph: '◐', color: colors.teal },
  hi_received: { label: 'Hi received', glyph: '◑', color: colors.teal },
  stranger:    { label: 'Nearby',      glyph: '○', color: colors.t2 },
});

export function relationshipLabel(rel: Relationship): string {
  // Labels are theme-independent so we use static fallbacks here.
  const labels: Record<Relationship, string> = {
    friend: 'Friend', connected: 'Connected', hi_sent: 'Hi sent',
    hi_received: 'Hi received', stranger: 'Nearby',
  };
  return labels[rel] ?? labels.stranger;
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: radius.s,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  compact: { paddingHorizontal: 5 },
  glyph: { fontFamily: fonts.body, fontSize: typography.caption, fontWeight: '700' },
  label: {
    fontFamily: fonts.body,
    fontSize: typography.micro,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

export function RelationshipBadge({
  relationship,
  compact = false,
}: {
  relationship: Relationship;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rel = useMemo(() => makeRelationship(colors), [colors]);
  const d = rel[relationship] ?? rel.stranger;
  return (
    <View
      style={[styles.badge, compact && styles.compact, { borderColor: d.color }]}
      // Read as one phrase; the glyph on its own is noise to a screen reader.
      accessible
      accessibilityLabel={d.label}
    >
      <Text style={[styles.glyph, { color: d.color }]} importantForAccessibility="no">
        {d.glyph}
      </Text>
      {!compact && (
        <Text style={[styles.label, { color: d.color }]} importantForAccessibility="no">
          {d.label}
        </Text>
      )}
    </View>
  );
}
