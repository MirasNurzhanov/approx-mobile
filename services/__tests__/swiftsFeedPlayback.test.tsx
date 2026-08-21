// Playback discipline, preloading, and the optimistic engagement writes.
//
// The claims worth pinning here are the ones whose failure is loud and whose
// cause is hard to find from the symptom:
//
//   * two videos playing at once, which happens the moment more than one
//     component believes it owns playback,
//   * a feed that keeps talking while the app is in the background,
//   * a like count that drifts because a rollback did not put back what it took.

import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';

import { SwiftsFeed } from '../../components/swifts/SwiftsFeed';
import { AppThemeProvider } from '../../context/ThemeContext';
import { FEED_PAGE_SIZE, type Swift } from '../swifts';
import {
  PRELOAD_AHEAD, PRELOAD_BEHIND, isCardActive, shouldPreload,
} from '../../components/swifts/feedWindow';

const mockApi = {
  fetchSwiftFeed: jest.fn(),
  revealSwiftLocation: jest.fn(),
  recordSwiftView: jest.fn(),
  setSwiftLiked: jest.fn(),
  setSwiftReposted: jest.fn(),
};

jest.mock('../swifts', () => ({
  FEED_PAGE_SIZE: 10,
  COMMENT_PAGE_SIZE: 20,
  fetchSwiftFeed: (...a: unknown[]) => mockApi.fetchSwiftFeed(...a),
  revealSwiftLocation: (...a: unknown[]) => mockApi.revealSwiftLocation(...a),
  recordSwiftView: (...a: unknown[]) => mockApi.recordSwiftView(...a),
  setSwiftLiked: (...a: unknown[]) => mockApi.setSwiftLiked(...a),
  setSwiftReposted: (...a: unknown[]) => mockApi.setSwiftReposted(...a),
  fetchSwiftComments: jest.fn(() => Promise.resolve({ count: 0, results: [] })),
  postSwiftComment: jest.fn(),
  deleteSwiftComment: jest.fn(),
  SwiftLocationUnavailable: class extends Error {},
  formatCount: (n: number) => String(n),
}));

// Fire-and-forget analytics. Stubbed so these suites keep measuring
// playback and privacy rather than the reporting queue, which has its
// own tests.
jest.mock('../swiftSignals', () => ({
  reportSwiftSignal: jest.fn(),
  flushSwiftSignals: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    useFocusEffect: (cb: () => undefined | (() => void)) => React.useEffect(cb, [cb]),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../hooks/useNavMetrics', () => ({ useNavClearance: () => 0 }));

/** Every player the feed builds, so "is more than one playing" is answerable. */
const mockPlayers: { id: number; play: jest.Mock; pause: jest.Mock; source: unknown }[] = [];

jest.mock('expo-video', () => ({
  useVideoPlayer: (source: unknown) => {
    const React = require('react');
    // One player per card instance, matching the real hook's lifetime.
    const ref = React.useRef<any>(null);
    if (!ref.current) {
      ref.current = {
        id: mockPlayers.length,
        play: jest.fn(),
        pause: jest.fn(),
        source,
        currentTime: 0, duration: 10, volume: 1, muted: true,
        loop: false, status: 'readyToPlay', timeUpdateEventInterval: 0,
      };
      mockPlayers.push(ref.current);
    }
    ref.current.source = source;
    return ref.current;
  },
  VideoView: 'VideoView',
}));

jest.mock('expo', () => ({
  useEvent: (_p: unknown, name: string) =>
    name === 'statusChange'
      ? { status: 'readyToPlay', error: undefined }
      : { currentTime: 0 },
  useEventListener: jest.fn(),
}));

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-native-maps', () => ({
  __esModule: true, default: 'MapView', Marker: 'Marker', Circle: 'Circle',
  PROVIDER_GOOGLE: 'google',
}));
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View: (p: Record<string, unknown>) => React.createElement(View, p) },
    useSharedValue: () => ({ get: () => 0, set: () => {}, value: 0 }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: unknown) => v,
    withSequence: (...v: unknown[]) => v[0],
  };
});
jest.mock('../../hooks/useDoubleTap', () => ({ useDoubleTap: () => jest.fn() }));
jest.mock('../../hooks/useReduceMotion', () => ({ useReduceMotion: () => true }));

