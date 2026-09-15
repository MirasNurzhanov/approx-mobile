/* eslint-disable @typescript-eslint/no-require-imports -- Jest factories run before imports. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, Text } from 'react-native';
import ClubChatScreen from '../../app/clubs/[id]/chat';
import MessagesScreen from '../../app/messages/[id]';
import type { ChatSocketStatus } from '../chatSocket';
import type { useDirectMessages } from '../../hooks/useDirectMessages';

let mockStatus: ChatSocketStatus = 'connecting';
let mockCallbacks: { onOpen: () => void; onMessage: (data: string) => void };
let mockDM: ReturnType<typeof useDirectMessages>;
const mockPages = jest.fn();
jest.mock('../../hooks/useChatSocket', () => ({ useChatSocket: (_path: string, callbacks: typeof mockCallbacks) => {
  mockCallbacks = callbacks; return { status: mockStatus, send: () => false };
} }));
jest.mock('../../hooks/useDirectMessages', () => ({ useDirectMessages: () => mockDM }));
jest.mock('../api', () => ({ api: {
  get: (url: string, options: unknown) => url.includes('/messages/')
    ? mockPages(url, options) : Promise.resolve({ data: { id: 1 } }),
} }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '2', name: 'Chat', username: 'peer' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (callback: () => void) => {
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock('../../context/ThemeContext', () => ({ useTheme: () => ({ colors: require('../../constants/theme').lightColors }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../../components/ContentActions', () => ({ useContentActions: () => ({ present: jest.fn(), sheets: null }) }));
jest.mock('../../components/PermissionPrimer', () => ({ usePermissionPrimer: () => ({ ensure: jest.fn(), primer: null }) }));
jest.mock('../../components/ui/Avatar', () => ({ Avatar: () => null }));
jest.mock('../../components/PresenceDot', () => ({ PresenceDot: () => null }));
jest.mock('../../components/ui/GlassSurface', () => ({
  GlassIconButton: () => null,
  GlassSurface: ({ children }: { children: import('react').ReactNode }) => children,
}));
jest.mock('../../components/ui/icons', () => ({ IconMore: () => null }));
jest.mock('../../hooks/useReduceMotion', () => ({ announce: jest.fn() }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../clubs', () => ({ clubsApi: { get: () => Promise.resolve({ data: { my_role: 'member' } }) } }));
jest.mock('../nearbyRefresh', () => ({ removeMeetupFromMap: jest.fn() }));
jest.mock('../pinnedPlaces', () => ({ MAX_PINS: 20, useIsPinned: () => false, pinIdFor: jest.fn() }));

let renderer: ReactTestRenderer | undefined;
const ids = (start: number, count: number) => Array.from({ length: count }, (_, n) => ({
  id: start + n, sender_id: 2, content: `message ${start + n}`, created_at: '2026-09-14T00:00:00Z',
}));
const text = () => renderer!.root.findAllByType(Text).map(node => node.props.children).flat().join(' ');
beforeEach(() => {
  jest.useFakeTimers(); mockStatus = 'connecting'; mockPages.mockReset();
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount()); renderer = undefined; jest.useRealTimers();
});

it('club chat refetches a gap longer than 50 messages on reconnect and renders actual connection status', async () => {
  mockPages.mockResolvedValueOnce({ data: ids(101, 50) });
  await act(async () => { renderer = create(<ClubChatScreen />); });
  expect(text()).toContain('Connecting…');
  expect(renderer!.root.findByType(FlatList).props.data).toHaveLength(50);
  mockPages.mockResolvedValueOnce({ data: ids(201, 50) }).mockResolvedValueOnce({ data: ids(151, 50) })
    .mockResolvedValueOnce({ data: ids(101, 50) });
  act(() => mockCallbacks.onMessage(JSON.stringify(ids(251, 1)[0])));
  await act(async () => { mockStatus = 'reconnecting'; renderer!.update(<ClubChatScreen />); });
  expect(text()).toContain('Reconnecting…');
  await act(async () => { mockCallbacks.onOpen(); });
  const rows = renderer!.root.findByType(FlatList).props.data as { id: string }[];
  expect(rows.map(row => Number(row.id))).toEqual(Array.from({ length: 151 }, (_, n) => 101 + n));
  expect(mockPages.mock.calls.slice(1).map(call => call[1].params)).toEqual([{}, { before: 201 }, { before: 151 }]);
  await act(async () => { mockStatus = 'unavailable'; renderer!.update(<ClubChatScreen />); });
  expect(text()).toContain('Disconnected'); expect(text()).not.toContain('Reconnecting…');
});

it('DM screen exposes the exact failed bubble retry and older-page action', async () => {
  const failed = { id: 'pending-abc', client_id: 'abc', sender_id: 1, text: 'keep my draft',
    created_at: '2026-09-14T00:00:00Z', failed: true, failure: 'Delivery not confirmed.' };
  mockDM = { messages: [failed], setMessages: jest.fn(), loading: false, loadingOlder: false, canSend: true,
    nextBefore: 10, historyError: null, refresh: jest.fn(), loadOlder: jest.fn(), status: 'reconnecting',
    sendText: jest.fn(), retry: jest.fn(), onViewableItemsChanged: jest.fn() };
  await act(async () => { renderer = create(<MessagesScreen />); });
  expect(text()).toContain('Reconnecting…'); expect(text()).toContain('keep my draft');
  act(() => renderer!.root.findByProps({ accessibilityLabel: 'Retry message' }).props.onPress());
  expect(mockDM.retry).toHaveBeenCalledWith(failed);
  const list = renderer!.root.findByType(FlatList);
  act(() => list.props.ListHeaderComponent.props.onPress()); expect(mockDM.loadOlder).toHaveBeenCalledTimes(1);
  expect(list.props.onViewableItemsChanged).toBe(mockDM.onViewableItemsChanged);
});
