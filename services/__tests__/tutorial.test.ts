import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  hasSeenStoryTutorial,
  hasSeenZoneTutorial,
  markStoryTutorialSeen,
  markZoneTutorialSeen,
} from '../tutorial';

const USER_A = 101;
const USER_B = 202;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('story tutorial (step 1)', () => {
  it('is unset for a fresh account', async () => {
    expect(await hasSeenStoryTutorial(USER_A)).toBe(false);
  });

  it('is set once dismissed', async () => {
    await markStoryTutorialSeen(USER_A);
    expect(await hasSeenStoryTutorial(USER_A)).toBe(true);
  });

  it('does not mark step 2 or overall completion', async () => {
    await markStoryTutorialSeen(USER_A);
    expect(await hasSeenZoneTutorial(USER_A)).toBe(false);
  });

  it('is scoped per account — a different id has not seen it', async () => {
    await markStoryTutorialSeen(USER_A);
    expect(await hasSeenStoryTutorial(USER_B)).toBe(false);
  });

  it('reads as unseen when storage fails rather than throwing', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('nope'));
    expect(await hasSeenStoryTutorial(USER_A)).toBe(false);
  });

  it('does not throw when it cannot be written', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('nope'));
    await expect(markStoryTutorialSeen(USER_A)).resolves.toBeUndefined();
  });
});

describe('zone tutorial (step 2)', () => {
  it('is unset for a fresh account', async () => {
    expect(await hasSeenZoneTutorial(USER_A)).toBe(false);
  });

  it('is set once dismissed', async () => {
    await markZoneTutorialSeen(USER_A);
    expect(await hasSeenZoneTutorial(USER_A)).toBe(true);
  });

  it('is scoped per account — a different id has not seen it', async () => {
    await markZoneTutorialSeen(USER_A);
    expect(await hasSeenZoneTutorial(USER_B)).toBe(false);
  });

  it('does not throw when it cannot be written', async () => {
    jest.spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('nope'))
      .mockRejectedValueOnce(new Error('nope'));
    await expect(markZoneTutorialSeen(USER_A)).resolves.toBeUndefined();
  });

  it('a returning account keeps its answer — dismissing does not need sign-out to survive', async () => {
    await markStoryTutorialSeen(USER_A);
    await markZoneTutorialSeen(USER_A);
    // No sign-out simulated here on purpose: services/signOut.ts deliberately
    // never touches these keys, so there is nothing to re-arm between logins.
    expect(await hasSeenStoryTutorial(USER_A)).toBe(true);
    expect(await hasSeenZoneTutorial(USER_A)).toBe(true);
  });
});
