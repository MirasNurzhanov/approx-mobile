import AsyncStorage from '@react-native-async-storage/async-storage';

// Whether *this account* has been shown how the app works.
//
// Two keys, not one, and the second is the reason this file exists at all.
//
// A "seen" flag on its own cannot answer the question that matters. Everyone
// who has not seen the guide reads as "show it", and that includes every
// account that existed before the guide did — so shipping it would walk the
// whole user base through an introduction to an app they already know. The
// guide is for people who just signed up, and the only moment that fact is
// available is the moment they sign up. So registration writes `pending`, and
// the guide is shown to whoever is carrying it. Nobody else ever gets one.
//
// `pending` is also what makes "exactly once" survive a closed app. The guide
// sits at the end of the sign-up chain, and a chain can be abandoned halfway —
// the phone rings, the app is killed, the next launch goes straight to the map
// with a session that is perfectly valid. Without the marker that user has
// silently missed the guide for good; with it, `app/index.tsx` picks the chain
// back up where it stopped.
//
// Both are account-scoped and cleared by services/signOut, unlike
// `onboarding_seen` (services/onboarding), which describes the device. Two
// people sharing a phone each get their own guide; one person signing back in
// does not get a second one.

/** Written at sign-up, cleared when the guide is finished or skipped. */
export const GUIDE_PENDING_KEY = 'aura:guide:pending';
/** Written when the guide is done with. Never read by the routing — it is the
 *  record that it happened, and what stops a re-run if `pending` is somehow
 *  written twice. */
export const GUIDE_SEEN_KEY = 'aura:guide:seen';

/** Remember that this account has just signed up and is owed the guide.
 *
 * Best effort in the sense that it must never block registration: a failed
 * write costs the guide, not the account. It is still awaited, because the
 * navigation that follows can outlive this frame.
 */
export async function markGuidePending(): Promise<void> {
  try {
    await AsyncStorage.setItem(GUIDE_PENDING_KEY, new Date().toISOString());
  } catch {
    // Nothing to do about it here — see above.
  }
}

/** Whether the signed-in account still has a guide waiting for it.
 *
 * A storage failure reads as "no", which is the safe direction: the cost is a
 * guide nobody saw, against showing one to someone who has already read it.
 */
export async function isGuidePending(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(GUIDE_PENDING_KEY)) !== null;
  } catch {
    return false;
  }
}

/** The guide is done with — finished or skipped, which are the same thing to
 *  storage. Clearing `pending` is what makes it once and only once. */
export async function markGuideSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(GUIDE_SEEN_KEY, new Date().toISOString());
    await AsyncStorage.removeItem(GUIDE_PENDING_KEY);
  } catch {
    // A failure here shows the guide once more on the next launch, which is
    // annoying rather than broken, and better than swallowing the error into a
    // state where it never shows at all.
  }
}
