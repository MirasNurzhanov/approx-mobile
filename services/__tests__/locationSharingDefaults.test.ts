/**
 * What the client assumes before the server has told it anything.
 *
 * This file used to assert the opposite of what it asserts now, and the
 * inversion is deliberate rather than a loosening. Not knowing used to mean
 * Paused, because visibility was a per-launch choice and guessing "live" would
 * transmit a position nobody had opted into. Sharing follows the OS permission
 * now, so the overwhelmingly common case of "not known yet" is somebody
 * perfectly ordinary mid-cold-start, and answering "ghosted" would hide them
 * from their own map for the first moment of every launch — the exact
 * complaint this model was built to fix.
 *
 * What stops a cold *install* from transmitting is no longer this default. It
 * is the disclosure gate: `reportLocation` sends nothing until the person has
 * been shown what being on the map means, so an install that has not got that
 * far reports no position, and a row with no position is on nobody's map. The
 * second describe block below is where that is pinned.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getCachedGhostMode,
  refreshPrivacy,
  resetPrivacy,
  type PrivacySettings,
} from '../privacy';
import { isLocationNotAvailable, LOCATION_NOT_AVAILABLE } from '../discovery';
import {
  acknowledgeLocationDisclosure,
  resetLocationDisclosure,
} from '../locationDisclosure';
import { prepareCoordinates } from '../location';

jest.mock('../api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  BASE_URL: 'https://example.test',
}));

const { api } = jest.requireMock('../api');
const GHOST_STORAGE = 'aura:privacy:ghostMode';

/**
 * Run `body` with the mirror unreadable, then put it back exactly as it was.
 *
 * Swapped by hand rather than with `jest.spyOn(...).mockRestore()`. The
 * AsyncStorage mock's methods are already `jest.fn()`s, and restoring a spy
 * over one of those leaves a live stub with no implementation behind it — so
 * every `getItem` in every *later* test in this file quietly answers
 * `undefined`, and assertions that expect a default start passing for the
 * wrong reason. Keeping the original reference is the only version that
 * genuinely restores.
 */
async function withUnreadableStore(body: () => Promise<void>): Promise<void> {
  const original = AsyncStorage.getItem;
  (AsyncStorage as { getItem: unknown }).getItem = jest
    .fn()
    .mockRejectedValue(new Error('boom'));
  try {
    await body();
  } finally {
    (AsyncStorage as { getItem: unknown }).getItem = original;
  }
}

function settings(overrides: Partial<PrivacySettings> = {}): PrivacySettings {
  return {
    ghost_mode: false,
    is_private: false,
    visibility_interests: 'everyone',
    visibility_stories: 'friends',
    visibility_stats: 'friends',
    visibility_zone_audio: 'friends',
    visibility_connections: 'friends',
    visibility_links: 'friends',
    visibility_presence: 'friends',
    discoverable_by_username: true,
    discoverable_by_interest: true,
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await resetPrivacy();
  await resetLocationDisclosure();
  // Only the api stubs, deliberately — not `jest.clearAllMocks()`. The
  // AsyncStorage mock is itself built from `jest.fn()`s, and clearing those
  // strips the implementation backing the store, so every later `getItem`
  // quietly answers `undefined`. Two tests below spy on `getItem` to simulate
  // an unreadable mirror; with a global clear, the restore leaves a dead stub
  // and the tests *after* them pass or fail for the wrong reason.
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
});

