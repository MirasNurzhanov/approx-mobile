/* eslint-disable @typescript-eslint/no-require-imports -- Mock factories load dependencies after Jest hoists them. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import CreatorSwiftsScreen from '../../../app/swifts/user/[id]';
import { api } from '../../../services/api';
import { SwiftProfileSection, SwiftProfileTile } from '../SwiftProfileSection';
import { useCreatorSwifts } from '../useCreatorSwifts';
import { hiddenProfileMessage, profileDetailsHidden } from '../profilePrivacy';
import { creatorSwiftLabel, fetchCreatorSwifts } from '../../../services/swiftCreator';
import type { Swift, SwiftPage } from '../../../services/swifts';

let mockFocused = true;
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({ id: '22' }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    require('react').useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]);
  },
}));
jest.mock('../../../services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('../../../services/swiftCreator', () => ({
  ...jest.requireActual('../../../services/swiftCreator'), fetchCreatorSwifts: jest.fn(),
}));
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: require('../../../constants/theme').lightColors }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../../../components/ui/icons', () => ({
  IconBack: 'IconBack', IconChart: 'IconChart', IconChevron: 'IconChevron', IconPlay: 'IconPlay', IconSwift: 'IconSwift',
}));
jest.mock('../../../components/swifts/icons', () => ({ SwiftPlusIcon: 'SwiftPlusIcon' }));

const fetchMock = jest.mocked(fetchCreatorSwifts);
const video = (id = 1, changes: Partial<Swift> = {}): Swift => ({
  id, author: { id: 22, username: 'desk' }, caption: 'My desk', thumbnail_url: '',
  view_count: 12, status: 'ready', review_state: 'published', visibility: 'public', is_mine: true,
  ...changes,
} as Swift);
let renderer: ReactTestRenderer | undefined;
let gallery: ReturnType<typeof useCreatorSwifts>;
function Harness({ enabled = true, creatorId = 22, refreshKey = 0 }: { enabled?: boolean; creatorId?: number; refreshKey?: number }) {
  gallery = useCreatorSwifts(creatorId, enabled, 2, refreshKey);
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  mockFocused = true;
  fetchMock.mockReset();
  mockPush.mockReset();
  jest.mocked(api.get).mockReset();
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
});

it('never requests or renders a creator grid without profile permission', async () => {
  await act(async () => { renderer = create(<SwiftProfileSection creatorId={22} canView={false} />); });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(renderer!.toJSON()).toBeNull();
});

it('shows owner review and audience labels without claiming unapproved uploads are published', async () => {
  fetchMock.mockResolvedValue({ count: 3, results: [
    video(1, { review_state: 'reviewing' }), video(2, { review_state: 'needs_review' }),
    video(3, { visibility: 'private' }),
  ] });
  await act(async () => { renderer = create(<SwiftProfileSection creatorId={22} canView isOwner ghostMode />); });
  const output = JSON.stringify(renderer!.toJSON());
  expect(output).toContain('Being reviewed');
  expect(output).toContain('Awaiting review');
  expect(output).toContain('Only me');
  expect(output).toContain('Your Swifts are hidden from others while Ghost Mode is on.');
  act(() => renderer!.root.findByProps({ accessibilityLabel: 'Swift analytics' }).props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/swifts/analytics');
});

it('links a visible tile to its Swift detail without passing cached content or coordinates', () => {
  act(() => { renderer = create(<SwiftProfileTile swift={video()} />); });
  act(() => renderer!.root.findByProps({ testID: 'creator-swift-1' }).props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/swifts/[id]', params: { id: 1 } });
});

it('renders the owner empty state and upload entry', async () => {
  fetchMock.mockResolvedValue({ count: 0, results: [] });
  await act(async () => { renderer = create(<SwiftProfileSection creatorId={22} canView isOwner />); });
  expect(JSON.stringify(renderer!.toJSON())).toContain('Your first Swift starts here');
  act(() => renderer!.root.findByProps({ accessibilityLabel: 'Upload a Swift' }).props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/swifts/compose');
});

it('distinguishes failed uploads and suppresses owner-only status labels for other viewers', () => {
  expect(creatorSwiftLabel(video(1, { status: 'failed' }))).toBe('Upload failed');
  expect(creatorSwiftLabel(video(1, { status: 'processing' }))).toBe('Processing');
  expect(creatorSwiftLabel(video(1, { visibility: 'friends' }))).toBe('Friends');
  expect(creatorSwiftLabel(video(1, { is_mine: false, review_state: 'needs_review' }))).toBe('');
});

it('deduplicates overlapping pagination requests and appends the next page', async () => {
  fetchMock.mockResolvedValueOnce({ count: 3, results: [video(1), video(2)] });
  await act(async () => { renderer = create(<Harness />); });
  const next = deferred<SwiftPage>();
  fetchMock.mockReturnValueOnce(next.promise);
  let completion!: Promise<void>;
  act(() => { completion = gallery.loadMore(); void gallery.loadMore(); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1]?.offset).toBe(2);
  await act(async () => { next.resolve({ count: 3, results: [video(3)] }); await completion; });
  expect(gallery.items.map((item) => item.id)).toEqual([1, 2, 3]);
  await act(async () => { await gallery.loadMore(); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('clears already loaded videos when a later page revokes access', async () => {
  fetchMock.mockResolvedValueOnce({ count: 3, results: [video(1), video(2)] });
  await act(async () => { renderer = create(<Harness />); });
  fetchMock.mockRejectedValueOnce({ response: { status: 404 } });
  await act(async () => { await gallery.loadMore(); });
  expect(gallery.items).toEqual([]);
  expect(gallery.count).toBe(0);
  expect(gallery.unavailable).toBe(true);
});

it('does not restore a stale response after profile access becomes hidden', async () => {
  const old = deferred<SwiftPage>();
  fetchMock.mockReturnValueOnce(old.promise);
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { renderer!.update(<Harness enabled={false} />); });
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => { old.resolve({ count: 1, results: [video(1)] }); });
  expect(gallery.items).toEqual([]);
  expect(gallery.loading).toBe(false);
});

it('clears the gallery on blur and re-fetches on the next visit', async () => {
  fetchMock.mockResolvedValue({ count: 1, results: [video(1)] });
  await act(async () => { renderer = create(<Harness />); });
  mockFocused = false;
  await act(async () => { renderer!.update(<Harness />); });
  expect(gallery.items).toEqual([]);
  mockFocused = true;
  await act(async () => { renderer!.update(<Harness />); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(gallery.items).toHaveLength(1);
});

it('revalidates on parent refresh and exposes recoverable network failures', async () => {
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { renderer = create(<Harness />); });
  expect(gallery.error).toContain('Try again');
  expect(gallery.unavailable).toBe(false);
  fetchMock.mockResolvedValueOnce({ count: 1, results: [video(1)] });
  await act(async () => { renderer!.update(<Harness refreshKey={1} />); });
  expect(gallery.error).toBeNull();
  expect(gallery.items).toHaveLength(1);
});

it('rechecks profile permission for a direct creator-page link before loading any videos', async () => {
  jest.mocked(api.get).mockResolvedValueOnce({ data: { id: 1, username: 'viewer' } })
    .mockResolvedValueOnce({ data: { id: 22, username: 'hidden', can_view_swifts: false } });
  await act(async () => { renderer = create(<CreatorSwiftsScreen />); });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(renderer!.root.findByProps({ children: 'These Swifts are not available.' })).toBeDefined();
});

it('allows the authenticated owner to open their gallery without a public-profile permission flag', async () => {
  jest.mocked(api.get).mockResolvedValueOnce({ data: { id: 22, username: 'owner', ghost_mode: true } });
  fetchMock.mockResolvedValueOnce({ count: 1, results: [video(1, { review_state: 'reviewing' })] });
  await act(async () => { renderer = create(<CreatorSwiftsScreen />); });
  expect(fetchMock).toHaveBeenCalledWith(22, expect.objectContaining({ limit: 24 }));
  expect(renderer!.root.findByProps({ children: 'Your Swifts are hidden from others while Ghost Mode is on.' })).toBeDefined();
  expect(renderer!.root.findByProps({ children: 'Being reviewed' })).toBeDefined();
});

it('requests an authenticated creator page with pagination and cancellation', async () => {
  const realService = jest.requireActual<typeof import('../../../services/swiftCreator')>('../../../services/swiftCreator');
  const controller = new AbortController();
  jest.mocked(api.get).mockResolvedValueOnce({ data: { count: 5, results: [video(4)] } });
  const page = await realService.fetchCreatorSwifts(22, { offset: 3, limit: 2, signal: controller.signal });
  expect(api.get).toHaveBeenCalledWith('/api/swifts/creator/22/', {
    params: { offset: 3, limit: 2 }, signal: controller.signal,
  });
  expect(page.count).toBe(5);
  expect(page.results[0].id).toBe(4);
});

it('treats anonymous minimal profiles as hidden for friends without promising access', () => {
  expect(profileDetailsHidden({ is_private: false, can_view_swifts: false })).toBe(true);
  expect(profileDetailsHidden({})).toBe(true);
  expect(profileDetailsHidden({ bio: '', can_view_swifts: true })).toBe(false);
  expect(hiddenProfileMessage({ can_view_swifts: false }, 'friend')).toBe("This person isn't sharing their profile details or Swifts.");
  expect(hiddenProfileMessage({ is_private: true }, 'stranger')).toContain('privacy settings control');
  expect(hiddenProfileMessage({ is_private: true }, 'hi_sent')).toContain('privacy settings control');
});

it('advances pagination by consumed rows even when pages contain already displayed videos', async () => {
  fetchMock.mockResolvedValueOnce({ count: 5, results: [video(1), video(2)] });
  await act(async () => { renderer = create(<Harness />); });
  fetchMock.mockResolvedValueOnce({ count: 5, results: [video(2), video(3)] });
  await act(async () => { await gallery.loadMore(); });
  expect(gallery.items.map((item) => item.id)).toEqual([1, 2, 3]);
  fetchMock.mockResolvedValueOnce({ count: 5, results: [video(4)] });
  await act(async () => { await gallery.loadMore(); });
  expect(fetchMock.mock.calls[2][1]?.offset).toBe(4);
  await act(async () => { await gallery.loadMore(); });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(gallery.items.map((item) => item.id)).toEqual([1, 2, 3, 4]);
});

it('stops paginating on an empty page even if a concurrently changing count remains larger', async () => {
  fetchMock.mockResolvedValueOnce({ count: 9, results: [video(1), video(2)] });
  await act(async () => { renderer = create(<Harness />); });
  fetchMock.mockResolvedValueOnce({ count: 9, results: [] });
  await act(async () => { await gallery.loadMore(); });
  await act(async () => { await gallery.loadMore(); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
