import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ViewToken } from 'react-native';
import { useDirectMessages } from '../../hooks/useDirectMessages';
import type { DirectMessage, RawDirectMessage } from '../directMessages';
import type { HistoryPage } from '../chatHistory';

const mockGet = jest.fn();
const mockPost = jest.fn();
let mockFocused = true;
let mockAppState = 'active';
const mockListeners = new Set<(state: string) => void>();
let mockSocket: { onOpen: () => void; onMessage: (data: string) => void };
jest.mock('../api', () => ({ api: {
  get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args),
} }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('../../hooks/useChatSocket', () => ({ useChatSocket: (_path: string, callbacks: typeof mockSocket) => {
  mockSocket = callbacks; return { status: 'reconnecting', send: () => false };
} }));
jest.mock('react-native', () => ({ AppState: {
  get currentState() { return mockAppState; },
  addEventListener: (_event: string, listener: (state: string) => void) => {
    mockListeners.add(listener); return { remove: () => mockListeners.delete(listener) };
  },
} }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const raw = (id: number, sender_id = 2, client_id?: string): RawDirectMessage => ({
  id, sender_id, client_id, content: 'same words', created_at: '2026-09-14T00:00:00Z',
});
const page = (rows: RawDirectMessage[] = [], before: number | null = null) => ({
  data: { results: rows, next_before: before, has_more: before !== null } satisfies HistoryPage<RawDirectMessage>,
});
let state: ReturnType<typeof useDirectMessages>;
let renderer: ReactTestRenderer | undefined;
const incoming = jest.fn();
function Harness({ other = '2', me = 1 }: { other?: string; me?: number | null }) {
  state = useDirectMessages(other, me, incoming); return null;
}
async function mount() { await act(async () => { renderer = create(<Harness />); }); }
beforeEach(() => {
  mockGet.mockReset().mockResolvedValue(page()); mockPost.mockReset().mockResolvedValue({ data: {} });
  incoming.mockReset(); mockFocused = true; mockAppState = 'active';
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount()); renderer = undefined;
  expect(mockListeners.size).toBe(0);
});

it('shows optimistic text and uses a correlated REST acknowledgement even while the socket is dead', async () => {
  await mount();
  const ack = deferred<{ data: RawDirectMessage }>(); mockPost.mockReturnValueOnce(ack.promise);
  act(() => { expect(state.sendText(' same words ')).toBe(true); });
  const pending = state.messages[0];
  expect(pending).toMatchObject({ text: 'same words', pending: true, sender_id: 1 });
  expect(pending.client_id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  expect(mockPost).toHaveBeenCalledWith('/api/friends/messages/2/',
    { content: 'same words', client_id: pending.client_id }, { timeout: 15000 });
  await act(async () => { ack.resolve({ data: raw(5, 1, pending.client_id!) }); });
  expect(state.messages).toHaveLength(1); expect(state.messages[0]).toMatchObject({ id: '5', text: 'same words' });
  expect(state.messages[0].pending).toBeUndefined();
});

it('identical texts reconcile independently when echoes and acknowledgements arrive out of order', async () => {
  await mount();
  const first = deferred<{ data: RawDirectMessage }>(), second = deferred<{ data: RawDirectMessage }>();
  mockPost.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  act(() => { state.sendText('same words'); state.sendText('same words'); });
  const [a, b] = state.messages.map(row => row.client_id!); expect(a).not.toBe(b);
  act(() => mockSocket.onMessage(JSON.stringify(raw(12, 1, b))));
  await act(async () => { second.resolve({ data: raw(12, 1, b) }); });
  expect(state.messages.filter(row => row.pending)).toHaveLength(1);
  await act(async () => { first.resolve({ data: raw(11, 1, a) }); });
  act(() => mockSocket.onMessage(JSON.stringify(raw(11, 1, a))));
  expect(state.messages.map(row => row.id)).toEqual(['11', '12']);
  expect(incoming).not.toHaveBeenCalled();
});

it('failure touches only its text, preserves a pending image, and retry reuses the original key', async () => {
  await mount();
  const first = deferred<{ data: RawDirectMessage }>(), second = deferred<{ data: RawDirectMessage }>();
  mockPost.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  act(() => {
    state.setMessages([{ id: 'temp-img-7', image: 'file://image', sender_id: 1, created_at: '', pending: true }]);
    state.sendText('same words'); state.sendText('same words');
  });
  const key = state.messages[1].client_id!;
  await act(async () => { first.reject({ response: { data: { detail: 'Try again later.' } } }); });
  expect(state.messages[0]).toMatchObject({ id: 'temp-img-7', pending: true });
  expect(state.messages[1]).toMatchObject({ client_id: key, failed: true, failure: 'Try again later.' });
  expect(state.messages[2].pending).toBe(true);
  const retry = deferred<{ data: RawDirectMessage }>(); mockPost.mockReturnValueOnce(retry.promise);
  const failed = state.messages[1];
  act(() => { void state.retry(failed); void state.retry(failed); });
  expect(mockPost).toHaveBeenCalledTimes(3);
  expect(mockPost.mock.calls[2][1].client_id).toBe(key);
  await act(async () => { retry.resolve({ data: raw(8, 1, key) }); second.resolve({ data: raw(9, 1, state.messages.find(row => row.client_id !== key && row.client_id)!.client_id!) }); });
  expect(state.messages.map(row => row.id)).toEqual(['8', '9', 'temp-img-7']);
});

it('a lost acknowledgement after an echo does not mark a delivered message as failed', async () => {
  await mount(); const ack = deferred<{ data: RawDirectMessage }>(); mockPost.mockReturnValueOnce(ack.promise);
  act(() => { state.sendText('same words'); }); const key = state.messages[0].client_id!;
  act(() => mockSocket.onMessage(JSON.stringify(raw(10, 1, key))));
  await act(async () => { ack.reject(new Error('timeout')); });
  expect(state.messages[0]).toMatchObject({ id: '10' }); expect(state.messages[0].failed).toBeUndefined();
  act(() => { mockSocket.onMessage('null'); mockSocket.onMessage('{bad'); mockSocket.onMessage('{"type":"error"}'); });
  expect(state.messages).toHaveLength(1);
});

it('reconnect catches every missed page without a newer live message jumping the history boundary', async () => {
  mockGet.mockResolvedValueOnce(page([raw(1)])); await mount();
  mockGet.mockResolvedValueOnce(page([raw(102), raw(103)], 102))
    .mockResolvedValueOnce(page([raw(2), raw(101)], 2)).mockResolvedValueOnce(page([raw(1)]));
  act(() => mockSocket.onMessage(JSON.stringify(raw(104))));
  await act(async () => { mockSocket.onOpen(); });
  expect(state.messages.map(row => row.id)).toEqual(['1', '2', '101', '102', '103', '104']);
  expect(mockGet.mock.calls.slice(1).map(call => call[1].params)).toEqual([{}, { before: 102 }, { before: 2 }]);
});

it('loads older pages only once per pending request and exposes recoverable history errors', async () => {
  mockGet.mockResolvedValueOnce(page([raw(5), raw(6)], 5)); await mount();
  const older = deferred<ReturnType<typeof page>>(); mockGet.mockReturnValueOnce(older.promise);
  act(() => { void state.loadOlder(); void state.loadOlder(); });
  expect(mockGet).toHaveBeenCalledTimes(2); expect(state.loadingOlder).toBe(true);
  await act(async () => { older.resolve(page([raw(3), raw(4)])); });
  expect(state.messages.map(row => row.id)).toEqual(['3', '4', '5', '6']); expect(state.nextBefore).toBeNull();
  mockGet.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await state.refresh(); }); expect(state.historyError).toContain('Tap to retry');
  mockGet.mockResolvedValueOnce(page([raw(6)]));
  await act(async () => { await state.refresh(); }); expect(state.historyError).toBeNull();
});

function view(...messages: DirectMessage[]) {
  state.onViewableItemsChanged({ viewableItems: messages.map(item => ({
    item, key: item.id, index: 0, isViewable: true,
  } satisfies ViewToken<DirectMessage>)) });
}
it('GET and incoming frames never mark read; only visible inbound messages on the foreground screen do', async () => {
  mockGet.mockResolvedValueOnce(page([raw(1), raw(2, 1), raw(3)])); await mount();
  expect(mockPost).not.toHaveBeenCalled();
  act(() => mockSocket.onMessage(JSON.stringify(raw(4)))); expect(mockPost).not.toHaveBeenCalled();
  act(() => view(state.messages[1])); expect(mockPost).not.toHaveBeenCalled();
  await act(async () => { view(state.messages[0]); });
  expect(mockPost).toHaveBeenLastCalledWith('/api/friends/messages/2/read/', { through_id: 1 });
  mockAppState = 'background'; act(() => view(state.messages[2])); expect(mockPost).toHaveBeenCalledTimes(1);
  await act(async () => { mockAppState = 'active'; mockListeners.forEach(fn => fn('active')); });
  expect(mockPost).toHaveBeenLastCalledWith('/api/friends/messages/2/read/', { through_id: 3 });
  await act(async () => { mockFocused = false; renderer!.update(<Harness />); });
  act(() => view(state.messages[3])); expect(mockPost).toHaveBeenCalledTimes(2);
});

it('discarded-route responses cannot leak into a new conversation', async () => {
  const old = deferred<ReturnType<typeof page>>(); mockGet.mockReturnValueOnce(old.promise);
  await mount();
  mockGet.mockResolvedValueOnce(page([raw(20, 3)]));
  await act(async () => { renderer!.update(<Harness other="3" />); });
  await act(async () => { old.resolve(page([raw(10)])); });
  expect(state.messages.map(row => row.id)).toEqual(['20']);
  const ack = deferred<{ data: RawDirectMessage }>(); mockPost.mockReturnValueOnce(ack.promise);
  act(() => { state.sendText('old draft'); });
  await act(async () => { renderer!.update(<Harness other="4" />); });
  await act(async () => { ack.resolve({ data: raw(21, 1) }); });
  expect(state.messages).toEqual([]);
});

it('does not clear a draft before its sender is known', async () => {
  await act(async () => { renderer = create(<Harness me={null} />); });
  act(() => { expect(state.sendText('draft')).toBe(false); });
  expect(mockPost).not.toHaveBeenCalled(); expect(state.messages).toEqual([]);
});
