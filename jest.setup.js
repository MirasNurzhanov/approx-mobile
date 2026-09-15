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