describe('getCachedGhostMode — what unknown means', () => {
  it('is not ghosted on a cold install, with nothing cached anywhere', async () => {
    await expect(getCachedGhostMode()).resolves.toBe(false);
  });

  it('is not ghosted when the stored value is missing', async () => {
    await AsyncStorage.removeItem(GHOST_STORAGE);
    await expect(getCachedGhostMode()).resolves.toBe(false);
  });

  it('is not ghosted when the stored value is unrecognised', async () => {
    // A truncated write, or a value from a build that spelled this
    // differently. Anything unrecognised is "we do not know".
    for (const junk of ['', 'null', 'undefined', 'true', 'paused', '{}']) {
      await AsyncStorage.setItem(GHOST_STORAGE, junk);
      await expect(getCachedGhostMode()).resolves.toBe(false);
    }
  });

  it('reads a real ghost off the mirror rather than guessing', async () => {
    // The case the default relies on. A ghost has '1' on disk from the moment
    // they turned it on, so "unknown" never describes them for long enough to
    // matter — including in the background task, which wakes into a fresh JS
    // context with an empty store and only has the mirror to go on.
    await AsyncStorage.setItem(GHOST_STORAGE, '1');
    await expect(getCachedGhostMode()).resolves.toBe(true);
  });

  it('reports the real state once the server has answered', async () => {
    api.get.mockResolvedValue({ data: settings({ ghost_mode: true }) });
    await refreshPrivacy();
    await expect(getCachedGhostMode()).resolves.toBe(true);
  });

  it('does not let one account inherit the previous one after sign-out', async () => {
    api.get.mockResolvedValue({ data: settings({ ghost_mode: true }) });
    await refreshPrivacy();
    await expect(getCachedGhostMode()).resolves.toBe(true);

    await resetPrivacy();

    await expect(getCachedGhostMode()).resolves.toBe(false);
    await expect(AsyncStorage.getItem(GHOST_STORAGE)).resolves.toBeNull();
  });

  it('is not ghosted when the mirror read throws', async () => {
    await withUnreadableStore(async () => {
      await expect(getCachedGhostMode()).resolves.toBe(false);
    });
  });
});

describe('the disclosure gate is what fails closed', () => {
  const HERE = { latitude: 10.123456, longitude: 20.654321 };

  it('sends nothing at all before the disclosure has been shown', async () => {
    // The load-bearing assertion of the whole migration. Every account arrives
    // at this build not ghosted, including the ones that were paused before,
    // so this is what stands between them and being published unannounced.
    await expect(prepareCoordinates(HERE)).resolves.toBeNull();
  });

  it('sends once it has been acknowledged', async () => {
    await acknowledgeLocationDisclosure();
    await expect(prepareCoordinates(HERE)).resolves.toEqual(HERE);
  });

  it('stops again for a ghost, acknowledged or not', async () => {
    await acknowledgeLocationDisclosure();
    await AsyncStorage.setItem(GHOST_STORAGE, '1');
    await expect(prepareCoordinates(HERE)).resolves.toBeNull();
  });

  it('closes again for the next account after a sign-out', async () => {
    await acknowledgeLocationDisclosure();
    await expect(prepareCoordinates(HERE)).resolves.toEqual(HERE);

    await resetLocationDisclosure();

    // Per install, not per account: the next person has read nothing.
    await expect(prepareCoordinates(HERE)).resolves.toBeNull();
  });

  it('fails closed when the flag cannot be read', async () => {
    await withUnreadableStore(async () => {
      await expect(prepareCoordinates(HERE)).resolves.toBeNull();
    });
  });
});

describe('isLocationNotAvailable', () => {
  it('recognises the server code', () => {
    expect(isLocationNotAvailable({
      response: { status: 400, data: { code: LOCATION_NOT_AVAILABLE } },
    })).toBe(true);
  });

  it('does not fire on an unrelated 400', () => {
    // The whole reason this keys on the code: a validation failure retried
    // through the private query would turn a real bug into a silent one.
    expect(isLocationNotAvailable({
      response: { status: 400, data: { latitude: ['Ensure this value is >= -90.'] } },
    })).toBe(false);
  });

  it('does not fire on the paused code', () => {
    // Different state, different screen: paused is a choice with nothing to
    // wait for, and must never render as "getting your location…".
    expect(isLocationNotAvailable({
      response: { status: 400, data: { code: 'location_sharing_paused' } },
    })).toBe(false);
  });

  it('does not fire on a transport failure with no response at all', () => {
    expect(isLocationNotAvailable(new Error('Network Error'))).toBe(false);
    expect(isLocationNotAvailable(undefined)).toBe(false);
  });
});
