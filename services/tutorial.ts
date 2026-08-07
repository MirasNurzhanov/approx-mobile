import AsyncStorage from '@react-native-async-storage/async-storage';

// The first-run feature tutorial — two spotlighted steps shown once each per
// *account*, the same way services/onboarding.ts introduces the app itself
// once per *device*. That distinction is why every key here is namespaced by
// user id rather than being a flat flag:
//
//   - A flat flag cleared on sign-out re-arms for the same account every time
//     they log back in — "first login" became "first login this session".
//   - A flat flag left alone across sign-out never re-arms for a second
//     account that signs in on the same phone — it inherits the first
//     account's answer.
//
// Namespacing by id is the only one of the two that actually answers "has
// *this* account seen it" — so these keys are deliberately left out of
// services/signOut's ACCOUNT_SCOPED_KEYS. They don't need wiping; a
// different id signing in just never reads them.

const TUTORIAL_STEP1_PREFIX = 'tutorial_step1_seen';
const TUTORIAL_STEP2_PREFIX = 'tutorial_step2_seen';
const TUTORIAL_COMPLETED_PREFIX = 'tutorial_completed';

type UserId = number | string;

function keyFor(prefix: string, userId: UserId): string {
  return `${prefix}:${userId}`;
}

/** Never throws — a storage failure reads as "not seen", which costs one
 *  skippable tap, not a crash. */
async function hasSeen(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) !== null;
  } catch {
    return false;
  }
}

async function markSeen(key: string): Promise<void> {
  await AsyncStorage.setItem(key, new Date().toISOString()).catch(() => {});
}

export const hasSeenStoryTutorial = (userId: UserId) =>
  hasSeen(keyFor(TUTORIAL_STEP1_PREFIX, userId));

export const hasSeenZoneTutorial = (userId: UserId) =>
  hasSeen(keyFor(TUTORIAL_STEP2_PREFIX, userId));

export function markStoryTutorialSeen(userId: UserId): Promise<void> {
  return markSeen(keyFor(TUTORIAL_STEP1_PREFIX, userId));
}

/** Step 2 is the last one, so seeing it also completes the tutorial as a
 *  whole — a single flag other screens can check without knowing there are
 *  two steps behind it. */
export async function markZoneTutorialSeen(userId: UserId): Promise<void> {
  await markSeen(keyFor(TUTORIAL_STEP2_PREFIX, userId));
  await markSeen(keyFor(TUTORIAL_COMPLETED_PREFIX, userId));
}
