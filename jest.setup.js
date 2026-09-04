// Native modules that have no JS implementation under Jest.
//
// AsyncStorage throws on import rather than on use, so a module that merely
// imports it — services/zoneArea, for one — cannot be loaded at all without
// this, however pure the functions being tested are.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// react-native-worklets initialises its native module at *import* time from
// 0.10 on (SDK 57): `loadUnpackers` reads off a TurboModule that does not
// exist under Jest, so merely importing the module throws before any test
// runs. Anything reaching components/ui/useSheetDrag took three suites down
// with it.
//
// Only two functions are needed. `scheduleOnRN` is the whole surface the app
// uses, and `createSerializable` is what reanimated itself imports from here
// (core.js, UpdateLayoutAnimations.js) - omit it and the failure moves into
// reanimated and reads as a bug in the code under test.
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn, ...args) => fn(...args),
  createSerializable: (value) => value,
}));
