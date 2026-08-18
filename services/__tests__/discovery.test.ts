/**
 * Which endpoint the client asks, and what it does when the answer is "not yet".
 *
 * Two rules:
 *   - Paused browses through the private query and never touches the public
 *     read, because there is no stored position for the public read to use.
 *   - `location_not_available` is a wait, not an empty result. It falls back to
 *     the private query once, using the fix we already have, and never turns
 *     into a loop.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchMapNearby, fetchNearbyUsers, LOCATION_NOT_AVAILABLE } from '../discovery';
import { resetPrivacy } from '../privacy';

jest.mock('../api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  BASE_URL: 'https://example.test',
}));

const { api } = jest.requireMock('../api');
const SHARING_STORAGE = 'aura:privacy:locationSharing';
const HERE = { latitude: 10, longitude: 10 };

function notAvailable() {
  return { response: { status: 400, data: { code: LOCATION_NOT_AVAILABLE } } };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await resetPrivacy();
  jest.clearAllMocks();
});

describe('while paused', () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(SHARING_STORAGE, 'paused');
  });

  it('browses through the private query and never the public read', async () => {
    api.post.mockResolvedValue({ data: { users: [], stories: [], meetups: [] } });

    await fetchMapNearby(HERE);

    expect(api.post).toHaveBeenCalledWith('/api/map/nearby/query/', {
      latitude: 10, longitude: 10,
    });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('sends only the coordinate — nothing that could be stored', async () => {
    api.post.mockResolvedValue({ data: [] });
    await fetchNearbyUsers(HERE);

    const [, body] = api.post.mock.calls[0];
    expect(Object.keys(body).sort()).toEqual(['latitude', 'longitude']);
  });

  it('asks nothing at all without a fix, rather than guessing a position', async () => {
    await expect(fetchMapNearby(null)).resolves.toBeNull();
    await expect(fetchNearbyUsers(null)).resolves.toEqual([]);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('while sharing', () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(SHARING_STORAGE, 'live');
  });

  it('uses the public read, anchored on the stored position', async () => {
    api.get.mockResolvedValue({ data: { users: [], stories: [], meetups: [] } });

    await fetchMapNearby(HERE);

    expect(api.get).toHaveBeenCalledWith('/api/map/nearby/');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('falls back to the private query when the position has not landed yet', async () => {
    // The gap right after resuming: pausing deleted the stored position, so
    // this is certain rather than rare.
    api.get.mockRejectedValue(notAvailable());
    api.post.mockResolvedValue({ data: { users: [{ id: 1 }], stories: [], meetups: [] } });

    const result: any = await fetchMapNearby(HERE);

    expect(api.post).toHaveBeenCalledWith('/api/map/nearby/query/', {
      latitude: 10, longitude: 10,
    });
    expect(result.users).toHaveLength(1);
  });

  it('falls back exactly once — a failed fallback surfaces, it does not loop', async () => {
    api.get.mockRejectedValue(notAvailable());
    api.post.mockRejectedValue(notAvailable());

    await expect(fetchMapNearby(HERE)).rejects.toBeDefined();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('rethrows when there is no fix to fall back with', async () => {
    // Nothing to answer the query with, so the caller has to hear about it and
    // show the pending state rather than an empty map.
    api.get.mockRejectedValue(notAvailable());

    await expect(fetchMapNearby(null)).rejects.toBeDefined();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('does not retry an unrelated 400 through the private query', async () => {
    // The failure this exists to prevent: a real bug quietly re-asked in a
    // different shape and reported as success.
    api.get.mockRejectedValue({
      response: { status: 400, data: { latitude: ['Invalid.'] } },
    });

    await expect(fetchNearbyUsers(HERE)).rejects.toBeDefined();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('does not retry a server error', async () => {
    api.get.mockRejectedValue({ response: { status: 500, data: {} } });

    await expect(fetchNearbyUsers(HERE)).rejects.toBeDefined();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('with no cached sharing state at all', () => {
  it('takes the private path, because unknown means paused', async () => {
    // Fail-closed all the way through: a cold start does not reach for the
    // public read, which is the one that assumes a published position exists.
    api.post.mockResolvedValue({ data: [] });

    await fetchNearbyUsers(HERE);

    expect(api.post).toHaveBeenCalledWith('/api/proximity/nearby/query/', {
      latitude: 10, longitude: 10,
    });
    expect(api.get).not.toHaveBeenCalled();
  });
});
