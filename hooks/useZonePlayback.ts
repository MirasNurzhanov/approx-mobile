import { useIsFocused } from '@react-navigation/native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

/**
 * The sound behind a zone track, and nothing else.
 *
 * Split out of `ZonePlayer` so the component is only the card you can see: the
 * loading, looping, focus and lifecycle rules are all here, and the caller gets
 * back the four things a play button needs.
 *
 * Nothing here ever starts on its own. Zone audio used to autoplay the moment
 * you walked into a friend's circle — sound coming out of a phone that was in a
 * pocket a second ago, from a person you didn't choose. Playback begins on a
 * press and only on a press.
 *
 * The sound is owned by the caller's mount: it is loaded on first play and
 * unloaded on unmount, so closing the card that holds it is also how you stop
 * it. There is no playback left running behind a screen you have left.
 */

export type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface ZonePlaybackOptions {
  /** Remote track. Changing it unloads whatever was playing. */
  url: string;
  /** The slice that repeats, in milliseconds. `endMs` null means "to the end of
   *  the file", which is the untrimmed default. Playback starts at `startMs`
   *  and wraps back to it, so the loop is the window rather than the track. */
  startMs?: number;
  endMs?: number | null;
  /** Playback is refused and any loaded sound is dropped — e.g. you are
   *  standing outside the zone the track belongs to. */
  blocked?: boolean;
  /** Fired whenever the loaded track's true length becomes known. The duration
   *  lives in the audio file and nowhere else — the server never decodes it —
   *  so this is the only place a trim editor can learn how long the track is. */
  onDuration?: (ms: number) => void;
  /** Playback position, for a caller drawing its own playhead. Null once the
   *  sound is unloaded, so the marker disappears rather than freezing. */
  onPosition?: (ms: number | null) => void;
}

export interface ZonePlayback {
  state: PlayState;
  position: number;
  duration: number | null;
  /** Play, pause, or load-then-play depending on where the sound currently is. */
  toggle: () => Promise<void>;
  /** Back to the start of the *window*, then play. */
  restart: () => Promise<void>;
}

export function useZonePlayback({
  url,
  startMs = 0,
  endMs = null,
  blocked = false,
  onDuration,
  onPosition,
}: ZonePlaybackOptions): ZonePlayback {
  const [state, setState] = useState<PlayState>('idle');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);
  /** Same reason as `rangeRef`: the status callback is bound once at load. */
  const onDurationRef = useRef(onDuration);
  const onPositionRef = useRef(onPosition);
  useEffect(() => {
    onDurationRef.current = onDuration;
    onPositionRef.current = onPosition;
  });
  /** Set on unmount so a load that is still in flight unloads itself instead
   *  of playing into a screen that is gone. */
  const goneRef = useRef(false);

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
  useEffect(() => { focusedRef.current = focused; });
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
  useEffect(() => { rangeRef.current = { startMs, endMs }; });

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

  // Kept despite react-doctor/react-compiler-no-manual-memoization: React
  // Compiler bails on this hook (emitted output is the source verbatim, no `_c`
  // cache), so every `useCallback` here is the only caching there is.
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

      let sound: Audio.Sound | null = null;
      try {
        sound = (await create()).sound;
      } catch {
        // Android only, and only as a second attempt. Apple's preview CDN
        // serves these files as `audio/x-m4p` — a legacy label meaning
        // *protected* AAC, which these are not. ExoPlayer normally sniffs the
        // container and ignores the header, but where it doesn't, the SDK
        // documents MediaPlayer as the fallback for media ExoPlayer refuses.
        // Trying it costs one failed load; not trying it costs Android users
        // the whole feature.
        //
        // A failure with no retry left leaves `sound` null and is handled just
        // below, rather than rethrowing to the outer `catch`: React Compiler
        // cannot lower a `throw` inside a `try/catch` and would give up on this
        // hook entirely.
        if (Platform.OS === 'android' && !goneRef.current) {
          console.log('[Zone] ExoPlayer refused the track, retrying with MediaPlayer');
          sound = (await create('MediaPlayer')).sound;
        }
      }

      if (!sound) {
        if (!goneRef.current) setState('error');
        return;
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

  return { state, position, duration, toggle, restart };
}
