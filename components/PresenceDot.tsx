import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, type as typography } from '@/constants/theme';
import { presenceLabel, presenceText, type Presence } from '@/services/presence';

interface Props {
  /** Absent or null renders nothing at all — see the note below. */
  presence?: Presence | null;
  size?: number;
  /** Ring colour when the dot sits on top of an avatar, so it reads as a badge
   * rather than as part of the photo. */
  haloColor?: string;
  /** Adds a visible "Online" / "4m" caption beside the dot where there is room.
   * The dot alone is enough for a sighted user; the caption is what makes the
   * state legible without relying on a 8px shape. */
  withText?: boolean;
}

/**
 * Online / offline indicator.
 *
 * Two rules this component exists to enforce:
 *
 * 1. No presence means *no indicator*. When the API omits the `presence` key —
 *    because the viewer is not in the audience, the account is private, or
 *    sharing is paused — this renders null. Falling back to a grey "offline"
 *    dot would state something false and would make hiding detectable, since
 *    anyone hiding would read as permanently offline.
 *
 * 2. Never colour alone. Online is a filled disc, offline is a hollow ring, so
 *    the two are distinguishable without colour vision. Both carry a spelled
 *    out screen-reader label, since shape is no help there either.
 */
export function PresenceDot({ presence, size = 10, haloColor, withText = false }: Props) {
  // Absent, not "offline".
  if (!presence) return null;

  const online = presence.is_online;
  const label = presenceLabel(presence);
  const caption = withText ? presenceText(presence) : null;

  const dot = (
    <View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          // Filled vs hollow is the non-colour cue.
          backgroundColor: online ? colors.green : 'transparent',
          borderColor: online ? colors.green : colors.t3,
          borderWidth: online ? 0 : Math.max(1.5, size * 0.18),
        },
        haloColor
          ? { borderWidth: Math.max(2, size * 0.2), borderColor: haloColor }
          : null,
        // The halo replaces the outline, so an offline dot over an avatar keeps
        // its hollow centre by filling with the page colour instead.
        haloColor && !online ? { backgroundColor: colors.t3 } : null,
      ]}
    />
  );

  if (!caption) {
    // One accessible node carrying the whole state, rather than an unlabelled
    // decorative shape a screen reader would either skip or read as "image".
    return <View accessible accessibilityLabel={label ?? undefined}>{dot}</View>;
  }

  return (
    <View style={styles.row} accessible accessibilityLabel={label ?? undefined}>
      {dot}
      <Text
        style={[styles.caption, online && styles.captionOnline]}
        importantForAccessibility="no"
      >
        {caption}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    // Sized by the caller; only the invariants live here.
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  caption: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    color: colors.t3,
  },
  captionOnline: { color: colors.t2 },
});
