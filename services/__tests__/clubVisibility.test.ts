// What the app does with a club's scope and with the user's own place.
//
// Deliberately *not* a copy of the visibility rule. The rule lives on the
// server and only on the server — a second implementation here would be a
// second thing to keep in step, and the moment they disagreed the client's
// answer would be the wrong one. What is tested here is the part that is
// genuinely the app's job: labelling a scope, offering the levels the server
// says are available, and having somewhere to stand when the lookup fails.

import {
  fetchMyLocation,
  levelLabel,
  UNPLACED,
  visibilityLabel,
  type Club,
  type MyClubLocation,
} from '../clubs';
import { api } from '../api';

jest.mock('../api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockGet = api.get as jest.Mock;
const mockPost = api.post as jest.Mock;

const ALMATY: MyClubLocation = {
  resolved: true,
  location_status: 'ok',
  detail: '',
  city: { id: 1, name: 'Almaty' },
  region: { id: 2, name: 'Bostandyk' },
  district: { id: 3, name: 'Orbita' },
  country_code: 'kz',
  available_levels: ['district', 'region', 'city'],
};

function club(overrides: Partial<Club>): Club {
  return {
    id: 1,
    name: 'Orbita Runners',
    member_count: 3,
    ...overrides,
  };
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

// ─── Labels ───────────────────────────────────────────────────────────────────
describe('levelLabel', () => {
  it('names the place, not the level', () => {
    expect(levelLabel('district', ALMATY)).toBe('Orbita district');
    expect(levelLabel('region', ALMATY)).toBe('Bostandyk region');
    expect(levelLabel('city', ALMATY)).toBe('Almaty city');
  });

  it('falls back to the bare level when the tier has no name', () => {
    // Reachable when a boundary is held but unnamed. Better a plain word than
    // "undefined district" in a radio button.
    expect(levelLabel('district', { ...ALMATY, district: null })).toBe('district');
  });
});

describe('visibilityLabel', () => {
  it('is the place a club is scoped to', () => {
    expect(
      visibilityLabel(
        club({
          visibility_level: 'district',
          visibility: {
            level: 'district',
            place_name: 'Orbita',
            city: { id: 1, name: 'Almaty' },
            region: { id: 2, name: 'Bostandyk' },
            district: { id: 3, name: 'Orbita' },
            country_code: 'kz',
          },
        }),
      ),
    ).toBe('Orbita');
  });

  it('is empty for a club that belongs nowhere in particular', () => {
    // The legacy set. A badge reading "global" on a club nobody scoped would
    // be inventing a decision its owner never made.
    expect(
      visibilityLabel(
        club({
          visibility_level: 'global',
          visibility: {
            level: 'global',
            place_name: '',
            city: null,
            region: null,
            district: null,
            country_code: '',
          },
        }),
      ),
    ).toBe('');
  });

  it('is empty for a club from an older response with no visibility at all', () => {
    expect(visibilityLabel(club({}))).toBe('');
  });
});

// ─── The user's place ─────────────────────────────────────────────────────────
describe('fetchMyLocation', () => {
  it('reads the cheap endpoint by default', async () => {
    mockGet.mockResolvedValue({ data: ALMATY });

    const place = await fetchMyLocation();

    expect(mockGet).toHaveBeenCalledWith('/api/clubs/my-location/');
    expect(mockPost).not.toHaveBeenCalled();
    expect(place.city?.name).toBe('Almaty');
    expect(place.available_levels).toEqual(['district', 'region', 'city']);
  });

  it('posts when asked to resolve properly', async () => {
    mockPost.mockResolvedValue({ data: ALMATY });

    await fetchMyLocation(true);

    expect(mockPost).toHaveBeenCalledWith('/api/clubs/my-location/');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('carries the server’s own words for why it could not place us', async () => {
    mockGet.mockResolvedValue({
      data: {
        ...UNPLACED,
        location_status: 'stale_location',
        detail: 'Open the map for a moment so it can catch up.',
      },
    });

    const place = await fetchMyLocation();

    expect(place.resolved).toBe(false);
    expect(place.location_status).toBe('stale_location');
    expect(place.detail).toContain('catch up');
    // Nothing is offerable, which is what stops the create screen submitting.
    expect(place.available_levels).toEqual([]);
  });

  it('never throws — a failed lookup is the unplaced state', async () => {
    mockGet.mockRejectedValue(
      Object.assign(new Error('offline'), { response: { status: 503, data: {} } }),
    );

    const place = await fetchMyLocation();

    expect(place.resolved).toBe(false);
    expect(place.available_levels).toEqual([]);
    expect(place.detail).toBeTruthy();
  });
});
