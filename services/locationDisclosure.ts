import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

// The one screen that tells somebody they are on the map, shown once.
//
// Sharing follows the OS location permission now — there is no per-launch
// check-in and no Live/Approximate choice — so the moment where a person is
// told what that means has to exist somewhere, and this is it. It is shown
// once per install, before the first position is ever transmitted, and
// `reportLocation` refuses to send anything until it has been acknowledged.
//
// That ordering is the whole point and it is not decoration. Every account
// arrives at this build not ghosted, including the ones migrated from the old
// paused-by-default world (see users/migrations/0035). What stops that from
// publishing anybody unannounced is that a client which has not shown this
// screen reports no position, and a row with no position is on nobody's map.
// So the gate is upstream of the transmission rather than beside it.
//
// Deliberately *not* a consent gate on the OS permission. The system dialog is
// its own affirmative act and Apple is specific that nothing may stand between
// a custom explainer and it — see components/PermissionPrimer, and guideline
// 5.1.1(iv), which this app has already been rejected under once. This screen
// explains what sharing *means* to other people, which the OS dialog does not
// and cannot.

const STORAGE_KEY = 'aura:location:disclosureAcknowledged';

/** In-memory mirror, so the report path can answer without a disk read on
 *  every tick. `null` until the first read resolves. */
let acknowledged: boolean | null = null;

const listeners = new Set<() => void>();

function announce() {
  listeners.forEach((l) => l());
}

/**
 * Whether the disclosure has been seen on this install.
 *
 * Fails *closed*: an unreadable store answers false, so the failure mode is a
 * screen shown twice rather than a position sent before it was shown once.
 */
export async function hasAcknowledgedLocationDisclosure(): Promise<boolean> {
  if (acknowledged !== null) return acknowledged;
  try {
    acknowledged = (await AsyncStorage.getItem(STORAGE_KEY)) === '1';
  } catch {
    acknowledged = false;
  }
  return acknowledged;
}

/** Record that the person has read it. Called from the screen's one button. */
export async function acknowledgeLocationDisclosure(): Promise<void> {
  acknowledged = true;
  announce();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Kept in memory for this run either way. The cost of the write failing is
    // that it is shown again next launch, which is the harmless direction.
  }
}

/**
 * Forget it, for sign-out.
 *
 * Per install rather than per account: the next person to sign in on this
 * device has not read anything, and inheriting an acknowledgement would be the
 * one case where somebody is published without ever having been told.
 */
export async function resetLocationDisclosure(): Promise<void> {
  acknowledged = null;
  announce();
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** `null` while the answer is still being read, so the caller can render
 *  nothing rather than flashing the sheet at somebody who has seen it. */
export function useLocationDisclosure(): {
  acknowledged: boolean | null;
  acknowledge: () => Promise<void>;
} {
  const [value, setValue] = useState<boolean | null>(acknowledged);

  useEffect(() => {
    let active = true;
    const sync = () => { if (active) setValue(acknowledged); };
    listeners.add(sync);
    hasAcknowledgedLocationDisclosure().then(sync).catch(() => {});
    return () => {
      active = false;
      listeners.delete(sync);
    };
  }, []);

  const acknowledge = useCallback(async () => {
    await acknowledgeLocationDisclosure();
  }, []);

  return { acknowledged: value, acknowledge };
}
