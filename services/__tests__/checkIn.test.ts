import { AppState } from 'react-native';

const mockPost = jest.fn();
jest.mock('../api', () => ({ api: { post: (...args: unknown[]) => mockPost(...args) } }));

afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

const soon = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

function load() {
  let mod!: typeof import('../checkIn');
  jest.isolateModules(() => { mod = require('../checkIn'); }); // eslint-disable-line @typescript-eslint/no-require-imports
  return mod;
}

beforeEach(() => {
  // The expiry timer is real in the module; fake timers keep it from holding
  // the test process open for an hour.
  jest.useFakeTimers({ doNotFake: ['Date'] });
  mockPost.mockReset();
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
});

it('holds only the token its own tap minted, and presents it at startup', async () => {
  const m = load();
  mockPost.mockResolvedValueOnce({ data: { checked_in: true, check_in_expires_at: soon(), session: 'tok-1' } });
  await m.checkIn();
  expect(m.currentCheckInSession()).toBe('tok-1');
  mockPost.mockResolvedValueOnce({ data: { checked_in: true, check_in_expires_at: soon() } });
  await m.endStaleCheckIn();
  expect(mockPost).toHaveBeenLastCalledWith('/api/proximity/check-in/end-stale/', { session: 'tok-1' });
});

it('a fresh launch presents nothing, so the previous check-in ends', async () => {
  const m = load();
  mockPost.mockResolvedValueOnce({ data: { checked_in: false } });
  await m.endStaleCheckIn();
  expect(mockPost).toHaveBeenCalledWith('/api/proximity/check-in/end-stale/', { session: null });
});

it('reports once per process, and never from a background launch', async () => {
  const m = load();
  Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
  await m.endStaleCheckIn();
  expect(mockPost).not.toHaveBeenCalled();
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  mockPost.mockResolvedValue({ data: { checked_in: false } });
  await m.endStaleCheckIn();
  await m.endStaleCheckIn();
  expect(mockPost).toHaveBeenCalledTimes(1);
});

it('retries on the next launch rather than a timer when the startup call fails', async () => {
  const m = load();
  mockPost.mockRejectedValueOnce(new Error('offline'));
  await m.endStaleCheckIn();
  mockPost.mockResolvedValueOnce({ data: { checked_in: false } });
  await m.endStaleCheckIn();
  expect(mockPost).toHaveBeenCalledTimes(2);
});

it('drops the token and state on check-out, on the server ending it, and on sign-out', async () => {
  const m = load();
  mockPost.mockResolvedValue({ data: { checked_in: true, check_in_expires_at: soon(), session: 'tok' } });
  await m.checkIn();
  mockPost.mockResolvedValueOnce({ data: { checked_in: false } });
  await m.checkOut();
  expect(m.currentCheckInSession()).toBeNull();

  await m.checkIn();
  m.markCheckedOut();
  expect(m.currentCheckInSession()).toBeNull();

  await m.checkIn();
  m.forgetCheckIn();
  expect(m.currentCheckInSession()).toBeNull();
});

it('treats an already-expired check-in as checked out', async () => {
  const m = load();
  mockPost.mockResolvedValueOnce({
    data: { checked_in: true, check_in_expires_at: new Date(Date.now() - 1000).toISOString(), session: 'old' },
  });
  const state = await m.checkIn();
  expect(state.checkedIn).toBe(false);
  expect(m.currentCheckInSession()).toBeNull();
});
