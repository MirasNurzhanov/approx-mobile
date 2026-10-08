import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';

import { IconMusic, IconPause, IconPlay, IconRestart } from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { useZonePlayback } from '@/hooks/useZonePlayback';
import { fmtTime } from '@/services/zoneAudio';

/**
 * A zone's track, and the controls for it.
 *
 * The card only — loading, looping and the lifecycle rules that stop a track
 * outliving the screen it belongs to are in `useZonePlayback`.
 */

interface ZonePlayerProps {
  /** Remote track. Changing it unloads whatever was playing. */
  url: string;
  title: string;
  subtitle?: string | null;
  /** Cover art, for the tracks that have any — Apple Music sends one, a preset
   *  and an upload do not. Replaces the note icon rather than sitting beside
   *  it: two pieces of art for one track is one too many. */
  artwork?: string | null;
  /** The slice that repeats, in milliseconds. `endMs` null means "to the end
   *  of the file", which is the untrimmed default. Playback starts at `startMs`
   *  and wraps back to it, so the loop is the window rather than the track. */
  startMs?: number;
  endMs?: number | null;
  /** Fired whenever the loaded track's true length becomes known. The duration
   *  lives in the audio file and nowhere else — the server never decodes it —
   *  so this is the only place a trim editor can learn how long the track is. */
  onDuration?: (ms: number) => void;
  /** Playback position, for a caller drawing its own playhead. Null once the
   *  sound is unloaded, so the marker disappears rather than freezing. */
  onPosition?: (ms: number | null) => void;
  /** When set, playback is blocked and this is shown in place of the timings —
   *  e.g. you are standing outside the zone the track belongs to. */
  blockedReason?: string | null;
  /** Read-only line under the controls: who can hear this, and how wide it is. */
  footnote?: string | null;
  /** Label for assistive tech, e.g. "Miras's zone track". */
  accessibilityName?: string;
  style?: ViewStyle;
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  art: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artActive: { backgroundColor: colors.tealTint, borderColor: colors.tealLine },

  meta: { flex: 1, gap: 3 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 15,
    color: colors.t1,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.t2,
  },

  restartBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  playBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnBlocked: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },

  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  trackFill: { height: '100%', borderRadius: 2, backgroundColor: colors.teal },

  captionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  caption: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.t3,
  },
  captionError: { color: colors.orange },
  footnote: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.t3,
  },

  pressed: { opacity: 0.7 },
});

export function ZonePlayer(props: ZonePlayerProps) {
  // A new track or access state owns a new playback session. Trim edits keep
  // the current session so its native playhead can follow the changing window.
  return <ZonePlayerSession key={JSON.stringify([props.url, Boolean(props.blockedReason)])} {...props} />;
}

function ZonePlayerSession({
  url,
  title,
  subtitle,
  artwork,
  startMs = 0,
  endMs = null,
  onDuration,
  onPosition,
  blockedReason,
  footnote,
  accessibilityName,
  style,
}: ZonePlayerProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const name = accessibilityName ?? title;
  const blocked = Boolean(blockedReason);

  // Everything to do with the sound itself lives in the hook; this component is
  // only the card you can see.
  const { state, position, duration, toggle, restart } = useZonePlayback({
    url,
    startMs,
    endMs,
    blocked,
    onDuration,
    onPosition,
  });

  const active = state === 'playing' || state === 'paused';
  const loading = state === 'loading';
  const progress = duration && duration > 0 ? Math.min(1, position / duration) : 0;

  const caption = blockedReason
    ? blockedReason
    : state === 'error'
      ? 'Could not load this track. Tap play to try again.'
      : active
        ? `${fmtTime(position)} / ${fmtTime(duration)}`
        : loading
          ? 'Loading…'
          : 'Nothing is playing — tap play to listen';

  return (
    <View style={[styles.card, style]}>
      <View style={styles.row}>
        {artwork ? (
          <Image source={{ uri: artwork }} style={styles.art} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.art, active && styles.artActive]}>
            <IconMusic size={22} color={active ? colors.teal : colors.t2} />
          </View>
        )}

        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
          ) : null}
        </View>

        {/* Only offered once there is something to restart — on a track that
            has never played, "start over" is just play. */}
        {active && !blocked ? (
          <Pressable
            onPress={restart}
            hitSlop={10}
            style={({ pressed }) => [styles.restartBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Start ${name} over`}
          >
            <IconRestart size={18} color={colors.t2} />
          </Pressable>
        ) : null}

        <Pressable
          onPress={toggle}
          disabled={blocked || loading}
          style={({ pressed }) => [
            styles.playBtn,
            blocked && styles.playBtnBlocked,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: blocked, selected: state === 'playing' }}
          accessibilityLabel={
            blocked
              ? `${name} is out of range`
              : state === 'playing'
                ? `Pause ${name}`
                : `Play ${name}`
          }
          accessibilityHint={blocked ? blockedReason ?? undefined : undefined}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.bg} />
          ) : state === 'playing' ? (
            <IconPause size={22} color={colors.bg} />
          ) : (
            <IconPlay size={22} color={blocked ? colors.t3 : colors.bg} />
          )}
        </Pressable>
      </View>

      {/* Always drawn, empty when idle — a bar that appears on play would
          resize the card under the finger that just pressed it. */}
      <View style={styles.track} accessible={false}>
        <View style={[styles.trackFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      <View style={styles.captionRow}>
        <Text
          style={[styles.caption, state === 'error' && styles.captionError]}
          numberOfLines={1}
        >
          {caption}
        </Text>
        {footnote ? (
          <Text style={styles.footnote} numberOfLines={1}>{footnote}</Text>
        ) : null}
      </View>
    </View>
  );
}
