import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { api } from './api';

// This installation's identity, and telling the server about it.
//
// The server keys one `Device` row per (account, install id) and raises the
// "new sign-in" alert when a row appears for an account that already had one
// — so what this file guarantees is the half that makes that alert correct:
// the id is stable for the life of the install, and it is *not* the push
// token. Expo reissues tokens on its own schedule, and keying on one would
// make a single phone look like a stream of new devices, each reissue firing
// a security warning at its owner.
//
// Deliberately device-scoped, not account-scoped. It is left out of
// `ACCOUNT_SCOPED_KEYS` in services/signOut, so signing out and back in on the
// same phone is recognised rather than announced — which is what keeps the
// alert meaning "somewhere new" instead of "you, again".

const INSTALL_ID_KEY = 'aura:device:installId';

/**
 * A v4-shaped UUID from `Math.random`.
 *
 * Not `crypto`: expo-crypto is not a dependency here and adding one would mean
 * a native rebuild for a value that does not need to be unguessable. This is
 * an opaque local label, never a credential — the server authenticates the
 * request with the bearer token and only ever reads this to tell one of *your
 * own* installs from another. Collision across two installs is the only
 * failure mode that matters, and 122 random bits makes that impossible in
 * practice.
 */
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Cached so concurrent callers on one launch cannot each mint a different id
 *  and race each other into storage — the loser's id would be a second device
 *  as far as the server is concerned, and a false alarm for its owner. */
let installIdPromise: Promise<string> | null = null;

async function readOrCreateInstallId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (stored) return stored;
    const fresh = uuid();
    await AsyncStorage.setItem(INSTALL_ID_KEY, fresh);
    return fresh;
  } catch {
    // Storage is unavailable. A fresh id every launch would announce a new
    // device on each one, so the caller is told there is nothing to register
    // rather than handed an id that cannot be relied on.
    return '';
  }
}

export function getInstallId(): Promise<string> {
  if (!installIdPromise) installIdPromise = readOrCreateInstallId();
  return installIdPromise;
}

/**
 * What the alert on the other phone will call this one.
 *
 * `Constants.deviceName` is the name the owner gave the device ("Nurdaulet's
 * iPhone"), which is the only label that means anything in a sentence like
 * "signed in on …". It is absent on some Android builds, hence the fallback to
 * the platform, which at least distinguishes a phone from the tablet beside it.
 */
export function deviceName(): string {
  const given = Constants.deviceName?.trim();
  if (given) return given;
  return Platform.OS === 'ios' ? 'an iPhone' : 'an Android device';
}

/**
 * Tell the server this install exists, and hand it the current push token.
 *
 * Safe to call on every launch: the server updates a known install in place
 * and stays silent, and only announces one it has not seen against this
 * account before.
 *
 * Never throws. A failed registration costs this device its notifications
 * until the next launch, which is not worth failing a sign-in over.
 */
export async function registerDevice(pushToken?: string | null): Promise<void> {
  const installId = await getInstallId();
  if (!installId) return;
  try {
    await api.post('/api/users/devices/', {
      install_id: installId,
      push_token: pushToken ?? '',
      name: deviceName(),
      platform: Platform.OS,
    });
  } catch {
    // Logged nowhere on purpose — this runs on every launch, and a device that
    // is simply offline should not fill the console with it.
  }
}
