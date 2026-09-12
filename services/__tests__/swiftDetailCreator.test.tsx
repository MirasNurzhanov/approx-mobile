/* eslint-disable @typescript-eslint/no-require-imports -- Jest factories run before imports. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable, Text, View } from 'react-native';

import SwiftDetailScreen from '../../app/swifts/[id]';
import { SwiftCard } from '../../components/swifts/SwiftCard';
import { SwiftCommentsSheet } from '../../components/swifts/SwiftCommentsSheet';
import { SwiftLocationSheet } from '../../components/swifts/SwiftLocationSheet';
import { fetchSwift, recordSwiftView, revealSwiftLocation, type Swift, type SwiftLocation } from '../swifts';

let mockFocused = true;
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '42' }),
  useRouter: () => ({ push: mockPush, canGoBack: () => true, back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (callback: () => (() => void)) => {
    const React = require('react') as typeof import('react');
    const focused = mockFocused;
    React.useEffect(() => focused ? callback() : undefined, [callback, focused]);
  },
}));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: require('../../constants/theme').lightColors }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../components/swifts/SwiftCard', () => ({ SwiftCard: () => null }));
jest.mock('../../components/swifts/SwiftCommentsSheet', () => ({ SwiftCommentsSheet: () => null }));
jest.mock('../../components/swifts/SwiftLocationSheet', () => ({ SwiftLocationSheet: () => null }));
jest.mock('../../components/swifts/SwiftReviewNotice', () => ({ SwiftReviewNotice: () => null }));
jest.mock('../../components/swifts/icons', () => ({ SwiftEmptyIcon: () => null }));
jest.mock('../../components/ui/icons', () => ({ IconChart: () => null, IconClose: () => null }));
jest.mock('../../components/ContentActions', () => ({
  useContentActions: () => ({ present: jest.fn(), sheets: null }),
}));
jest.mock('../swiftSignals', () => ({ reportSwiftSignal: jest.fn() }));
jest.mock('../swifts', () => ({
  fetchSwift: jest.fn(), recordSwiftView: jest.fn(), revealSwiftLocation: jest.fn(),
  setSwiftLiked: jest.fn(), setSwiftReposted: jest.fn(),
  SwiftLocationUnavailable: class extends Error {},
}));

const fetch = fetchSwift as jest.Mock;
const record = recordSwiftView as jest.Mock;
const revealLocation = revealSwiftLocation as jest.Mock;
let tree: ReactTestRenderer | undefined;

function swift(overrides: Partial<Swift> = {}): Swift {
  return {
    id: 42, author: { id: 7, username: 'creator', profile_picture: null },
    caption: 'A day at the desk', video_url: 'https://example.com/42.mp4', thumbnail_url: '',
    duration_ms: 10000, width: 640, height: 1138, aspect_ratio: null, status: 'ready', review_state: 'published',
    trim_start_ms: 0, trim_end_ms: null, original_volume: 100, overlay_text: '', overlay_position: 'bottom',
    track: null, audio_title: '', audio_artist: '', uses_original_audio: true,
    visibility: 'public', allow_comments: true, allow_reposts: true,
    like_count: 0, comment_count: 0, repost_count: 0, view_count: 0,
    viewer_liked: false, viewer_reposted: false,
  viewer_saved: false, viewer_viewed: false,
    location_available: true, is_mine: true, created_at: '2026-09-09T00:00:00Z', updated_at: '2026-09-09T00:00:00Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function render() {
  await act(async () => { tree = create(<SwiftDetailScreen />); });
  act(() => tree!.root.findAllByType(View)[0].props.onLayout({
    nativeEvent: { layout: { height: 800 } },
  }));
  return tree!;
}

async function focus(focused: boolean) {
  mockFocused = focused;
  await act(async () => { tree!.update(<SwiftDetailScreen />); });
}

beforeEach(() => {
  mockFocused = true;
  fetch.mockReset();
  record.mockReset().mockResolvedValue(undefined);
  revealLocation.mockReset();
  mockPush.mockClear();
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  jest.useRealTimers();
});

it('opens analytics scoped to the owner Swift and removes its video when navigation blurs it', async () => {
  fetch.mockResolvedValue(swift());
  const screen = await render();
  expect(screen.root.findAllByType(SwiftCard)).toHaveLength(1);
  act(() => screen.root.findByProps({ accessibilityLabel: 'View analytics for this Swift' }).props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/swifts/analytics', params: { swift_id: '42' } });
  // Stack screens stay mounted underneath analytics; focus cleanup must remove
  // the SwiftCard so its player cannot keep running beneath the new page.
  await focus(false);
  expect(screen.root.findAllByType(SwiftCard)).toHaveLength(0);
  expect(screen.root.findByType(SwiftCommentsSheet).props.visible).toBe(false);
  expect(screen.root.findByType(SwiftLocationSheet).props.visible).toBe(false);
  await focus(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.root.findAllByType(SwiftCard)).toHaveLength(1);
});

it('does not offer creator analytics for another person\'s Swift', async () => {
  fetch.mockResolvedValue(swift({ is_mine: false }));
  const screen = await render();
  const labels = screen.root.findAllByType(Pressable).map(node => node.props.accessibilityLabel);
  expect(labels).not.toContain('View analytics for this Swift');
  expect(screen.root.findAllByType(SwiftCard)).toHaveLength(1);
});

it('cannot restore an old response after refocus learns the creator has hidden the Swift', async () => {
  const old = deferred<Swift>();
  const current = deferred<Swift>();
  fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const screen = await render();
  await focus(false);
  await focus(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => current.reject(new Error('Not found')));
  await act(async () => old.resolve(swift({ caption: 'Previously visible private content' })));
  expect(screen.root.findAllByType(SwiftCard)).toHaveLength(0);
  expect(screen.root.findAllByType(Text).map(node => node.props.children)).toContain("Couldn't load that Swift");
});

it('discards a location reveal that finishes after leaving and returning to the detail screen', async () => {
  const pending = deferred<SwiftLocation>();
  fetch.mockResolvedValue(swift());
  revealLocation.mockReturnValueOnce(pending.promise);
  const screen = await render();
  act(() => { void screen.root.findByType(SwiftCard).props.onRevealLocation(swift()); });
  expect(screen.root.findByType(SwiftLocationSheet).props.visible).toBe(true);
  await focus(false);
  await focus(true);
  await act(async () => pending.resolve({
    latitude: 10, longitude: 20, place_name: 'A private place',
    captured_at: '2026-09-09T00:00:00Z', precision: 'exact',
  }));
  const sheet = screen.root.findByType(SwiftLocationSheet);
  expect(sheet.props.visible).toBe(false);
  expect(sheet.props.location).toBeNull();
  expect(screen.root.findByType(SwiftCard).props.revealState).toBe('idle');
});

it('does not let an old moderation poll overwrite the freshly revalidated detail', async () => {
  jest.useFakeTimers();
  const poll = deferred<Swift>();
  fetch.mockResolvedValueOnce(swift({ review_state: 'reviewing' }))
    .mockReturnValueOnce(poll.promise)
    .mockResolvedValueOnce(swift({ caption: 'Fresh approved result' }));
  const screen = await render();
  act(() => { jest.advanceTimersByTime(4000); });
  expect(fetch).toHaveBeenCalledTimes(2);
  await focus(false);
  await focus(true);
  await act(async () => poll.resolve(swift({ caption: 'Old review response', review_state: 'reviewing' })));
  expect(screen.root.findByType(SwiftCard).props.swift.caption).toBe('Fresh approved result');
  expect(screen.root.findByType(SwiftCard).props.swift.review_state).toBe('published');
});
