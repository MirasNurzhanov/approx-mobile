// Where a Swift was made must not reach the client until somebody asks.
//
// The server half of this is `swifts/test_location_privacy.py`, which proves
// no feed or detail payload can carry a coordinate. This file proves the other
// half, which is about *timing* rather than authorisation: even with a server
// that would answer, the app must not ask — not on mount, not on scroll, not
// while paging the next Swifts in.
//
// The interesting assertion is the negative one. `revealSwiftLocation` is
// mocked and the test drives a real `SwiftsFeed` through loading, a viewability
// change and a page-ahead, then asserts the mock was never called. A future
// change that "helpfully" warms the location for the next card fails here.

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SwiftsFeed } from '../../components/swifts/SwiftsFeed';
import { SwiftLocationButton } from '../../components/swifts/SwiftLocationButton';
import { AppThemeProvider } from '../../context/ThemeContext';
import { FEED_PAGE_SIZE, type Swift, type SwiftLocation } from '../swifts';

// ── The module under observation ─────────────────────────────────────────────
const mockApi = {
  fetchSwiftFeed: jest.fn(),
  revealSwiftLocation: jest.fn(),
  recordSwiftView: jest.fn(),
  setSwiftLiked: jest.fn(),
};

jest.mock('../swifts', () => ({
  FEED_PAGE_SIZE: 10,
  fetchSwiftFeed: (...a: unknown[]) => mockApi.fetchSwiftFeed(...a),
  revealSwiftLocation: (...a: unknown[]) => mockApi.revealSwiftLocation(...a),
  recordSwiftView: (...a: unknown[]) => mockApi.recordSwiftView(...a),
  setSwiftLiked: (...a: unknown[]) => mockApi.setSwiftLiked(...a),
  SwiftLocationUnavailable: class extends Error {
    kind: string;
    constructor(kind: string, message: string) {
      super(message);
      this.kind = kind;
    }
  },
  formatCount: (n: number) => String(n),
}));

// ── Native surfaces the feed pulls in ────────────────────────────────────────
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
    // The real hook runs the callback on focus and its return value on blur.
    // Under the renderer there is no navigator, so "always focused" is the
    // honest stand-in — `swiftsFeedPlayback.test.tsx` drives the blur path by
    // exercising AppState instead.
    useFocusEffect: (cb: () => undefined | (() => void)) => React.useEffect(cb, [cb]),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../hooks/useNavMetrics', () => ({ useNavClearance: () => 0 }));

jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({
    play: jest.fn(), pause: jest.fn(),
    currentTime: 0, duration: 10, volume: 1, muted: true, loop: false,
    timeUpdateEventInterval: 0,
  }),
  VideoView: 'VideoView',
}));

jest.mock('expo', () => ({
  useEvent: () => ({ currentTime: 0 }),
  useEventListener: jest.fn(),
}));

jest.mock('expo-image', () => ({ Image: 'Image' }));

// Reanimated pulls in the worklets runtime, which has no JS implementation
// under Jest. Only the four helpers the card's heart burst uses are needed.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      View: (p: Record<string, unknown>) => React.createElement(View, p),
      // `react-native-gesture-handler` calls this at *import* time, from
      // `GestureDetector/Wrap`, to build its own animated wrapper. Anything in
      // this tree that reaches a `GestureDetector` — ContentActions pulls in
      // ReportSheet, which drags to dismiss — therefore fails to load without
      // it, with a `createAnimatedComponent is not a function` that names
      // neither file. Kept on the mock rather than dropping the reanimated
      // mock entirely, which is what the suite relies on to render animated
      // views as plain ones.
      createAnimatedComponent: (C: unknown) => C,
    },
    createAnimatedComponent: (C: unknown) => C,
    useSharedValue: () => ({ get: () => 0, set: () => {}, value: 0 }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    withSequence: (...v: unknown[]) => v[0],
  };
});

jest.mock('react-native-maps', () => ({
  __esModule: true,
  default: 'MapView',
  Marker: 'Marker',
  Circle: 'Circle',
  PROVIDER_GOOGLE: 'google',
}));

jest.mock('../../hooks/useDoubleTap', () => ({ useDoubleTap: () => jest.fn() }));
jest.mock('../../hooks/useReduceMotion', () => ({ useReduceMotion: () => true }));

