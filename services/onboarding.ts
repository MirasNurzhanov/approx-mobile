import AsyncStorage from '@react-native-async-storage/async-storage';

// Whether this *device* has been introduced to Aura.
//
// Per device, not per account, and that is the whole point of it: the carousel
// explains what the app is, which is a thing you need told once and never
// again. Signing out deliberately leaves this key alone (see the account-scoped
// list in services/signOut), so a returning user lands on Log in / Create
// account instead of being walked through an introduction to an app they were
// using a minute ago.

export const ONBOARDING_SEEN_KEY = 'onboarding_seen';

/** Whether the intro has been shown on this device. Never throws — a storage
 *  failure reads as "not seen", which costs three skippable taps. */
export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)) !== null;
  } catch {
    return false;
  }
}

/** Remember that the intro has been shown. Best effort: failing to record it
 *  shows the carousel again, which is not worth blocking the tap for. */
export async function markOnboardingSeen(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, new Date().toISOString()).catch(() => {});
}
