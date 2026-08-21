// The signal queue.
//
// Two properties are worth pinning and one of them is a privacy guarantee:
//
//   * batching actually batches, because a request per swipe is the failure
//     this module exists to prevent, and it would be invisible in testing on a
//     fast connection;
//   * nothing that leaves this file can carry a coordinate.
//
// The lossy-on-failure behaviour is tested too, because "drop it" looks like a
// bug to the next reader and is deliberate.

import {
  __pendingSignalCount,
  __resetSignalQueue,
  flushSwiftSignals,
  reportSwiftSignal,
} from '../swiftSignals';

const mockPost = jest.fn();
jest.mock('../api', () => ({ api: { post: (...a: unknown[]) => mockPost(...a) } }));

beforeEach(() => {
  jest.useFakeTimers();
  __resetSignalQueue();
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: { recorded: 1, skipped: 0 } });
});

afterEach(() => {
  __resetSignalQueue();
  jest.useRealTimers();
});

function sent() {
  return mockPost.mock.calls.map(([, body]) => body.signals).flat();
}

describe('batching', () => {
  it('does not send on every signal', () => {
    reportSwiftSignal({ kind: 'watch', swift_id: 1, completion_pct: 40 });
    reportSwiftSignal({ kind: 'watch', swift_id: 2, completion_pct: 10 });

    expect(mockPost).not.toHaveBeenCalled();
    expect(__pendingSignalCount()).toBe(2);
  });

  it('sends one request for a burst of scrolling', async () => {
    for (let i = 0; i < 8; i += 1) {
      reportSwiftSignal({ kind: 'watch', swift_id: i, completion_pct: 5 });
    }
    await flushSwiftSignals();

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(8);
  });

  it('flushes on the timer without being asked', async () => {
    reportSwiftSignal({ kind: 'like', swift_id: 1 });
    expect(mockPost).not.toHaveBeenCalled();

    await jest.runOnlyPendingTimersAsync();

    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('sends immediately once a batch is full', async () => {
    for (let i = 0; i < 50; i += 1) {
      reportSwiftSignal({ kind: 'skip', swift_id: i });
    }
    await Promise.resolve();

    expect(mockPost).toHaveBeenCalledTimes(1);
    // The server rejects an oversized batch outright rather than truncating,
    // so the client must never build one.
    expect(sent().length).toBeLessThanOrEqual(50);
  });

  it('does nothing when there is nothing queued', async () => {
    await flushSwiftSignals();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('failure handling', () => {
  it('drops a failed batch rather than retrying forever', async () => {
    mockPost.mockRejectedValueOnce(new Error('offline'));
    reportSwiftSignal({ kind: 'like', swift_id: 1 });

    await flushSwiftSignals();
    expect(mockPost).toHaveBeenCalledTimes(1);

    // Nothing held over: the next flush has nothing to send.
    await flushSwiftSignals();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('never throws at the caller', async () => {
    mockPost.mockRejectedValue(new Error('offline'));
    reportSwiftSignal({ kind: 'like', swift_id: 1 });

    await expect(flushSwiftSignals()).resolves.toBeUndefined();
  });

  it('keeps signals that arrived during a failed request', async () => {
    let release: (v?: unknown) => void = () => {};
    mockPost.mockImplementationOnce(
      () => new Promise((_, reject) => { release = () => reject(new Error('nope')); }),
    );

    reportSwiftSignal({ kind: 'like', swift_id: 1 });
    const pending = flushSwiftSignals();
    reportSwiftSignal({ kind: 'like', swift_id: 2 });

    release();
    await pending;

    // The in-flight batch is gone; the one that arrived after it is not.
    expect(__pendingSignalCount()).toBe(1);
  });
});

describe('what leaves the device', () => {
  it('sends only the declared fields', async () => {
    reportSwiftSignal({
      kind: 'watch',
      swift_id: 7,
      watch_ms: 4200,
      completion_pct: 65,
      served_by: 'trending',
      position: 3,
    });
    await flushSwiftSignals();

    expect(sent()[0]).toEqual({
      kind: 'watch',
      swift_id: 7,
      watch_ms: 4200,
      completion_pct: 65,
      served_by: 'trending',
      position: 3,
    });
  });

  it('carries no coordinate on a location reveal', async () => {
    reportSwiftSignal({ kind: 'location_reveal', swift_id: 7, served_by: 'friends' });
    await flushSwiftSignals();

    const body = JSON.stringify(mockPost.mock.calls[0][1]).toLowerCase();
    for (const forbidden of ['latitude', 'longitude', 'lat', 'lng', 'coord', 'geo']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('carries no free text anywhere', async () => {
    // Ids, an enum and two numbers. A caption or a username reaching an
    // analytics endpoint is a content archive nobody asked for.
    reportSwiftSignal({ kind: 'like', swift_id: 7, served_by: 'affinity' });
    await flushSwiftSignals();

    const [signal] = sent();
    for (const [key, value] of Object.entries(signal)) {
      if (typeof value !== 'string') continue;
      expect(['kind', 'served_by']).toContain(key);
    }
  });
});
