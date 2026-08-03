import { useIsFocused } from '@react-navigation/native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { IconMusic, IconPause, IconPlay, IconRestart } from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { fmtTime } from '@/services/zoneAudio';

/**
 * A zone's track, and the controls for it.
 *
 * Nothing here ever starts on its own. Zone audio used to autoplay the moment
 * you walked into a friend's circle — sound coming out of a phone that was in
 * a pocket a second ago, from a person you didn't choose. Playback now begins
 * on a press and only on a press, and the same button stops it again.
 *
 * The sound is owned by this component: it is loaded on first play and
 * unloaded on unmount, so closing the card that holds it is also how you stop
 * it. There is no playback left running behind a screen you have left.
 */

type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

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

export function ZonePlayer({
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
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [state, setState] = useState<PlayState>('idle');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);
  /** Same reason as `rangeRef`: the status callback is bound once at load. */
  const onDurationRef = useRef(onDuration);
  onDurationRef.current = onDuration;
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;
  /** Set on unmount so a load that is still in flight unloads itself instead
   *  of playing into a screen that is gone. */
  const goneRef = useRef(false);

  const name = accessibilityName ?? title;
  const blocked = Boolean(blockedReason);

  const unload = useCallback(async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    setState('idle');
    setPosition(0);
    setDuration(null);
    // The playhead belongs to the sound; without this it would freeze mid-track
    // on a card whose audio has been unloaded.
    onPositionRef.current?.(null);
    if (!sound) return;
    await sound.stopAsync().catch(() => {});
    await sound.unloadAsync().catch(() => {});
  }, []);

  // Unload on unmount, and whenever the track itself changes.
  useEffect(() => {
    goneRef.current = false;
    return () => {
      goneRef.current = true;
      unload();
    };
  }, [url, unload]);

  // Walking out of the zone stops the audio the zone was carrying. The card
  // stays up — you can see what was playing, you just can't hear it any more.
  useEffect(() => {
    if (blocked && soundRef.current) unload();
  }, [blocked, unload]);

  // Native looping is only correct while the window *is* the whole file: it
  // wraps to zero, which on a trimmed track is not where the loop restarts.
  // Handing the job back and forth as the range changes keeps the untrimmed
  // case gapless — expo-av loops seamlessly, the status callback cannot — while
  // letting `onStatus` own the seam whenever there is a real window.
  useEffect(() => {
    soundRef.current?.setIsLoopingAsync(endMs == null).catch(() => {});
  }, [endMs]);

  /** Pause without unloading, so resuming picks up where it stopped. */
  const pause = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;
    setState('paused');
    await sound.pauseAsync().catch(() => {});
  }, []);

  // Playback belongs to the card in front of you. Switching tabs, opening
  // another screen or leaving the app pauses it rather than leaving a track
  // running behind a screen nobody is looking at — the whole point of taking
  // autoplay out was that sound should never outlive the intent to hear it.
  const focused = useIsFocused();
  const focusedRef = useRef(true);
  focusedRef.current = focused;
  useEffect(() => { if (!focused) pause(); }, [focused, pause]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') pause();
    });
    return () => sub.remove();
  }, [pause]);

  /** The loop window, as the props currently describe it. Held in a ref because
   *  the status callback is handed to expo-av once, at load, and would
   *  otherwise keep testing against whatever the range was back then — which
   *  is precisely wrong in a trim editor, where the whole point is that the
   *  window moves while the sound is playing. */
  const rangeRef = useRef({ startMs, endMs });
  rangeRef.current = { startMs, endMs };

  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      if (status.error) setState('error');
      return;
    }
    const at = status.positionMillis ?? 0;
    setPosition(at);
    onPositionRef.current?.(at);
    setDuration(status.durationMillis ?? null);
    if (status.durationMillis) onDurationRef.current?.(status.durationMillis);

    // Wrap at the end of the *window*. expo-av's own looping only knows about
    // the end of the file, so a trimmed track has to be turned around here —
    // and `didJustFinish` covers the case where the window runs to the file's
    // end, where there is no later position to observe.
    //
    // Only while actually playing. Pausing on or past the loop point is a
    // legitimate place to be parked, and yanking the position back there would
    // both move the track under a stopped finger and mislabel it as playing.
    const { startMs: from, endMs: to } = rangeRef.current;
    const past = to != null && at >= to && status.isPlaying;
    if ((past || status.didJustFinish) && soundRef.current) {
      // Fire and forget: the next status tick reports the new position, and
      // awaiting here would block the callback expo-av is calling us from.
      soundRef.current.setPositionAsync(from).catch(() => {});
      setPosition(from);
      setState('playing');
      return;
    }

    // `shouldPlay` without `isPlaying` is buffering, which is still the playing
    // state as far as the button is concerned — it must stay a pause button.
    setState(status.isPlaying || status.shouldPlay ? 'playing' : 'paused');
  }, []);

  const load = useCallback(async (startAt = 0) => {
    setState('loading');

    const create = (androidImplementation?: 'MediaPlayer') =>
      Audio.Sound.createAsync(
        { uri: url },
        {
          shouldPlay: true,
          // Left off when a window is set: expo-av would wrap to zero at the
          // end of the *file*, which for a trimmed track is the wrong place.
          // `onStatus` turns it around at the end of the window instead.
          isLooping: rangeRef.current.endMs == null,
          positionMillis: startAt || rangeRef.current.startMs,
          // Tighter than a progress bar needs, because this is also what
          // decides how far past the loop point playback can drift before it
          // wraps — at 350ms a short loop audibly overshoots.
          progressUpdateIntervalMillis: 120,
          ...(androidImplementation ? { androidImplementation } : {}),
        },
        onStatus,
      );

    try {
      await Audio.setAudioModeAsync({
        // Someone tapping play with the ringer switch off still means it.
        playsInSilentModeIOS: true,
        // Deliberately foreground-only: the card owns the sound, so leaving
        // the app is one more way to stop it.
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      let sound: Audio.Sound;
      try {
        sound = (await create()).sound;
      } catch (first) {
        // Android only, and only as a second attempt. Apple's preview CDN
        // serves these files as `audio/x-m4p` — a legacy label meaning
        // *protected* AAC, which these are not. ExoPlayer normally sniffs the
        // container and ignores the header, but where it doesn't, the SDK
        // documents MediaPlayer as the fallback for media ExoPlayer refuses.
        // Trying it costs one failed load; not trying it costs Android users
        // the whole feature.
        if (Platform.OS !== 'android' || goneRef.current) throw first;
        console.log('[Zone] ExoPlayer refused the track, retrying with MediaPlayer');
        sound = (await create('MediaPlayer')).sound;
      }

      if (goneRef.current) {
        await sound.unloadAsync().catch(() => {});
        return;
      }
      soundRef.current = sound;
      // A blur that landed while this was still loading applies to it too —
      // otherwise a slow load starts playing into a screen you already left.
      if (!focusedRef.current) await pause();
    } catch {
      if (!goneRef.current) setState('error');
    }
  }, [url, onStatus, pause]);

  async function toggle() {
    if (blocked) return;
    const sound = soundRef.current;
    if (!sound) {
      await load();
      return;
    }
    if (state === 'playing') {
      await pause();
    } else {
      setState('playing');
      await sound.playAsync().catch(() => {});
    }
  }

  async function restart() {
    if (blocked) return;
    const sound = soundRef.current;
    if (!sound) {
      await load();
      return;
    }
    // The start of the loop, not the start of the file — on a trimmed track
    // those differ, and "start over" means the thing you are hearing.
    const from = rangeRef.current.startMs;
    setPosition(from);
    setState('playing');
    await sound.setPositionAsync(from).catch(() => {});
    await sound.playAsync().catch(() => {});
  }

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
