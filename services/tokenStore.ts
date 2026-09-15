/** Credentials live only in platform secure storage. No plaintext fallback. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const SESSION = 'aura.auth.session.v1';
const REVOCATION = 'aura.auth.revocation.v1';
const LEGACY_REVOCATION = 'aura:auth:pendingRevocation';
// Non-secret, durable kill switch if the OS cannot delete a keychain item.
const SIGNED_OUT = 'aura.auth.signedOut.v1';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
type Session = { access: string | null; refresh: string | null };
type TokenKey = 'access_token' | 'refresh_token' | typeof LEGACY_REVOCATION;
let queue: Promise<unknown> = Promise.resolve();
let migrated = false;

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation).catch(() => {
    // Native/storage errors can embed their arguments. Never forward them.
    throw new Error('Secure credential storage is unavailable. Unlock your device and try again.');
  });
  queue = result.catch(() => {});
  return result;
}

async function secureRead(key: string) {
  try { return await SecureStore.getItemAsync(key, OPTIONS); }
  catch { throw new Error('Secure credential storage is unavailable. Unlock your device and try again.'); }
}

async function secureWrite(key: string, value: string) {
  try { await SecureStore.setItemAsync(key, value, OPTIONS); }
  catch { throw new Error('Credentials could not be saved securely. Please try again.'); }
}

async function readSession(): Promise<Session> {
  const raw = await secureRead(SESSION);
  if (!raw) return { access: null, refresh: null };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') throw new Error();
    const session = value as Session;
    if ((session.access !== null && typeof session.access !== 'string')
        || (session.refresh !== null && typeof session.refresh !== 'string')) throw new Error();
    return session;
  } catch { throw new Error('Stored credentials could not be read. Please sign in again.'); }
}

async function migrate() {
  if (migrated) return;
  if (await AsyncStorage.getItem(SIGNED_OUT)) {
    // Retry a failed keychain deletion on the next launch, before any read.
    await SecureStore.deleteItemAsync(SESSION, OPTIONS);
  }
  // Preserve an existing secure session as a pair; never mix users' tokens.
  const secure = await secureRead(SESSION);
  const legacy = await AsyncStorage.multiGet(['access_token', 'refresh_token', LEGACY_REVOCATION]);
  if (!await AsyncStorage.getItem(SIGNED_OUT) && !secure && (legacy[0][1] || legacy[1][1])) {
    const value = JSON.stringify({ access: legacy[0][1], refresh: legacy[1][1] });
    await secureWrite(SESSION, value);
    if (await secureRead(SESSION) !== value) throw new Error('Secure credential migration was not confirmed.');
  }
  if (!await secureRead(REVOCATION) && legacy[2][1]) {
    await secureWrite(REVOCATION, legacy[2][1]);
    if (await secureRead(REVOCATION) !== legacy[2][1]) throw new Error('Secure revocation migration was not confirmed.');
  }
  // A failed copy never deletes the only usable copy; a failed cleanup retries
  // on the next operation/start. No new credential is ever written to AsyncStorage.
  await AsyncStorage.multiRemove(['access_token', 'refresh_token', LEGACY_REVOCATION]);
  migrated = true;
}

export const tokenStore = {
  getItem(key: TokenKey): Promise<string | null> {
    return serial(async () => {
      await migrate();
      if (key === LEGACY_REVOCATION) return secureRead(REVOCATION);
      if (await AsyncStorage.getItem(SIGNED_OUT)) return null;
      return (await readSession())[key === 'access_token' ? 'access' : 'refresh'];
    });
  },
  setSession(access: string, refresh: string): Promise<void> {
    return serial(async () => {
      if (!access || !refresh || typeof access !== 'string' || typeof refresh !== 'string') {
        throw new Error('Invalid credentials');
      }
      await migrate();
      await secureWrite(SESSION, JSON.stringify({ access, refresh }));
      await AsyncStorage.removeItem(SIGNED_OUT);
    });
  },
  rotateSession(expectedRefresh: string, access: string, refresh: string): Promise<boolean> {
    return serial(async () => {
      await migrate();
      if (await AsyncStorage.getItem(SIGNED_OUT)
          || (await readSession()).refresh !== expectedRefresh) return false;
      if (!access || !refresh || typeof access !== 'string' || typeof refresh !== 'string') {
        throw new Error('Invalid credentials');
      }
      await secureWrite(SESSION, JSON.stringify({ access, refresh }));
      return true;
    });
  },
  setItem(key: typeof LEGACY_REVOCATION, value: string): Promise<void> {
    return serial(async () => { await migrate(); await secureWrite(REVOCATION, value); });
  },
  removeItem(key: typeof LEGACY_REVOCATION): Promise<void> {
    return serial(async () => { await migrate(); await SecureStore.deleteItemAsync(REVOCATION, OPTIONS); });
  },
  clearSession(): Promise<void> {
    return serial(async () => {
      // Even a failed secure deletion must not restore a session on restart.
      // Attempt every cleanup even if a different storage system is broken.
      let failed = false;
      for (const operation of [
        () => AsyncStorage.setItem(SIGNED_OUT, '1'),
        () => AsyncStorage.multiRemove(['access_token', 'refresh_token']),
        () => SecureStore.deleteItemAsync(SESSION, OPTIONS),
      ]) {
        try { await operation(); } catch { failed = true; }
      }
      if (failed) throw new Error('Credential cleanup needs retry');
    });
  },
};