function makeSwift(id: number, overrides: Partial<Swift> = {}): Swift {
  return {
    id,
    author: { id: 100 + id, username: `creator${id}`, profile_picture: null },
    caption: `swift ${id}`,
    video_url: `https://cdn.example.com/v/${id}.mp4`,
    thumbnail_url: `https://cdn.example.com/v/${id}.jpg`,
    duration_ms: 15_000, width: 1080, height: 1920, aspect_ratio: 0.5625,
    status: 'ready',
    track: null, audio_title: '', audio_artist: '', uses_original_audio: true,
    visibility: 'public', allow_comments: true, allow_reposts: true,
    like_count: 10, comment_count: 2, repost_count: 1, view_count: 0,
    viewer_liked: false, viewer_reposted: false, viewer_viewed: false,
    location_available: false, is_mine: false,
    created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}

let mountedTree: ReactTestRenderer | null = null;

async function renderFeed() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <AppThemeProvider>
        <SwiftsFeed />
      </AppThemeProvider>,
    );
  });
  await act(async () => {
    tree.root.findAll((n) => typeof n.props?.onLayout === 'function')[0]
      ?.props.onLayout({ nativeEvent: { layout: { height: 800, width: 400 } } });
  });
  mountedTree = tree;
  return tree;
}

function listProps(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (n) => typeof n.props?.onViewableItemsChanged === 'function',
  )[0]?.props;
}

/** `memo()` wrappers are not matched by `findAllByType`, so the components are
 *  identified by their prop signature — which is stable and, unlike the type
 *  identity, survives the card being wrapped again later. */
function cards(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (n) => n.props?.swift !== undefined && n.props?.preload !== undefined,
  );
}

function rails(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (n) => n.props?.isLiked !== undefined && n.props?.onRepost !== undefined,
  );
}

/** The AppState listener the feed registered, invoked as the OS would. */
function appStateHandler() {
  const spy = AppState.addEventListener as unknown as jest.Mock;
  return spy.mock.calls.map(([, cb]) => cb).pop();
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({
    remove: jest.fn(),
  } as never);
  mockPlayers.length = 0;
  mockApi.recordSwiftView.mockResolvedValue(undefined);
  mockApi.setSwiftLiked.mockResolvedValue(11);
  mockApi.setSwiftReposted.mockResolvedValue(2);
  mockApi.fetchSwiftFeed.mockResolvedValue({
      cursor: null,
      hasMore: false,
      sources: {},
      results: Array.from({ length: FEED_PAGE_SIZE }, (_, i) => makeSwift(i + 1)),
  });
});

/** React Native 0.81's `VirtualizedList` schedules `_updateCellsToRender` on a
 *  `setTimeout`. Left mounted, that fires after the test has finished and logs
 *  an act() warning during teardown, which Jest reports as a failure in the
 *  suite that happens to run next. Unmounting ends the timer with the tree. */
afterEach(() => {
  act(() => {
    mountedTree?.unmount();
  });
  mountedTree = null;
});

describe('only one Swift plays at a time', () => {
  it('marks exactly one card active', async () => {
    const tree = await renderFeed();
    const active = cards(tree).filter((c) => c.props.isActive);
    expect(active).toHaveLength(1);
  });

  it('never marks two cards active at once', async () => {
    const tree = await renderFeed();
    await act(async () => {
      listProps(tree)?.onViewableItemsChanged({
        viewableItems: [{ index: 2, item: makeSwift(3), key: '3', isViewable: true }],
      });
    });

    expect(cards(tree).filter((c) => c.props.isActive).length).toBeLessThanOrEqual(1);
  });
});

describe('the feed goes quiet when it should', () => {
  it('deactivates every card when the app backgrounds', async () => {
    const tree = await renderFeed();
    expect(cards(tree).some((c) => c.props.isActive)).toBe(true);

    await act(async () => { appStateHandler()?.('background'); });

    expect(cards(tree).every((c) => !c.props.isActive)).toBe(true);
  });

  it('resumes when the app comes back', async () => {
    const tree = await renderFeed();
    const handler = appStateHandler();

    await act(async () => { handler?.('background'); });
    expect(cards(tree).every((c) => !c.props.isActive)).toBe(true);

    await act(async () => { handler?.('active'); });
    expect(cards(tree).filter((c) => c.props.isActive)).toHaveLength(1);
  });
});

