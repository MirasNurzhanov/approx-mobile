/* eslint-disable @typescript-eslint/no-require-imports -- Jest factories run before imports. */
// The map's module-level registries: another screen can ask the mounted map to
// refresh, or to drop a meetup, and nothing an unmounted map left behind answers.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useMapData, type MapData } from '../../hooks/useMapData';
import { fetchMapNearby } from '../discovery';
import { reportLocation } from '../location';
import type { ClubMeetup, MapNearbyResponse } from '../mapTypes';
import {
  registerMeetupRemove,
  registerNearbyRefresh,
  removeMeetupFromMap,
  triggerNearbyRefresh,
} from '../nearbyRefresh';

jest.mock('../privacy', () => ({ useGhostMode: () => false }));
jest.mock('../api', () => ({
  api: { get: jest.fn(() => Promise.resolve({ data: { id: 1, username: 'owner', friends: [], connections: [] } })) },
}));
jest.mock('../discovery', () => ({ fetchMapNearby: jest.fn(), isLocationNotAvailable: () => false }));
jest.mock('../location', () => ({ reportLocation: jest.fn(() => Promise.resolve()) }));
jest.mock('../stories', () => ({
  normalizeStories: (rows: unknown[]) => rows,
  placedStories: (rows: unknown[]) => rows,
  recordOwnStory: jest.fn(),
}));
jest.mock('expo-image', () => ({ Image: { prefetch: jest.fn() } }));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

const fetch = fetchMapNearby as jest.Mock;
const report = reportLocation as jest.Mock;
const coords = { current: { latitude: 10, longitude: 20 } };
const speed = { current: null };
const accuracy = { current: 12 };
const meetup: ClubMeetup = {
  id: 30, club: 4, club_name: 'Book club', created_by: { id: 2, username: 'friend' },
  title: 'Open meetup', latitude: 10, longitude: 20, event_datetime: '2099-01-01T00:00:00Z',
  status: 'approved', expires_at: '2099-01-02T00:00:00Z',
};
const payload = (): MapNearbyResponse => ({ users: [], stories: [], meetups: [meetup] });

const latest = new Map<string, MapData>();
function Harness({ name }: { name: string }) {
  // `false`: no position-driven interval, so every poll here is a trigger.
  latest.set(name, useMapData(coords, speed, false, accuracy));
  return null;
}

const mounted: ReactTestRenderer[] = [];
async function mount(name: string) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<Harness name={name} />); });
  mounted.push(tree);
  return tree;
}

beforeEach(() => {
  fetch.mockReset().mockResolvedValue(payload());
  report.mockClear();
  latest.clear();
});
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

describe('registry', () => {
  it('clears a callback when its own unregister runs, never a newer one', () => {
    const first = jest.fn();
    const second = jest.fn();
    const releaseFirst = registerNearbyRefresh(first);
    const releaseSecond = registerNearbyRefresh(second);
    releaseFirst(); // an old map's cleanup, arriving after the new one registered
    triggerNearbyRefresh();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    releaseSecond();
    triggerNearbyRefresh();
    expect(second).toHaveBeenCalledTimes(1);

    const removeFirst = jest.fn();
    const removeSecond = jest.fn();
    const releaseRemoveFirst = registerMeetupRemove(removeFirst);
    const releaseRemoveSecond = registerMeetupRemove(removeSecond);
    releaseRemoveFirst();
    removeMeetupFromMap(7);
    expect(removeFirst).not.toHaveBeenCalled();
    expect(removeSecond).toHaveBeenCalledWith(7);
    releaseRemoveSecond();
    removeMeetupFromMap(8);
    expect(removeSecond).toHaveBeenCalledTimes(1);
  });
});

describe('the map screen data hook', () => {
  it('answers triggers while mounted and makes no request or update once unmounted', async () => {
    const tree = await mount('map');
    const polls = fetch.mock.calls.length;
    await act(async () => { triggerNearbyRefresh(); });
    expect(fetch).toHaveBeenCalledTimes(polls + 1);
    expect(latest.get('map')!.clubMeetups.map((m) => m.id)).toEqual([meetup.id]);
    act(() => { removeMeetupFromMap(meetup.id); });
    expect(latest.get('map')!.clubMeetups).toEqual([]);

    act(() => tree.unmount());
    mounted.splice(mounted.indexOf(tree), 1);
    const fetches = fetch.mock.calls.length;
    const reports = report.mock.calls.length;
    await act(async () => {
      triggerNearbyRefresh();
      removeMeetupFromMap(meetup.id);
    });
    expect(fetch).toHaveBeenCalledTimes(fetches);
    expect(report).toHaveBeenCalledTimes(reports);
  });

  it('keeps the newer map registered when an older one unmounts after it', async () => {
    const older = await mount('older');
    await mount('newer');
    act(() => older.unmount());
    mounted.splice(mounted.indexOf(older), 1);

    const fetches = fetch.mock.calls.length;
    await act(async () => { triggerNearbyRefresh(); });
    expect(fetch).toHaveBeenCalledTimes(fetches + 1);
    expect(latest.get('newer')!.clubMeetups.map((m) => m.id)).toEqual([meetup.id]);
  });
});
