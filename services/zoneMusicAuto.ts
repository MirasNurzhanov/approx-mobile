import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getCachedGhostMode } from './privacy';


// A friend's zone music, played once when you walk into their zone — with the
// app open or closed.
//
// The server decides where you are standing: every location report's response
// names the zone track you are inside and allowed to hear, or null (see
// proximity.views._zone_music_here). That report goes out from the map's tick
// and from the background location task alike, through services/location.ts,
// which hands the answer here. So this is the one place zone music starts on
// its own, and it starts only:
//
//   - with "Play friends' zone music" on (Settings; on by default),
//   - outside Ghost Mode, and while no zone card is playing something itself,
//   - once per entry: the same owner's track does not start again for
//     COOLDOWN_MS, which matches the server's zone music alert.
//
// It stops when the slice ends, when you leave the zone, when the switch goes
// off, and on sign-out. While it plays, the lock screen says what it is and
// whose zone it came from — the sound is never anonymous. iOS shows its
// lock-screen player (with pause) only for audio that takes the session over
// (`doNotMix`), so that is always tried first; the listener's own music pauses
// for the slice. From the background iOS may refuse the takeover — typically
// while another app is playing — so a track started with the app closed is
// given TAKEOVER_GRACE_MS to begin, and otherwise falls back to mixing
// (`duckOthers`) with a notification naming the track, unless the server's own
// zone alert went out with this report.
//
// Background playback is iOS's "playback" audio mode, which ignores the silent
// switch. That is the price of playing while the app is closed, and the reason
// the Settings switch exists.

export interface ZoneMusicHere {
  owner_id: number;
  username: string;
  url: string;
  title: string;
  artist: string;
  artwork: string;
  start_ms: number;
  end_ms: number | null;
  /** This report also pushed "there is music where you are" to us. */
  alerted?: boolean;
}

const ENABLED_KEY = 'aura:zoneMusic:autoplay';
const PLAYED_KEY = 'aura:zoneMusic:played';
export const COOLDOWN_MS = 90 * 60 * 1000;

interface Current {
  player: AudioPlayer;
  ownerId: number;
  remove: () => void;
}

let current: Current | null = null;
let manualActive = false;
/** The map's poll and the background task can report at the same moment; only
 *  one of them may decide to start a track. */
let deciding = false;

// ── The switch ───────────────────────────────────────────────────────────────
let enabled: boolean | null = null;
const listeners = new Set<() => void>();

export async function isZoneMusicAutoplayEnabled(): Promise<boolean> {
  if (enabled !== null) return enabled;
  try {
    // On unless turned off: a missing value is somebody who has not chosen.
    enabled = (await AsyncStorage.getItem(ENABLED_KEY)) !== '0';
  } catch {
    enabled = true;
  }
  return enabled;
}

export async function setZoneMusicAutoplay(on: boolean): Promise<void> {
  enabled = on;
  listeners.forEach((l) => l());
  if (!on) stopZoneMusic();
  try {
    await AsyncStorage.setItem(ENABLED_KEY, on ? '1' : '0');
  } catch {}
}

/** The switch, for Settings. `null` while it is still being read. */
export function useZoneMusicAutoplay(): boolean | null {
  const [value, setValue] = useState<boolean | null>(enabled);
  useEffect(() => {
    let active = true;
    const sync = () => { if (active) setValue(enabled); };
    listeners.add(sync);
    isZoneMusicAutoplayEnabled().then(sync).catch(() => {});
    return () => {
      active = false;
      listeners.delete(sync);
    };
  }, []);
  return value;
}

