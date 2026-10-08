// See app/_layout.tsx — SDK 56 routes react-navigation through expo-router.
import { useIsFocused } from '@react-navigation/native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

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

  const soundRef = useRef<AudioPlayer | null>(null);
  const subRef = useRef<{ remove: () => void } | null>(null);
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

  const unload = useCallback(() => {
    const sound = soundRef.current;
    soundRef.current = null;
    subRef.current?.remove();
    subRef.current = null;
    // The playhead belongs to the sound; without this it would freeze mid-track
    // on a card whose audio has been unloaded.
    onPositionRef.current?.(null);
    if (!sound) return;
    try {
      sound.pause();
      sound.remove();
    } catch {}
  }, []);

  // ZonePlayer keys its session by URL and access state. React resets the UI;
  // cleanup only releases this session's native resource and external playhead.
  useEffect(() => {
    goneRef.current = false;
    return () => {
      goneRef.current = true;
      unload();
    };
  }, [url, unload]);

  // Native looping is only correct while the window *is* the whole file: it
  // wraps to zero, which on a trimmed track is not where the loop restarts.
  // Handing the job back and forth as the range changes keeps the untrimmed
  // case gapless — the native player loops seamlessly, the status callback
  // cannot — while letting `onStatus` own the seam whenever there is a real
  // window.
  useEffect(() => {
    if (soundRef.current) soundRef.current.loop = endMs == null;
  }, [endMs]);

  /** Pause without unloading, so resuming picks up where it stopped. */
  const pause = useCallback(() => {
    const sound = soundRef.current;
    if (!sound) return;
    setState('paused');
    try {
      sound.pause();
    } catch {}
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
   *  the status callback is handed to expo-audio once, at load, and would
   *  otherwise keep testing against whatever the range was back then — which
   *  is precisely wrong in a trim editor, where the whole point is that the
   *  window moves while the sound is playing. */
  const rangeRef = useRef({ startMs, endMs });
  useEffect(() => { rangeRef.current = { startMs, endMs }; });

  const onStatus = useCallback((status: AudioStatus) => {
    // expo-audio's status carries no error field for a playback failure that
    // arrives after a successful load (only `AudioRecorder`'s status does) —
    // `load`'s catch block is the only place a failure can still surface.
    if (!status.isLoaded) return;
    const at = Math.round(status.currentTime * 1000);
    setPosition(at);
    onPositionRef.current?.(at);
    const durationMs = status.duration ? Math.round(status.duration * 1000) : null;
    setDuration(durationMs);
    if (durationMs) onDurationRef.current?.(durationMs);

    // Wrap at the end of the *window*. The native player's own looping only
    // knows about the end of the file, so a trimmed track has to be turned
    // around here — and `didJustFinish` covers the case where the window runs
    // to the file's end, where there is no later position to observe.
    //
    // Only while actually playing. Pausing on or past the loop point is a
    // legitimate place to be parked, and yanking the position back there would
    // both move the track under a stopped finger and mislabel it as playing.
    const { startMs: from, endMs: to } = rangeRef.current;
    const past = to != null && at >= to && status.playing;
    if ((past || status.didJustFinish) && soundRef.current) {
      // Fire and forget: the next status tick reports the new position, and
      // awaiting here would block the callback expo-audio is calling us from.
      soundRef.current.seekTo(from / 1000).catch(() => {});
      setPosition(from);
      setState('playing');
      return;
    }

    // Buffering without `playing` should still read as the playing state as
    // far as the button is concerned — it must stay a pause button.
    setState(status.playing || status.isBuffering ? 'playing' : 'paused');
  }, []);

  // Kept despite react-doctor/react-compiler-no-manual-memoization: React
  // Compiler bails on this hook (emitted output is the source verbatim, no `_c`
  // cache), so every `useCallback` here is the only caching there is.
  const load = useCallback(async (startAt = 0) => {
    setState('loading');

    try {
      await setAudioModeAsync({
        // Someone tapping play with the ringer switch off still means it.
        playsInSilentMode: true,
        // Deliberately foreground-only: the card owns the sound, so leaving
        // the app is one more way to stop it.
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
      });

      if (goneRef.current) return;

      // Synchronous: the native player is created immediately and reports its
      // own load progress through the status listener rather than a promise —
      // there's no `androidImplementation` fallback to retry with any more, so
      // a source ExoPlayer can't decode now surfaces as a load that never
      // reaches `isLoaded`, not a caught rejection here.
      const sound = createAudioPlayer({ uri: url }, { updateInterval: 120 });
      const sub = sound.addListener('playbackStatusUpdate', onStatus);

      if (goneRef.current) {
        sub.remove();
        sound.remove();
        return;
      }
      soundRef.current = sound;
      subRef.current = sub;

      // Left off when a window is set: the native loop would wrap to zero at
      // the end of the *file*, which for a trimmed track is the wrong place.
      // `onStatus` turns it around at the end of the window instead.
      sound.loop = rangeRef.current.endMs == null;

      // `||` is a "value block" React Compiler cannot lower inside a try/catch,
      // so the fallback is spelled out as a statement instead.
      let from = startAt;
      if (!from) from = rangeRef.current.startMs;
      if (from) await sound.seekTo(from / 1000).catch(() => {});

      if (goneRef.current || soundRef.current !== sound) return;

      // A blur that landed while this was still loading applies to it too —
      // otherwise a slow load starts playing into a screen you already left.
      if (focusedRef.current) sound.play();
      else pause();
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
      pause();
    } else {
      setState('playing');
      sound.play();
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
    await sound.seekTo(from / 1000).catch(() => {});
    if (goneRef.current || soundRef.current !== sound) return;
    sound.play();
  }

  return { state, position, duration, toggle, restart };
}
