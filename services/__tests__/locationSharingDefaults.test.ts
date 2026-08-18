/**
 * Public visibility fails closed on the client.
 *
 * The invariant: if the app cannot establish what the user chose, it behaves
 * as Paused until the server says otherwise. Every entry below is a way of not
 * knowing — a cold install, a wiped mirror, a corrupt one, the gap after a
 * sign-out — and all of them have to answer the same way.
 *
 * This matters even though the server refuses to publish a paused user's
 * position anyway. A client that guesses "live" transmits a position before
 * anyone chose to share it, and relies on the server to throw it away; the
 * request still left the device. Fail-closed means it never goes.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getCachedLocationSharing,
  refreshPrivacy,
  resetPrivacy,
  type PrivacySettings,
} from '../privacy';
import { isLocationNotAvailable, LOCATION_NOT_AVAILABLE } from '../discovery';

jest.mock('../api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  BASE_URL: 'https://example.test',
}));

const { api } = jest.requireMock('../api');
const SHARING_STORAGE = 'aura:privacy:locationSharing';

function settings(overrides: Partial<PrivacySettings> = {}): PrivacySettings {
  return {
    location_sharing: 'live',
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
  jest.clearAllMocks();
});

describe('getCachedLocationSharing — the safe default', () => {
  it('is paused on a cold install, with nothing cached anywhere', async () => {
    await expect(getCachedLocationSharing()).resolves.toBe('paused');
  });

  it('is paused when the stored value is missing', async () => {
    await AsyncStorage.removeItem(SHARING_STORAGE);
    await expect(getCachedLocationSharing()).resolves.toBe('paused');
  });

  it('is paused when the stored value is not one of the three modes', async () => {
    // A truncated write, or a value from a build that spelled these
    // differently. Anything unrecognised is "we do not know", not "live".
    for (const junk of ['', 'null', 'undefined', 'LIVE', 'active', '{}']) {
      await AsyncStorage.setItem(SHARING_STORAGE, junk);
      await expect(getCachedLocationSharing()).resolves.toBe('paused');
    }
  });

  it('is paused after a sign-out has cleared the store', async () => {
    api.get.mockResolvedValue({ data: settings({ location_sharing: 'live' }) });
    await refreshPrivacy();
    await expect(getCachedLocationSharing()).resolves.toBe('live');

    await resetPrivacy();

    // The next account on this device must not inherit the previous one's
    // sharing mode, in memory or on disk.
    await expect(getCachedLocationSharing()).resolves.toBe('paused');
    await expect(AsyncStorage.getItem(SHARING_STORAGE)).resolves.toBeNull();
  });

  it('reports the real mode once the server has answered', async () => {
    api.get.mockResolvedValue({ data: settings({ location_sharing: 'approximate' }) });
    await refreshPrivacy();
    await expect(getCachedLocationSharing()).resolves.toBe('approximate');
  });

  it('survives a relaunch through the disk mirror rather than re-guessing', async () => {
    api.get.mockResolvedValue({ data: settings({ location_sharing: 'live' }) });
    await refreshPrivacy();

    // In-memory store gone, disk intact — a fresh JS context, which is what
    // the background location task always wakes into.
    await resetPrivacy();
    await AsyncStorage.setItem(SHARING_STORAGE, 'live');

    await expect(getCachedLocationSharing()).resolves.toBe('live');
  });

  it('is paused when the mirror read throws', async () => {
    const getItem = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('boom'));
    try {
      await expect(getCachedLocationSharing()).resolves.toBe('paused');
    } finally {
      getItem.mockRestore();
    }
  });

  it('is paused when the privacy fetch fails outright', async () => {
    api.get.mockRejectedValue(new Error('offline'));
    await expect(refreshPrivacy()).rejects.toThrow();
    await expect(getCachedLocationSharing()).resolves.toBe('paused');
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
