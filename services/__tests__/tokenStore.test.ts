import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const SESSION = 'aura.auth.session.v1';
const REVOCATION = 'aura.auth.revocation.v1';
const PENDING = 'aura:auth:pendingRevocation';
let store: typeof import('../tokenStore').tokenStore;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await SecureStore.deleteItemAsync(SESSION);
  await SecureStore.deleteItemAsync(REVOCATION);
  jest.isolateModules(() => { store = jest.requireActual('../tokenStore').tokenStore; });
});

test('migrates a pair and pending revocation, verifies the copy, removes plaintext', async () => {
  await AsyncStorage.multiSet([['access_token', 'old-access'], ['refresh_token', 'old-refresh'], [PENDING, 'pending']]);
  expect(await store.getItem('access_token')).toBe('old-access');
  expect(await store.getItem('refresh_token')).toBe('old-refresh');
  expect(await store.getItem(PENDING)).toBe('pending');
  expect(await AsyncStorage.multiGet(['access_token', 'refresh_token', PENDING])).toEqual([
    ['access_token', null], ['refresh_token', null], [PENDING, null],
  ]);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(SESSION,
    JSON.stringify({ access: 'old-access', refresh: 'old-refresh' }),
    { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
});

test('an existing secure pair wins without mixing accounts', async () => {
  await SecureStore.setItemAsync(SESSION, JSON.stringify({ access: 'secure-a', refresh: 'secure-r' }));
  await AsyncStorage.multiSet([['access_token', 'legacy-a'], ['refresh_token', 'legacy-r']]);
  expect(await store.getItem('access_token')).toBe('secure-a');
  expect(await store.getItem('refresh_token')).toBe('secure-r');
  expect(await AsyncStorage.getItem('refresh_token')).toBeNull();
});

test('failed copy retains the only credential copy and sanitizes native errors', async () => {
  await AsyncStorage.setItem('access_token', 'secret-access');
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('native secret-access'));
  await expect(store.getItem('access_token')).rejects.toThrow('Secure credential storage is unavailable');
  expect(await AsyncStorage.getItem('access_token')).toBe('secret-access');
  expect(await store.getItem('access_token')).toBe('secret-access');
});

test('unconfirmed writes never delete the original', async () => {
  await AsyncStorage.setItem('access_token', 'only-copy');
  jest.mocked(SecureStore.setItemAsync).mockResolvedValueOnce(undefined);
  await expect(store.getItem('access_token')).rejects.toThrow('Secure credential storage');
  expect(await AsyncStorage.getItem('access_token')).toBe('only-copy');
});

test('cleanup failure is retried and does not replace the already migrated pair', async () => {
  await AsyncStorage.multiSet([['access_token', 'a'], ['refresh_token', 'r']]);
  jest.mocked(AsyncStorage.multiRemove).mockRejectedValueOnce(new Error('disk error'));
  await expect(store.getItem('access_token')).rejects.toThrow();
  expect(await store.getItem('refresh_token')).toBe('r');
  expect(await AsyncStorage.getItem('access_token')).toBeNull();
});

test('concurrent reads and rotated writes are serialized as complete pairs', async () => {
  await AsyncStorage.multiSet([['access_token', 'old-a'], ['refresh_token', 'old-r']]);
  const results = await Promise.all([
    store.getItem('access_token'), store.setSession('new-a', 'new-r'), store.getItem('refresh_token'),
  ]);
  expect(results).toEqual(['old-a', undefined, 'new-r']);
  expect(JSON.parse((await SecureStore.getItemAsync(SESSION))!)).toEqual({ access: 'new-a', refresh: 'new-r' });
  expect(AsyncStorage.setItem).not.toHaveBeenCalledWith('access_token', expect.anything());
});

test('failed deletion cannot resurrect credentials after module restart', async () => {
  await store.setSession('a', 'r');
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('locked'));
  await expect(store.clearSession()).rejects.toThrow();
  jest.isolateModules(() => { store = jest.requireActual('../tokenStore').tokenStore; });
  expect(await store.getItem('access_token')).toBeNull();
  expect(await store.getItem('refresh_token')).toBeNull();
  await store.setSession('next-a', 'next-r');
  expect(await store.getItem('access_token')).toBe('next-a');
});

test('logout clears both stores even before migration and keeps secure revocation', async () => {
  await AsyncStorage.multiSet([['access_token', 'a'], ['refresh_token', 'r']]);
  await SecureStore.setItemAsync(REVOCATION, 'pending');
  await store.clearSession();
  expect(await store.getItem('access_token')).toBeNull();
  expect(await store.getItem(PENDING)).toBe('pending');
  await store.removeItem(PENDING);
  expect(await store.getItem(PENDING)).toBeNull();
});

test('corrupted secure values fail closed and can be replaced by a fresh login', async () => {
  await SecureStore.setItemAsync(SESSION, 'secret-broken-json');
  await expect(store.getItem('access_token')).rejects.toThrow('Secure credential storage');
  await store.setSession('a', 'r');
  expect(await store.getItem('access_token')).toBe('a');
});

test('late refresh cannot undo logout or overwrite another account', async () => {
  await store.setSession('old-a', 'old-r');
  await store.clearSession();
  expect(await store.rotateSession('old-r', 'late-a', 'late-r')).toBe(false);
  expect(await store.getItem('access_token')).toBeNull();
  await store.setSession('next-a', 'next-r');
  expect(await store.rotateSession('old-r', 'late-a', 'late-r')).toBe(false);
  expect(await store.rotateSession('next-r', 'rotated-a', 'rotated-r')).toBe(true);
  expect(await store.getItem('refresh_token')).toBe('rotated-r');
});

test('a failed marker write does not prevent actual credential deletion', async () => {
  await store.setSession('a', 'r');
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
  await expect(store.clearSession()).rejects.toThrow();
  expect(await SecureStore.getItemAsync(SESSION)).toBeNull();
});
