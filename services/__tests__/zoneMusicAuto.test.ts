/**
 * A friend's zone music, playing by itself when you walk into their zone.
 *
 * Driven entirely by what the location report says is playing where you stand,
 * so these tests feed `handleZoneMusic` that answer and watch the player. The
 * rules are the ones the feature was agreed on: on by default, once per entry
 * with a 90-minute cooldown per owner, stop on leaving, never over a card the
 * person started themselves, and never in Ghost Mode.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

import {
  COOLDOWN_MS,
  TAKEOVER_GRACE_MS,
  handleZoneMusic,
  isZoneMusicAutoplayEnabled,
  resetZoneMusic,
  setManualZonePlayback,
  setZoneMusicAutoplay,
  type ZoneMusicHere,
} from '../zoneMusicAuto';

type Listener = (status: Record<string, unknown>) => void;

const mockPlayers: {
  play: jest.Mock; pause: jest.Mock; remove: jest.Mock; seekTo: jest.Mock;
  setActiveForLockScreen: jest.Mock; clearLockScreenControls: jest.Mock;
  emit: Listener; loop: boolean;
}[] = [];

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(async () => {}),
  createAudioPlayer: jest.fn(() => {
    let listener: Listener = () => {};
    const player = {
      loop: true,
      play: jest.fn(),
      pause: jest.fn(),
      remove: jest.fn(),
      seekTo: jest.fn(async () => {}),
      setActiveForLockScreen: jest.fn(),
      clearLockScreenControls: jest.fn(),
      addListener: jest.fn((_: string, fn: Listener) => {
        listener = fn;
        return { remove: jest.fn() };
      }),
      emit: (status: Record<string, unknown>) => listener(status),
    };
    mockPlayers.push(player);
    return player;
  }),
}));

let mockGhost = false;
jest.mock('../privacy', () => ({ getCachedGhostMode: jest.fn(async () => mockGhost) }));
jest.mock('expo-notifications', () => ({ scheduleNotificationAsync: jest.fn(async () => 'id') }));

/** Whether the app is in front when the track starts — it decides the mode. */
function appIs(state: 'active' | 'background') {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
}

const AMINA: ZoneMusicHere = {
  owner_id: 7, username: 'amina', url: 'https://example.com/preview.m4a',
  title: 'Blinding Lights', artist: 'The Weeknd', artwork: 'https://example.com/a.jpg',
  start_ms: 5000, end_ms: 20000,
};

beforeEach(async () => {
  await resetZoneMusic();
  await AsyncStorage.clear();
  await setZoneMusicAutoplay(true);
  setManualZonePlayback(false);
  mockGhost = false;
  mockPlayers.length = 0;
  jest.mocked(createAudioPlayer).mockClear();
  jest.mocked(setAudioModeAsync).mockClear();
  jest.mocked(Notifications.scheduleNotificationAsync).mockClear();
  appIs('active');
});

it('is on unless somebody turned it off', async () => {
  await AsyncStorage.clear();
  await setZoneMusicAutoplay(true);
  await expect(isZoneMusicAutoplayEnabled()).resolves.toBe(true);
});