// ── Fixtures ─────────────────────────────────────────────────────────────────
function makeSwift(id: number, overrides: Partial<Swift> = {}): Swift {
  return {
    id,
    author: { id: 100 + id, username: `creator${id}`, profile_picture: null },
    caption: `swift ${id}`,
    video_url: `https://cdn.example.com/v/${id}.mp4`,
    thumbnail_url: `https://cdn.example.com/v/${id}.jpg`,
    duration_ms: 15_000,
    width: 1080,
    height: 1920,
    aspect_ratio: 0.5625,
    status: 'ready',
    review_state: 'published',
    trim_start_ms: 0,
    trim_end_ms: null,
    original_volume: 100,
    overlay_text: '',
    overlay_position: 'middle',
    track: null,
    audio_title: '',
    audio_artist: '',
    uses_original_audio: true,
    visibility: 'public',
    allow_comments: true,
    allow_reposts: true,
    like_count: 0,
    comment_count: 0,
    repost_count: 0,
    view_count: 0,
    viewer_liked: false,
    viewer_reposted: false,
    viewer_viewed: false,
    location_available: true,
    is_mine: false,
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}

const LOCATION: SwiftLocation = {
  latitude: 43.234512,
  longitude: 76.956231,
  place_name: 'Kok-Tobe Park',
  captured_at: '2026-08-01T10:00:00Z',
  precision: 'exact',
};

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
  // Give the feed a height, or the list never mounts its rows.
  await act(async () => {
    const root = tree.root.findAll(
      (n) => typeof n.props?.onLayout === 'function',
    )[0];
    root?.props.onLayout({ nativeEvent: { layout: { height: 800, width: 400 } } });
  });
  mountedTree = tree;
  return tree;
}

function listProps(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (n) => typeof n.props?.onViewableItemsChanged === 'function',
  )[0]?.props;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.recordSwiftView.mockResolvedValue(undefined);
  mockApi.setSwiftLiked.mockResolvedValue(0);
  mockApi.revealSwiftLocation.mockResolvedValue(LOCATION);
  mockApi.fetchSwiftFeed.mockResolvedValue({
      cursor: null,
      hasMore: false,
      sources: {},
      results: [makeSwift(1), makeSwift(2), makeSwift(3)],
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

describe('the feed never fetches a location on its own', () => {
  it('asks for no location while loading', async () => {
    await renderFeed();
    expect(mockApi.fetchSwiftFeed).toHaveBeenCalled();
    expect(mockApi.revealSwiftLocation).not.toHaveBeenCalled();
  });

  it('asks for no location when a card becomes active', async () => {
    const tree = await renderFeed();
    await act(async () => {
      listProps(tree)?.onViewableItemsChanged({
        viewableItems: [{ index: 0, item: makeSwift(1), key: '1', isViewable: true }],
      });
    });
    expect(mockApi.revealSwiftLocation).not.toHaveBeenCalled();
  });

  it('asks for no location when the next page is preloaded', async () => {
    // The assertion the whole design turns on: paging ahead brings feed rows,
    // and feed rows have no coordinate fields at all.
    //
    // A *full* first page, deliberately: a short page means the feed has
    // reached the end and `loadMore` correctly declines to ask again, which
    // would make this pass without ever exercising the pager.
    const fullPage = Array.from({ length: FEED_PAGE_SIZE }, (_, i) => makeSwift(i + 1));
    mockApi.fetchSwiftFeed.mockResolvedValue({
      // A cursor and `hasMore`, so the feed will page. The first page has to
      // advertise more or `loadMore` correctly declines to ask.
      cursor: 'session-token.10',
      hasMore: true,
      sources: {},
      results: fullPage });

    const tree = await renderFeed();
    expect(mockApi.fetchSwiftFeed).toHaveBeenCalledTimes(1);

    mockApi.fetchSwiftFeed.mockResolvedValue({
      cursor: null,
      hasMore: false,
      sources: {},
      results: Array.from({ length: FEED_PAGE_SIZE }, (_, i) => makeSwift(i + 11)),
    });
    await act(async () => {
      listProps(tree)?.onEndReached();
    });

    expect(mockApi.fetchSwiftFeed).toHaveBeenCalledTimes(2);
    // The cursor from the first page, not an offset — and, the point of the
    // test, still nothing that could carry a coordinate.
    expect(mockApi.fetchSwiftFeed).toHaveBeenLastCalledWith('session-token.10');
    expect(mockApi.revealSwiftLocation).not.toHaveBeenCalled();
  });

  it('asks for no location when scrolling through several cards', async () => {
    const tree = await renderFeed();
    for (const index of [0, 1, 2]) {
      await act(async () => {
        listProps(tree)?.onViewableItemsChanged({
          viewableItems: [{
            index, item: makeSwift(index + 1), key: String(index + 1), isViewable: true,
          }],
        });
      });
    }
    expect(mockApi.revealSwiftLocation).not.toHaveBeenCalled();
  });

  it('records the view, which is what makes a later reveal possible', async () => {
    const tree = await renderFeed();
    await act(async () => {
      listProps(tree)?.onViewableItemsChanged({
        viewableItems: [{ index: 0, item: makeSwift(1), key: '1', isViewable: true }],
      });
    });
    expect(mockApi.recordSwiftView).toHaveBeenCalledWith(1);
  });

  it('reports a view once per Swift, however many times it becomes active', async () => {
    const tree = await renderFeed();
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        listProps(tree)?.onViewableItemsChanged({
          viewableItems: [{ index: 0, item: makeSwift(1), key: '1', isViewable: true }],
        });
      });
    }
    expect(mockApi.recordSwiftView).toHaveBeenCalledTimes(1);
  });
});

