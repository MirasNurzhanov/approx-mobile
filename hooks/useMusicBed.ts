import { useEffect, useRef } from 'react';
import { useAudioPlayer } from 'expo-audio';

import type { SwiftTrackChoice } from '@/services/swiftDraft';

/**
 * A Swift's attached track, played alongside its video.
 *
 * ## Why this is a second player and not a mix
 *
 * Mixing a track into the video is a real encode. Nothing on the phone
 * re-encodes and R2 cannot either — see `swifts/media.py` — so the bed is
 * played rather than baked: `expo-video` runs the picture, `expo-audio` runs
 * the track, and this hook keeps the two in step. It is the same "apply it at
 * playback" decision trim and volume already follow, extended to sound.
 *
 * ## The video is the clock
 *
 * Two independent players will drift: they start at slightly different
 * moments, they buffer separately, and a seek in one is not a seek in the
 * other. Rather than trying to make them agree, one of them is authoritative —
 * the video, always, because that is the one a viewer is watching and a
 * correction to it is the one they would notice.
 *
 * So every video time update computes where the track *should* be, and the
 * track is only moved when it has drifted past `DRIFT_TOLERANCE_S`. Correcting
 * smaller errors would seek constantly, and a seek is audible.
 *
 * ## What `startMs` is for
 *
 * A creator attaching a three-minute song to an eight-second Swift is almost
 * never choosing its first eight seconds. `startMs` is the point in the track
 * they scrubbed to, so position zero of the video maps to `startMs` of the
 * audio and the bed loops back there when the video loops.
 */

/** How far out of step the bed may drift before it is corrected, in seconds. */
const DRIFT_TOLERANCE_S = 0.35;

interface Options {
  track: SwiftTrackChoice | null;
  /** 0–100. */
  volume: number;
  /** Where in the track the bed starts, in milliseconds. */
  startMs: number;
  /** Where the video is, in milliseconds from the start of the *kept* range. */
  positionMs: number;
  /** Whether the video is playing right now. */
  playing: boolean;
  /** Whether this surface is allowed to make sound at all. */
  muted?: boolean;
}

export function useMusicBed({
  track,
  volume,
  startMs,
  positionMs,
  playing,
  muted = false,
}: Options) {
  // `null` rather than a conditional hook: `useAudioPlayer` must run on every
  // render, and handing it no source is how it stays idle — the same
  // arrangement `SwiftCard` uses to keep an off-screen video decoder unloaded.
  const player = useAudioPlayer(track?.audioUrl ? { uri: track.audioUrl } : null);

  // A ref, not state: this is read inside the drift check on every time update
  // and writing it must not re-render anything.
  const seeking = useRef(false);

  useEffect(() => {
    player.volume = Math.min(1, Math.max(0, volume / 100));
  }, [player, volume]);

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  // Looping is ours rather than the player's. `loop` would return the track to
  // *its* beginning, and the bed's beginning is `startMs` — so a looping Swift
  // would come back to the wrong part of the song from the second play
  // onwards.
  useEffect(() => {
    player.loop = false;
  }, [player]);

  useEffect(() => {
    if (!track?.audioUrl) return;
    if (playing) {
      player.play();
    } else {
      player.pause();
    }
  }, [player, playing, track?.audioUrl]);

  // The drift correction. Deliberately not an interval of its own: the video's
  // time updates are already arriving at a known rate, and a second timer
  // would sample a position that had not changed.
  useEffect(() => {
    if (!track?.audioUrl || !playing || seeking.current) return;

    const trackLength = track.durationMs || player.duration * 1000;
    let target = startMs + positionMs;
    // A Swift longer than what is left of the track wraps around rather than
    // falling silent — which is what a creator who picked a short loop expects,
    // and the alternative is a video that plays the last ten seconds in silence.
    if (trackLength > 0 && target >= trackLength) {
      const runway = Math.max(1, trackLength - startMs);
      target = startMs + ((positionMs % runway) || 0);
    }

    const drift = Math.abs(player.currentTime - target / 1000);
    if (drift <= DRIFT_TOLERANCE_S) return;

    seeking.current = true;
    // `then(release, release)` rather than `finally`: React Compiler bails on
    // any function containing one — the same constraint `app/swifts/compose`
    // and `CaptureStep` are written around — and a bailout here would take the
    // memoisation off every card in the feed.
    const release = () => {
      // A seek can fail while the track is still buffering. Clearing the flag
      // either way means the next time update tries again, which is the whole
      // recovery this needs.
      seeking.current = false;
    };
    player.seekTo(target / 1000).then(release, release);
  }, [player, track?.audioUrl, track?.durationMs, startMs, positionMs, playing]);

  return player;
}