describe('preloading is bounded', () => {
  // The window arithmetic, tested directly. Driving it through a rendered
  // FlatList would measure `initialNumToRender` — the list's virtualisation
  // rather than this decision — and pass regardless of what the window says.
  it('covers the active card and one either side', () => {
    expect(shouldPreload(4, 5)).toBe(true);
    expect(shouldPreload(5, 5)).toBe(true);
    expect(shouldPreload(6, 5)).toBe(true);
  });

  it('excludes everything further out', () => {
    expect(shouldPreload(3, 5)).toBe(false);
    expect(shouldPreload(7, 5)).toBe(false);
    expect(shouldPreload(40, 5)).toBe(false);
  });

  it('stays a three-card window wherever the viewport is', () => {
    for (const active of [0, 1, 9, 250]) {
      const inWindow = Array.from({ length: 400 }, (_, i) => i)
        .filter((i) => shouldPreload(i, active));
      expect(inWindow.length).toBeLessThanOrEqual(
        PRELOAD_BEHIND + 1 + PRELOAD_AHEAD,
      );
    }
  });

  it('holds the window at the very top of the feed', () => {
    // Index 0 active: nothing behind it exists, so the window is two.
    const inWindow = [0, 1, 2, 3].filter((i) => shouldPreload(i, 0));
    expect(inWindow).toEqual([0, 1]);
  });

  it('renders the mounted card with a source', async () => {
    const tree = await renderFeed();
    const mounted = cards(tree);
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted[0].props.preload).toBe(true);
  });
});

describe('activity is the conjunction of three things', () => {
  it('is true only for the viewport card, and only when playback is allowed', () => {
    expect(isCardActive(3, 3, true)).toBe(true);
    expect(isCardActive(3, 3, false)).toBe(false);
    expect(isCardActive(2, 3, true)).toBe(false);
  });

  it('is false for every index once playback is disallowed', () => {
    const anyActive = Array.from({ length: 50 }, (_, i) => i)
      .some((i) => isCardActive(i, 7, false));
    expect(anyActive).toBe(false);
  });

  it('is true for exactly one index when it is allowed', () => {
    const active = Array.from({ length: 50 }, (_, i) => i)
      .filter((i) => isCardActive(i, 7, true));
    expect(active).toEqual([7]);
  });
});

describe('likes are optimistic and roll back exactly', () => {
  const rail = (tree: ReactTestRenderer) => rails(tree)[0];

  it('moves the count under the thumb, then takes the server value', async () => {
    const tree = await renderFeed();
    expect(rail(tree).props.likeCount).toBe(10);

    await act(async () => { rail(tree).props.onLike(); });

    expect(rail(tree).props.isLiked).toBe(true);
    // 11 is what the mocked server returned.
    expect(rail(tree).props.likeCount).toBe(11);
  });

  it('puts back exactly what it took when the write fails', async () => {
    mockApi.setSwiftLiked.mockRejectedValue(new Error('offline'));
    const tree = await renderFeed();

    await act(async () => { rail(tree).props.onLike(); });

    expect(rail(tree).props.isLiked).toBe(false);
    expect(rail(tree).props.likeCount).toBe(10);
  });

  it('never lets a count go negative', async () => {
    mockApi.fetchSwiftFeed.mockResolvedValue({
      cursor: null,
      hasMore: false,
      sources: {},
      results: [makeSwift(1, { like_count: 0, viewer_liked: true })],
    });
    mockApi.setSwiftLiked.mockResolvedValue(0);
    const tree = await renderFeed();

    await act(async () => { rail(tree).props.onLike(); });

    expect(rail(tree).props.likeCount).toBeGreaterThanOrEqual(0);
  });
});

