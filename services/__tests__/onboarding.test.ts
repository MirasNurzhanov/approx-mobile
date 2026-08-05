// Which screen a signed-out user lands on.
//
// Small, but it is the whole difference between "Sign out took me to Log in"
// and "Sign out took me to a three-slide introduction to an app I have been
// using for months". The flag is per device and survives sign-out on purpose —
// see the account-scoped key list in services/signOut, which deliberately
// leaves it alone.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasSeenOnboarding, markOnboardingSeen, ONBOARDING_SEEN_KEY } from '../onboarding';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('onboarding flag', () => {
  it('is unset on a fresh device', async () => {
    expect(await hasSeenOnboarding()).toBe(false);
  });

  it('is set once the intro has been shown', async () => {
    await markOnboardingSeen();
    expect(await hasSeenOnboarding()).toBe(true);
  });

  it('records when, so the value is diagnosable rather than just truthy', async () => {
    await markOnboardingSeen();
    const stored = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY);
    expect(Number.isNaN(Date.parse(stored as string))).toBe(false);
  });

  it('survives clearing the account-scoped keys, which is what sign-out does', async () => {
    await markOnboardingSeen();
    await AsyncStorage.multiRemove(['access_token', 'refresh_token', 'chat_last_seen']);
    expect(await hasSeenOnboarding()).toBe(true);
  });

  it('reads as unseen when storage fails rather than throwing', async () => {
    // The carousel is skippable in three taps and ends where /welcome does, so
    // failing towards it costs nothing. Failing *loudly* would strand the app
    // on a blank index screen.
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('nope'));
    expect(await hasSeenOnboarding()).toBe(false);
  });

  it('does not throw when it cannot be written', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('nope'));
    await expect(markOnboardingSeen()).resolves.toBeUndefined();
  });
});