// ── Once per entry ───────────────────────────────────────────────────────────
async function readPlayed(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(PLAYED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function playedRecently(ownerId: number, now: number): Promise<boolean> {
  const at = (await readPlayed())[String(ownerId)];
  return typeof at === 'number' && now - at < COOLDOWN_MS;
}

async function markPlayed(ownerId: number, now: number): Promise<void> {
  const played = await readPlayed();
  // Only the entries still inside the cooldown are worth keeping.
  const kept: Record<string, number> = {};
  for (const [id, at] of Object.entries(played)) {
    if (typeof at === 'number' && now - at < COOLDOWN_MS) kept[id] = at;
  }
  kept[String(ownerId)] = now;
  try {
    await AsyncStorage.setItem(PLAYED_KEY, JSON.stringify(kept));
  } catch {}
}

// ── Playback ─────────────────────────────────────────────────────────────────
/** What the latest location report said is playing where we stand. */
export async function handleZoneMusic(here: ZoneMusicHere | null | undefined): Promise<void> {
  if (!here || !here.url) {
    // Out of every zone: whatever was playing belonged to the one we left.
    stopZoneMusic();
    return;
  }
  if (current?.ownerId === here.owner_id || deciding) return;
  stopZoneMusic();
  if (manualActive) return;
  deciding = true;
  try {
    if (!(await isZoneMusicAutoplayEnabled())) return;
    if (await getCachedGhostMode()) return;
    const now = Date.now();
    if (await playedRecently(here.owner_id, now)) return;
    await markPlayed(here.owner_id, now);
    await play(here);
  } finally {
    deciding = false;
  }
}

/** How long a track started with the app closed gets to begin under the
 *  takeover before it falls back to mixing. */
export const TAKEOVER_GRACE_MS = 1500;

function setMode(interruptionMode: 'doNotMix' | 'duckOthers') {
  return setAudioModeAsync({
    playsInSilentMode: true,
    // The point of this module: it keeps playing with the app closed, and
    // starts from the background location task.
    shouldPlayInBackground: true,
    interruptionMode,
  });
}

async function play(here: ZoneMusicHere): Promise<void> {
  // See the note at the top: take the session over for the lock-screen player
  // and, if iOS refuses that from the background, mix and say so instead.
  const foreground = AppState.currentState === 'active';
  try {
    await setMode('doNotMix');
    const player = createAudioPlayer({ uri: here.url }, { updateInterval: 250 });
    player.loop = false;
    const endMs = here.end_ms;
    let started = false;
    const sub = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (!status.isLoaded) return;
      if (status.playing || status.isBuffering) started = true;
      const past = endMs != null && status.currentTime * 1000 >= endMs;
      // Once, then done: the end of the owner's slice, or of the file.
      if (past || status.didJustFinish) stopZoneMusic();
    });
    current = { player, ownerId: here.owner_id, remove: () => sub.remove() };
    if (here.start_ms) await player.seekTo(here.start_ms / 1000).catch(() => {});
    if (current?.player !== player) return;
    player.play();
    player.setActiveForLockScreen(true, {
      title: here.title || `@${here.username}'s zone`,
      artist: here.artist ? `${here.artist} · @${here.username}'s zone` : 'Approx zone music',
      artworkUrl: here.artwork || undefined,
    });
    if (foreground) return;

    await new Promise((resolve) => setTimeout(resolve, TAKEOVER_GRACE_MS));
    if (current?.player !== player || started) return;
    // iOS kept the session from us: play mixed, and name the track in a
    // notification since the lock-screen player will not appear.
    player.clearLockScreenControls();
    await setMode('duckOthers');
    player.play();
    if (!here.alerted) await announce(here);
  } catch (e: any) {
    console.log('[ZoneMusic] could not play:', e?.message);
    stopZoneMusic();
  }
}

/** The lock-screen notice for a track that started with the app closed. */
async function announce(here: ZoneMusicHere): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `🎵 ${here.title || 'Zone music'}`,
        body: here.artist
          ? `${here.artist} — playing in @${here.username}'s zone`
          : `Playing in @${here.username}'s zone`,
        // The same deep link as the server's zone alert: the owner's profile.
        data: { type: 'profile', user_id: here.owner_id, username: here.username },
      },
      trigger: null,
    });
  } catch {}
}

/** Stop whatever zone music is playing on its own. Safe to call any time. */
export function stopZoneMusic(): void {
  const playing = current;
  current = null;
  if (!playing) return;
  playing.remove();
  try {
    playing.player.clearLockScreenControls();
    playing.player.pause();
    playing.player.remove();
  } catch {}
}

/**
 * A zone card is playing a track because somebody pressed play. Two sounds at
 * once is never what anyone wants, and the one they asked for wins.
 */
export function setManualZonePlayback(active: boolean): void {
  manualActive = active;
  if (active) stopZoneMusic();
}

/** For sign-out: stop, and forget which zones have played. */
export async function resetZoneMusic(): Promise<void> {
  stopZoneMusic();
  try {
    await AsyncStorage.removeItem(PLAYED_KEY);
  } catch {}
}
