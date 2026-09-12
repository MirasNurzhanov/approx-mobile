/* eslint-disable @typescript-eslint/no-require-imports -- Jest factories run before imports. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useMapData, type MapData } from '../../hooks/useMapData';
import { useMapSheets } from '../../hooks/useMapSheets';
import { api } from '../api';
import { fetchMapNearby } from '../discovery';
import type { ClubMeetup, MapNearbyResponse, NearbyUser } from '../mapTypes';
import type { Story } from '../stories';

let mockGhost: boolean | null = false;
let mockRefresh: () => Promise<void>;
jest.mock('../privacy', () => ({ useGhostMode: () => mockGhost }));
jest.mock('../api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../discovery', () => ({ fetchMapNearby: jest.fn(), isLocationNotAvailable: () => false }));
jest.mock('../location', () => ({ reportLocation: jest.fn(() => Promise.resolve()) }));
jest.mock('../nearbyRefresh', () => ({
  registerNearbyRefresh: (callback: () => Promise<void>) => { mockRefresh = callback; },
  registerMeetupRemove: jest.fn(),
}));
jest.mock('../stories', () => ({
  normalizeStories: (rows: Story[]) => rows,
  placedStories: (rows: Story[]) => rows,
  recordOwnStory: jest.fn(),
}));
jest.mock('expo-image', () => ({ Image: { prefetch: jest.fn() } }));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (initial: number) => {
    const React = require('react') as typeof import('react');
    const value = React.useRef(initial);
    return React.useMemo(() => ({
      get: () => value.current,
      set: (next: number) => { value.current = next; },
    }), []);
  },
  withSpring: (value: number, _config: unknown, complete?: (done: boolean) => void) => {
    complete?.(true);
    return value;
  },
}));
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (callback: (value: null) => void, value: null) => callback(value),
}));

const fetch = fetchMapNearby as jest.Mock;
const get = api.get as jest.Mock;
const coords = { current: { latitude: 10, longitude: 20 } };
const speed = { current: null };
const person: NearbyUser = {
  id: 2, username: 'friend', latitude: 10.0001, longitude: 20.0001, relationship: 'friend',
};
const ownStory: Story = {
  id: 10, author: { id: 1, username: 'owner' }, latitude: 10, longitude: 20,
  created_at: '2026-09-10T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', reactions: { like: 0 },
};
const otherStory: Story = { ...ownStory, id: 20, author: { id: 2, username: 'friend' } };
const meetup: ClubMeetup = {
  id: 30, club: 4, club_name: 'Book club', created_by: { id: 2, username: 'friend' },
  title: 'Open meetup', latitude: 10, longitude: 20, event_datetime: '2099-01-01T00:00:00Z',
  status: 'approved', expires_at: '2099-01-02T00:00:00Z',
};
function payload(): MapNearbyResponse {
  return { users: [person], stories: [ownStory, otherStory], meetups: [meetup] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

let latest: MapData;
let sheets: ReturnType<typeof useMapSheets>;
let tree: ReactTestRenderer | undefined;
function Harness() {
  latest = useMapData(coords, speed, false);
  sheets = useMapSheets(latest.nearby, latest.stories, []);
  return null;
}
async function render() {
  await act(async () => { tree = create(<Harness />); });
}
async function ghost(value: boolean | null) {
  mockGhost = value;
  await act(async () => { tree!.update(<Harness />); });
}
async function refresh() {
  await act(async () => { await mockRefresh(); });
}
beforeEach(() => {
  mockGhost = false;
  fetch.mockReset().mockResolvedValue(payload());
  get.mockReset().mockImplementation((url: string) => Promise.resolve({
    data: url === '/api/friends/list/'
      ? { friends: [{ id: 2 }], connections: [] }
      : { id: 1, username: 'owner' },
  }));
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
});

it.each([true, null])('immediately hides cached people and their open sheet when Ghost Mode is %s', async (hidden) => {
  await render();
  await refresh();
  act(() => { sheets.openSheet(person); });
  expect(latest.nearby).toEqual([person]);
  expect(sheets.selectedUser?.id).toBe(2);
  const calls = fetch.mock.calls.length;
  await ghost(hidden);
  // No follow-up response was needed to retract these rows. Own places and
  // club events still work while reciprocal people visibility is disabled.
  expect(fetch).toHaveBeenCalledTimes(calls);
  expect(latest.nearby).toEqual([]);
  expect(latest.stories.map(story => story.id)).toEqual([ownStory.id]);
  expect(latest.clubMeetups).toEqual([meetup]);
  expect(sheets.selectedUser).toBeNull();
  expect(sheets.sheetUser).toBeNull();
  await ghost(false);
  expect(latest.nearby).toEqual([]);
  await refresh();
  expect(latest.nearby).toEqual([person]);
  expect(sheets.selectedUser).toBeNull();
});

it('clears an open friend story on ghosting while allowing the owner story and club sheet', async () => {
  await render();
  await refresh();
  act(() => { sheets.openStoryViewer([otherStory]); });
  expect(sheets.storyViewer?.stories[0].id).toBe(otherStory.id);
  await ghost(true);
  expect(sheets.storyViewer).toBeNull();
  act(() => { sheets.openStoryViewer([ownStory]); });
  expect(sheets.storyViewer?.stories[0].id).toBe(ownStory.id);
  act(() => { sheets.openMeetupSheet(meetup); });
  expect(sheets.selectedMeetup).toEqual(meetup);
});

it('ignores a response started before ghosting even after visibility has been reenabled', async () => {
  const old = deferred<MapNearbyResponse>();
  const current = deferred<MapNearbyResponse>();
  fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  await render();
  let oldRequest!: Promise<void>;
  act(() => { oldRequest = mockRefresh(); });
  await ghost(true);
  await ghost(false);
  let currentRequest!: Promise<void>;
  act(() => { currentRequest = mockRefresh(); });
  const updated: NearbyUser = { ...person, username: 'Current permitted profile' };
  await act(async () => {
    current.resolve({ ...payload(), users: [updated] });
    await currentRequest;
  });
  await act(async () => { old.resolve(payload()); await oldRequest; });
  expect(latest.nearby).toEqual([updated]);
});

it('drops removed people and stories from open sheets and does not reopen them on a later poll', async () => {
  await render();
  await refresh();
  act(() => { sheets.openSheet(person); });
  fetch.mockResolvedValueOnce({ users: [], stories: [ownStory], meetups: [meetup] });
  await refresh();
  expect(sheets.selectedUser).toBeNull();
  expect(sheets.sheetUser).toBeNull();
  await refresh();
  act(() => { sheets.openStoryViewer([otherStory]); });
  fetch.mockResolvedValueOnce({ users: [], stories: [ownStory], meetups: [meetup] });
  await refresh();
  expect(sheets.storyViewer).toBeNull();
  await refresh();
  expect(sheets.storyViewer).toBeNull();
});