describe('reposts', () => {
  const rail = (tree: ReactTestRenderer) => rails(tree)[0];

  it('toggles optimistically and takes the server count', async () => {
    const tree = await renderFeed();
    await act(async () => { rail(tree).props.onRepost(); });

    expect(rail(tree).props.isReposted).toBe(true);
    expect(rail(tree).props.repostCount).toBe(2);
    expect(mockApi.setSwiftReposted).toHaveBeenCalledWith(1, true);
  });

  it('rolls back on failure', async () => {
    mockApi.setSwiftReposted.mockRejectedValue(new Error('offline'));
    const tree = await renderFeed();

    await act(async () => { rail(tree).props.onRepost(); });

    expect(rail(tree).props.isReposted).toBe(false);
    expect(rail(tree).props.repostCount).toBe(1);
  });

  it('presses twice without creating two reposts', async () => {
    // The server constraint is what actually guarantees this; the client's job
    // is not to *ask* twice for the same state.
    const tree = await renderFeed();
    await act(async () => { rail(tree).props.onRepost(); });
    await act(async () => { rail(tree).props.onRepost(); });

    expect(mockApi.setSwiftReposted).toHaveBeenNthCalledWith(1, 1, true);
    expect(mockApi.setSwiftReposted).toHaveBeenNthCalledWith(2, 1, false);
  });

  it('hides the control on your own Swift', async () => {
    mockApi.fetchSwiftFeed.mockResolvedValue({
      cursor: null,
      hasMore: false,
      sources: {},
      results: [makeSwift(1, { is_mine: true })],
    });
    const tree = await renderFeed();
    expect(rail(tree).props.allowReposts).toBe(false);
  });

  it('hides the control when the creator turned reposts off', async () => {
    mockApi.fetchSwiftFeed.mockResolvedValue({
      cursor: null,
      hasMore: false,
      sources: {},
      results: [makeSwift(1, { allow_reposts: false })],
    });
    const tree = await renderFeed();
    expect(rail(tree).props.allowReposts).toBe(false);
  });
});

describe('memoisation actually bails', () => {
  // `memo` is only worth its comparison if every prop is stable, and stability
  // is a property of the *caller*. A handler written inline in `renderItem` is
  // a new function on every render: the shallow compare fails every time, and
  // each mounted card rebuilds its video view and its whole SVG rail on every
  // scroll tick and every optimistic count change — while still looking
  // memoised from the outside, which is why it went unnoticed.
  //
  // What is asserted is React.memo's own bail condition, not a render count:
  // that the props of a card nothing happened to are shallow-equal across a
  // change to a different card.
  function shallowDiff(a: Record<string, unknown>, b: Record<string, unknown>) {
    return Array.from(new Set([...Object.keys(a), ...Object.keys(b)]))
      .filter((k) => !Object.is(a[k], b[k]));
  }

  it('leaves the card shallow-equal when the feed re-renders for something else', async () => {
    // Opening the comments sheet is feed state, and no part of it reaches a
    // card. Under the old inline handlers this still failed on five props.
    const tree = await renderFeed();
    const before = { ...cards(tree)[0].props };

    await act(async () => { rails(tree)[0].props.onComment(); });

    expect(shallowDiff(before, cards(tree)[0].props)).toEqual([]);
  });

  it('leaves the rail shallow-equal when the card re-renders for a pause', async () => {
    // The second memo in the chain, tested where it matters: `pausedByUser`
    // changes so the card *must* re-render, and nothing on the rail depends on
    // it, so the rail must not.
    const tree = await renderFeed();
    const before = { ...rails(tree)[0].props };

    await act(async () => { cards(tree)[0].props.onTogglePause(1); });

    expect(cards(tree)[0].props.pausedByUser).toBe(true);
    expect(shallowDiff(before, rails(tree)[0].props)).toEqual([]);
  });

  it('hands every card one and the same pause callback', async () => {
    // The specific regression: this used to close over the row, so it was a
    // distinct function per card per render.
    const tree = await renderFeed();
    const handlers = cards(tree).map((c) => c.props.onTogglePause);
    expect(new Set(handlers).size).toBe(1);

    await act(async () => { rails(tree)[0].props.onLike(); });
    expect(cards(tree)[0].props.onTogglePause).toBe(handlers[0]);
  });

  it('still lets the card that changed through', async () => {
    // The other half — a memo that never re-renders anything is just a bug in
    // the opposite direction.
    const tree = await renderFeed();
    const before = { ...cards(tree)[0].props };

    await act(async () => { rails(tree)[0].props.onLike(); });

    expect(shallowDiff(before, cards(tree)[0].props)).toContain('swift');
  });
});
