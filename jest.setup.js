// Native modules that have no JS implementation under Jest.
//
// AsyncStorage throws on import rather than on use, so a module that merely
// imports it — services/zoneArea, for one — cannot be loaded at all without
// this, however pure the functions being tested are.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => {
  const values = new Map();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 3,
    getItemAsync: jest.fn(async key => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key, value) => { values.set(key, value); }),
    deleteItemAsync: jest.fn(async key => { values.delete(key); }),
  };
});

// `expo-audio` reaches for its native module at *import* time — it subclasses
// a native `SharedObject`, so the file cannot even be loaded without one, and
// the failure is a bare "Cannot read properties of undefined (reading
// 'prototype')" pointing at the import line rather than at anything a test did.
//
// Global rather than per-suite, unlike the `expo-video` mocks the feed tests
// each build for themselves: those assert *on* the player (is exactly one
// playing?), so each suite wants its own instrumented double. Nothing asserts
// on the music bed yet, and every suite that renders a Swift card now pulls
// `hooks/useMusicBed` in transitively — so the alternative is the same inert
// stub copied into a dozen files.
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({
    id: 0,
    playing: false,
    muted: false,
    loop: false,
    paused: true,
    isLoaded: true,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    play: jest.fn(),
    pause: jest.fn(),
    // Resolved, not undefined: `useMusicBed` chains `.then(release, release)`
    // off it to clear its seek guard, and a bare `jest.fn()` would throw there.
    seekTo: jest.fn(async () => {}),
    remove: jest.fn(),
    replace: jest.fn(),
  }),
  useAudioPlayerStatus: () => ({
    isLoaded: true, playing: false, currentTime: 0, duration: 0,
  }),
  setAudioModeAsync: jest.fn(async () => {}),
}));
