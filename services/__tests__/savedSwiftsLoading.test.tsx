/**
 * The gap between "this list was switched on" and "the request has started".
 *
 * `useFocusEffect` runs after the commit, so there is always one committed
 * render where the hook is enabled, no request is in flight and `items` is
 * empty. Any screen that keys its empty state off `items.length === 0` — which
 * the profile's Swifts section does — renders "Nothing saved yet" in that
 * frame, to somebody who has saved plenty.
 *
 * `useState(enabled)` does not cover it. That is what `useCreatorSwifts` uses,
 * and it works there because that hook is enabled from mount; this one is
 * switched on later by a tab, and a `useState` initialiser only runs once.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useSavedSwifts } from '@/components/profile/useSavedSwifts';

const mockFetch = jest.fn();
/** Runs the focus callback the way expo-router would: after the commit. */
const mockFocusEffect = jest.fn();

jest.mock('@/services/swifts', () => ({
  fetchSavedSwifts: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => mockFocusEffect(cb),
}));

type Snapshot = ReturnType<typeof useSavedSwifts>;

/** Every render's value, so a one-frame flash is visible rather than averaged
 *  away by only inspecting the final state. */
let frames: Snapshot[] = [];

function Probe({ enabled }: { enabled: boolean }) {
  frames.push(useSavedSwifts(enabled, 6));
  return null;
}

beforeEach(() => {
  frames = [];
  mockFetch.mockReset();
  // Default: never settles, so "before the response" is the state under test.
  mockFetch.mockReturnValue(new Promise(() => {}));
  mockFocusEffect.mockReset();
});

describe('the empty state cannot flash before the first request', () => {
  it('reports loading on the very first enabled render', () => {
    act(() => { create(<Probe enabled />); });
    // Frame 0 is committed before any focus effect has run.
    expect(frames[0].loading).toBe(true);
    expect(frames[0].items).toHaveLength(0);
  });

  it('reports loading on the render where a tab switches it on', () => {
    // The real path: mounted disabled behind the Mine tab, enabled later.
    let tree: ReactTestRenderer;
    act(() => { tree = create(<Probe enabled={false} />); });
    expect(frames.at(-1)?.loading).toBe(false);

    act(() => { tree!.update(<Probe enabled />); });
    // This is the frame `useState(enabled)` would have got wrong.
    expect(frames.at(-1)?.loading).toBe(true);
  });

  it('never reports "not loading with nothing to show" while enabled', () => {
    let tree: ReactTestRenderer;
    act(() => { tree = create(<Probe enabled={false} />); });
    act(() => { tree!.update(<Probe enabled />); });

    const flashed = frames.some((f, i) => i > 0 && f.loading === false && f.items.length === 0
      && f.error === null);
    expect(flashed).toBe(false);
  });

  it('stays quiet while disabled, so the Mine tab pays nothing', () => {
    act(() => { create(<Probe enabled={false} />); });
    expect(frames[0].loading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('an empty shortlist is still allowed to be empty', () => {
  it('stops loading once the response says there is nothing', async () => {
    mockFetch.mockResolvedValue({ count: 0, results: [] });
    act(() => { create(<Probe enabled />); });

    // Run the focus callback, as expo-router would after the commit.
    await act(async () => { mockFocusEffect.mock.calls.at(-1)[0](); });

    expect(frames.at(-1)?.loading).toBe(false);
    expect(frames.at(-1)?.items).toHaveLength(0);
  });

  it('stops loading after a failure too, rather than spinning forever', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    act(() => { create(<Probe enabled />); });
    await act(async () => { mockFocusEffect.mock.calls.at(-1)[0](); });

    expect(frames.at(-1)?.loading).toBe(false);
    expect(frames.at(-1)?.error).toBeTruthy();
  });
});

describe('request completion guards', () => {
  function latest() {
    const frame = frames.at(-1);
    if (!frame) throw new Error('Expected a mounted hook');
    return frame;
  }
  it('clears pagination loading after rejection and allows retry', async () => {
    mockFetch.mockResolvedValueOnce({ count: 2, results: [{ id: 1 }] });
    let tree!: ReactTestRenderer;
    act(() => { tree = create(<Probe enabled />); });
    await act(async () => { mockFocusEffect.mock.calls.at(-1)[0](); });
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await latest().loadMore(); });
    expect(frames.at(-1)?.loadingMore).toBe(false);
    expect(frames.at(-1)?.error).toBe('Could not load more saved Swifts. Try again.');
    mockFetch.mockResolvedValueOnce({ count: 2, results: [{ id: 2 }] });
    await act(async () => { await latest().loadMore(); });
    expect(frames.at(-1)?.items.map(item => item.id)).toEqual([1, 2]);
    expect(frames.at(-1)?.loadingMore).toBe(false);
    act(() => tree.unmount());
  });

  it('does not let an older request clear a newer refresh loading flag', async () => {
    let rejectOld!: (error: Error) => void;
    let resolveNew!: (page: { count: number; results: never[] }) => void;
    mockFetch.mockReturnValueOnce(new Promise((_, reject) => { rejectOld = reject; }));
    mockFetch.mockReturnValueOnce(new Promise((resolve) => { resolveNew = resolve; }));
    let tree!: ReactTestRenderer;
    act(() => { tree = create(<Probe enabled />); });
    act(() => { mockFocusEffect.mock.calls.at(-1)[0](); });
    let refresh!: Promise<void>;
    act(() => { refresh = latest().refresh(); });
    await act(async () => { rejectOld(new Error('older request failed')); });
    expect(frames.at(-1)?.loading).toBe(true);
    expect(frames.at(-1)?.error).toBeNull();
    await act(async () => { resolveNew({ count: 0, results: [] }); await refresh; });
    expect(frames.at(-1)?.loading).toBe(false);
    act(() => tree.unmount());
  });
});
