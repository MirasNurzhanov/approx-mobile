/**
 * The line between a story and a place.
 *
 * Stories and live location are separate: a story posted while sharing is
 * paused has no coordinate at all, and the server does not send one. So the
 * client has two normalisers and they must disagree in exactly one way — the
 * map drops what it cannot draw, and every other surface keeps it.
 *
 * A row lost here is a friend's story that never appears; a row kept in the
 * wrong place is a marker at 0,0 in the Gulf of Guinea.
 */
import {
  fetchFriendStories,
  groupStoriesByAuthor,
  normalizeStories,
  placedStories,
  type FeedStory,
} from '../stories';

jest.mock('../api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  BASE_URL: 'https://example.test',
}));

const { api } = jest.requireMock('../api');

const EMPTY_REACTIONS = { like: 0, funny: 0, helpful: 0, interesting: 0 };

function story(overrides: Partial<FeedStory> & { id: number }): FeedStory {
  return {
    author: { id: 1, username: 'friend' },
    content: 'hello',
    created_at: '2026-08-18T10:00:00Z',
    expires_at: '2026-08-19T10:00:00Z',
    reactions: { ...EMPTY_REACTIONS },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('normalizeStories', () => {
  it('keeps a story that has no position', () => {
    // The whole point: its author was paused when they posted it, and it is
    // still theirs to show their friends.
    const rows = normalizeStories([story({ id: 1 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].latitude).toBeNull();
  });

  it('coerces the strings DRF sends into numbers', () => {
    const rows = normalizeStories([
      story({ id: 1, latitude: '10.5' as any, longitude: '20.25' as any }),
    ]);
    expect(rows[0].latitude).toBe(10.5);
    expect(rows[0].longitude).toBe(20.25);
  });

  it('nulls a half-position rather than keeping the half that parsed', () => {
    const rows = normalizeStories([story({ id: 1, latitude: 10, longitude: null })]);
    expect(rows[0].latitude).toBeNull();
    expect(rows[0].longitude).toBeNull();
  });

  it('never mutates the row it was given', () => {
    const original = story({ id: 1, latitude: '10.5' as any });
    normalizeStories([original]);
    expect(original.latitude).toBe('10.5');
  });

  it('answers an empty list for anything that is not one', () => {
    expect(normalizeStories(null)).toEqual([]);
    expect(normalizeStories(undefined)).toEqual([]);
  });
});

describe('placedStories', () => {
  it('drops the stories the map cannot draw', () => {
    const rows = placedStories([
      story({ id: 1 }),
      story({ id: 2, latitude: 10, longitude: 20 }),
    ]);
    expect(rows.map((s) => s.id)).toEqual([2]);
  });

  it('drops a coordinate that is not on Earth', () => {
    expect(placedStories([story({ id: 1, latitude: 999, longitude: 20 })])).toEqual([]);
  });
});

describe('groupStoriesByAuthor', () => {
  const alex = { id: 7, username: 'alex' };
  const sam = { id: 9, username: 'sam' };

  it('keys the feed by author, newest first within each', () => {
    const grouped = groupStoriesByAuthor([
      story({ id: 1, author: alex, created_at: '2026-08-18T09:00:00Z' }),
      story({ id: 2, author: alex, created_at: '2026-08-18T11:00:00Z' }),
      story({ id: 3, author: sam, created_at: '2026-08-18T10:00:00Z' }),
    ]);
    expect(grouped.get(7)!.map((s) => s.id)).toEqual([2, 1]);
    expect(grouped.get(9)!.map((s) => s.id)).toEqual([3]);
  });

  it('orders authors by who posted most recently', () => {
    // The ring order in Chats, so the friend who just posted is not buried.
    const grouped = groupStoriesByAuthor([
      story({ id: 1, author: alex, created_at: '2026-08-18T09:00:00Z' }),
      story({ id: 2, author: sam, created_at: '2026-08-18T11:00:00Z' }),
    ]);
    expect([...grouped.keys()]).toEqual([9, 7]);
  });

  it('never mutates the feed it was handed', () => {
    const feed = [
      story({ id: 1, author: alex, created_at: '2026-08-18T09:00:00Z' }),
      story({ id: 2, author: alex, created_at: '2026-08-18T11:00:00Z' }),
    ];
    groupStoriesByAuthor(feed);
    expect(feed.map((s) => s.id)).toEqual([1, 2]);
  });

  it('is empty for an empty feed, so every avatar renders ringless', () => {
    expect(groupStoriesByAuthor([]).size).toBe(0);
  });
});

describe('fetchFriendStories', () => {
  it('asks the social feed, never the map one', () => {
    // The map feed needs a position on both ends and answers with pins; a ring
    // around a friend's face is not a question about where anybody is.
    api.get.mockResolvedValue({ data: { results: [] } });
    return fetchFriendStories().then(() => {
      expect(api.get).toHaveBeenCalledWith('/api/stories/friends/');
    });
  });

  it('keeps a friend story that carries no location', async () => {
    api.get.mockResolvedValue({ data: { results: [story({ id: 1 })] } });
    await expect(fetchFriendStories()).resolves.toHaveLength(1);
  });

  it('survives a response with no results at all', async () => {
    api.get.mockResolvedValue({ data: {} });
    await expect(fetchFriendStories()).resolves.toEqual([]);
  });
});