it('plays the owner\'s slice once, in the background, with the lock screen saying whose it is', async () => {
  await handleZoneMusic(AMINA);
  // App open: takes the audio over, which is what puts the player on the lock
  // screen, and keeps playing after the app is left.
  expect(setAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({
    shouldPlayInBackground: true, interruptionMode: 'doNotMix',
  }));
  const [player] = mockPlayers;
  expect(player.loop).toBe(false);
  expect(player.seekTo).toHaveBeenCalledWith(5);
  expect(player.play).toHaveBeenCalled();
  expect(player.setActiveForLockScreen).toHaveBeenCalledWith(true, expect.objectContaining({
    title: 'Blinding Lights', artist: 'The Weeknd · @amina\'s zone',
  }));

  // The end of the slice is the end: it stops rather than looping.
  player.emit({ isLoaded: true, currentTime: 20, didJustFinish: false });
  expect(player.remove).toHaveBeenCalled();
  expect(player.clearLockScreenControls).toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

describe('started with the app closed', () => {
  beforeEach(() => {
    appIs('background');
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  /** Start the track, optionally let it begin playing, then wait out the grace. */
  async function startClosed(here: ZoneMusicHere, begins: boolean) {
    const done = handleZoneMusic(here);
    await jest.advanceTimersByTimeAsync(0);
    if (begins) mockPlayers[0].emit({ isLoaded: true, playing: true, currentTime: 5 });
    await jest.advanceTimersByTimeAsync(TAKEOVER_GRACE_MS);
    await done;
  }

  it('shows the lock-screen player when iOS lets it take the audio over', async () => {
    await startClosed(AMINA, true);
    expect(setAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ interruptionMode: 'doNotMix' }));
    expect(setAudioModeAsync).not.toHaveBeenCalledWith(expect.objectContaining({ interruptionMode: 'duckOthers' }));
    expect(mockPlayers[0].setActiveForLockScreen).toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('falls back to mixing, and names the track in a notification, when iOS refuses', async () => {
    await startClosed(AMINA, false);
    expect(setAudioModeAsync).toHaveBeenLastCalledWith(expect.objectContaining({ interruptionMode: 'duckOthers' }));
    expect(mockPlayers[0].clearLockScreenControls).toHaveBeenCalled();
    expect(mockPlayers[0].play).toHaveBeenCalledTimes(2);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({
        title: '🎵 Blinding Lights', body: 'The Weeknd — playing in @amina\'s zone',
      }),
    }));
  });

  it('does not repeat the server\'s zone alert when that went out with the same report', async () => {
    await startClosed({ ...AMINA, alerted: true }, false);
    expect(mockPlayers[0].play).toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

it('does not start the same zone again inside the cooldown, and does after it', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  await handleZoneMusic(AMINA);
  mockPlayers[0].emit({ isLoaded: true, currentTime: 0, didJustFinish: true });
  await handleZoneMusic(AMINA);
  expect(createAudioPlayer).toHaveBeenCalledTimes(1);

  now.mockReturnValue(1_000_000 + COOLDOWN_MS + 1);
  await handleZoneMusic(AMINA);
  expect(createAudioPlayer).toHaveBeenCalledTimes(2);
  now.mockRestore();
});

it('keeps playing while still inside, and stops on leaving', async () => {
  await handleZoneMusic(AMINA);
  await handleZoneMusic(AMINA);
  expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  expect(mockPlayers[0].remove).not.toHaveBeenCalled();
  await handleZoneMusic(null);
  expect(mockPlayers[0].remove).toHaveBeenCalled();
});

it('starts only once when two reports land together', async () => {
  await Promise.all([handleZoneMusic(AMINA), handleZoneMusic(AMINA)]);
  expect(createAudioPlayer).toHaveBeenCalledTimes(1);
});

it('stays quiet with the switch off, and stops when it goes off', async () => {
  await handleZoneMusic(AMINA);
  await setZoneMusicAutoplay(false);
  expect(mockPlayers[0].remove).toHaveBeenCalled();
  await AsyncStorage.clear();
  await handleZoneMusic({ ...AMINA, owner_id: 8 });
  expect(createAudioPlayer).toHaveBeenCalledTimes(1);
});

it('never plays over a card somebody started, or in Ghost Mode', async () => {
  setManualZonePlayback(true);
  await handleZoneMusic(AMINA);
  setManualZonePlayback(false);
  mockGhost = true;
  await handleZoneMusic({ ...AMINA, owner_id: 9 });
  expect(createAudioPlayer).not.toHaveBeenCalled();
});

it('gives way when a card starts playing', async () => {
  await handleZoneMusic(AMINA);
  setManualZonePlayback(true);
  expect(mockPlayers[0].remove).toHaveBeenCalled();
});