describe('the reveal happens on a press and only then', () => {
  async function pressReveal(tree: ReactTestRenderer) {
    const button = tree.root.findAllByType(SwiftLocationButton)[0];
    await act(async () => {
      button.props.onPress();
    });
    return button;
  }

  it('fetches the location when the button is pressed', async () => {
    const tree = await renderFeed();
    expect(mockApi.revealSwiftLocation).not.toHaveBeenCalled();

    await pressReveal(tree);

    expect(mockApi.revealSwiftLocation).toHaveBeenCalledTimes(1);
    expect(mockApi.revealSwiftLocation).toHaveBeenCalledWith(1);
  });

  it('draws no reveal button when the viewer could not reveal it', async () => {
    mockApi.fetchSwiftFeed.mockResolvedValue({
      cursor: null,
      hasMore: false,
      sources: {},
      results: [makeSwift(1, { location_available: false })],
    });
    const tree = await renderFeed();

    expect(tree.root.findAllByType(SwiftLocationButton)).toHaveLength(0);
  });

  it('marks the Swift revealed after a successful lookup', async () => {
    const tree = await renderFeed();
    await pressReveal(tree);

    const button = tree.root.findAllByType(SwiftLocationButton)[0];
    expect(button.props.state).toBe('revealed');
  });

  it('keeps a refused reveal out of the revealed set', async () => {
    mockApi.revealSwiftLocation.mockRejectedValue(new Error('nope'));
    const tree = await renderFeed();
    await pressReveal(tree);

    const button = tree.root.findAllByType(SwiftLocationButton)[0];
    expect(button.props.state).toBe('idle');
  });
});

describe('a revealed coordinate does not leak into feed state', () => {
  it('never writes the location onto the Swift it belongs to', async () => {
    const tree = await renderFeed();
    await act(async () => {
      tree.root.findAllByType(SwiftLocationButton)[0].props.onPress();
    });

    // Every Swift the list is rendering, as the card sees it.
    const cards = tree.root.findAll(
      (n) => n.props?.swift !== undefined && n.props?.revealState !== undefined,
    );
    expect(cards.length).toBeGreaterThan(0);

    for (const card of cards) {
      const swift = card.props.swift as Record<string, unknown>;
      for (const banned of [
        'latitude', 'longitude', 'place_name', 'location', 'coordinates',
      ]) {
        expect(swift).not.toHaveProperty(banned);
      }
    }
  });

  it('drops the coordinate when the sheet closes', async () => {
    const tree = await renderFeed();
    await act(async () => {
      tree.root.findAllByType(SwiftLocationButton)[0].props.onPress();
    });

    const sheetOf = () =>
      tree.root.findAll(
        (n) => n.props?.authorName !== undefined && n.props?.location !== undefined,
      )[0];

    expect(sheetOf()?.props.location).toEqual(LOCATION);

    await act(async () => {
      sheetOf()?.props.onClose();
    });

    expect(sheetOf()?.props.location).toBeNull();
    expect(sheetOf()?.props.visible).toBe(false);
  });
});

describe('the Swift type carries no location fields', () => {
  it('has none of the banned keys on a fully-populated row', () => {
    // A structural assertion rather than a type-level one: `Swift` is an
    // interface and vanishes at runtime, so this pins the *fixture* — which is
    // built to mirror the server's serializer field list — against the same
    // list `swifts/testing.py::FORBIDDEN_LOCATION_KEYS` uses.
    const swift = makeSwift(1) as Record<string, unknown>;
    for (const banned of [
      'latitude', 'longitude', 'lat', 'lng', 'lon',
      'place_name', 'place', 'coordinates', 'location',
    ]) {
      expect(swift).not.toHaveProperty(banned);
    }
    expect(swift).toHaveProperty('location_available');
  });
});
