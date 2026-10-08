import { AppState } from 'react-native';

import { api } from '../api';
import { getNavBadges, refreshNavBadges, resetNavBadges, subscribeNavBadges } from '../navBadges';

jest.mock('../api', () => ({ api: { get: jest.fn() } }));

const get = api.get as jest.Mock;
let cleanup: (() => void)[] = [];

function subscribe() {
  const stop = subscribeNavBadges(jest.fn());
  cleanup.push(stop);
  return stop;
}

function state(next: 'active' | 'background') {
  (AppState as { currentState: string }).currentState = next;
  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  calls[calls.length - 1][1](next);
}

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  (AppState as { currentState: string }).currentState = 'active';
  get.mockReset().mockResolvedValue({ data: { chat: 2, alerts: 3 } });
  resetNavBadges();
});

afterEach(() => {
  cleanup.forEach((stop) => stop());
  cleanup = [];
  resetNavBadges();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('shares one compact request and one timer across five mounted screens', async () => {
  for (let i = 0; i < 5; i++) subscribe();
  await settle();
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith('/api/notifications/badges/', expect.objectContaining({ timeout: 10_000 }));
  expect(getNavBadges()).toEqual({ chat: 2, alerts: 3 });
  jest.advanceTimersByTime(29_999);
  expect(get).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  await settle();
  expect(get).toHaveBeenCalledTimes(2);
});

it('stops in the background and refreshes once on foregrounding', async () => {
  subscribe();
  await settle();
  state('background');
  jest.advanceTimersByTime(300_000);
  await refreshNavBadges();
  expect(get).toHaveBeenCalledTimes(1);
  state('active');
  await settle();
  expect(get).toHaveBeenCalledTimes(2);
});

it('does not overlap requests even if a response is slower than the poll interval', async () => {
  let finish!: (value: unknown) => void;
  get.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  subscribe();
  jest.advanceTimersByTime(90_000);
  void refreshNavBadges();
  void refreshNavBadges();
  expect(get).toHaveBeenCalledTimes(1);
  finish({ data: { chat: 1, alerts: 1 } });
  await settle();
  expect(getNavBadges()).toEqual({ chat: 1, alerts: 1 });
});

it('discards an old account response after reset without clobbering the new request', async () => {
  let finishOld!: (value: unknown) => void;
  get.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
  subscribe();
  const signal = get.mock.calls[0][1].signal;
  resetNavBadges();
  expect(signal.aborted).toBe(true);
  await refreshNavBadges();
  finishOld({ data: { chat: 99, alerts: 99 } });
  await settle();
  expect(getNavBadges()).toEqual({ chat: 2, alerts: 3 });
});

it('preserves counts and backs off after failure or malformed data', async () => {
  subscribe();
  await settle();
  get.mockRejectedValueOnce(new Error('offline'));
  jest.advanceTimersByTime(30_000);
  await settle();
  expect(getNavBadges()).toEqual({ chat: 2, alerts: 3 });
  jest.advanceTimersByTime(59_999);
  expect(get).toHaveBeenCalledTimes(2);
  get.mockResolvedValueOnce({ data: { chat: -1, alerts: 'bad' } });
  jest.advanceTimersByTime(1);
  await settle();
  expect(getNavBadges()).toEqual({ chat: 2, alerts: 3 });
  jest.advanceTimersByTime(119_999);
  expect(get).toHaveBeenCalledTimes(3);
});

it('cancels work after the last subscriber leaves', async () => {
  const stop = subscribe();
  await settle();
  stop();
  jest.advanceTimersByTime(300_000);
  expect(get).toHaveBeenCalledTimes(1);
});
