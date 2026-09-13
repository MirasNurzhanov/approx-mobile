import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatSocketConnection, CHAT_SOCKET_LABEL, retryDelay } from '../chatSocket';
import { useChatSocket } from '../../hooks/useChatSocket';

let mockFocused = true;
let mockAppState = 'active';
const mockListeners = new Set<(state: string) => void>();
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('../api', () => ({ BASE_URL: 'https://chat.example.test' }));
jest.mock('react-native', () => ({
  AppState: {
    get currentState() { return mockAppState; },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mockListeners.add(listener); return { remove: () => mockListeners.delete(listener) };
    },
  },
}));

class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = jest.fn();
  close = jest.fn(() => { this.readyState = 3; });
  open() { this.readyState = 1; this.onopen?.(); }
  disconnect(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}
let sockets: FakeSocket[];
let connection: ChatSocketConnection;
let renderer: ReactTestRenderer | undefined;
const originalWebSocket = global.WebSocket;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function setup(getToken = jest.fn<Promise<string | null>, []>().mockResolvedValue('token')) {
  const onStatus = jest.fn(), onOpen = jest.fn(), onMessage = jest.fn();
  const createSocket = jest.fn(() => {
    const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket;
  });
  connection = new ChatSocketConnection({ url: 'wss://chat.example.test/ws/', getToken,
    createSocket, onStatus, onOpen, onMessage });
  return { getToken, createSocket, onStatus, onOpen, onMessage };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Math, 'random').mockReturnValue(1);
  sockets = []; mockFocused = true; mockAppState = 'active';
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  connection?.stop();
  global.WebSocket = originalWebSocket;
  jest.restoreAllMocks(); jest.useRealTimers();
});

it('uses exponential delay, jitter and a hard 30-second cap', () => {
  expect([0, 1, 2, 3, 4, 5, 20].map(n => retryDelay(n, () => 1)))
    .toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  expect(retryDelay(2, () => 0)).toBe(2000);
  expect(retryDelay(2, () => 0.5)).toBe(3000);
});

it('owns one connection and one retry even when error and close both arrive', async () => {
  const options = setup();
  connection.start(); connection.start(); await flush();
  expect(sockets).toHaveLength(1);
  sockets[0].open();
  expect(options.onStatus).toHaveBeenLastCalledWith('connected');
  const oldClose = sockets[0].onclose;
  sockets[0].onerror?.(); oldClose?.({ code: 1006 });
  expect(options.onStatus).toHaveBeenLastCalledWith('reconnecting');
  expect(jest.getTimerCount()).toBe(1);
  jest.advanceTimersByTime(999); await flush(); expect(sockets).toHaveLength(1);
  jest.advanceTimersByTime(1); await flush(); expect(sockets).toHaveLength(2);
  expect(sockets[0].close).toHaveBeenCalledTimes(1);
  expect(options.getToken).toHaveBeenCalledTimes(2);
  sockets[1].open();
  expect(options.onOpen).toHaveBeenCalledTimes(2);
  connection.stop(); expect(jest.getTimerCount()).toBe(0);
});

it('keeps growing backoff for flapping sockets and resets after a stable connection', async () => {
  setup(); connection.start(); await flush();
  sockets[0].disconnect(); jest.advanceTimersByTime(1000); await flush();
  sockets[1].open(); sockets[1].disconnect();
  jest.advanceTimersByTime(1999); await flush(); expect(sockets).toHaveLength(2);
  jest.advanceTimersByTime(1); await flush(); expect(sockets).toHaveLength(3);
  sockets[2].open(); jest.advanceTimersByTime(10000); sockets[2].disconnect();
  jest.advanceTimersByTime(1000); await flush(); expect(sockets).toHaveLength(4);
});

it('recovers a hung handshake and rejects stale events after stopping', async () => {
  const options = setup(); connection.start(); await flush();
  const staleOpen = sockets[0].onopen;
  jest.advanceTimersByTime(10000); await flush();
  expect(sockets[0].close).toHaveBeenCalledTimes(1);
  connection.stop(); staleOpen?.(); jest.advanceTimersByTime(60000); await flush();
  expect(sockets).toHaveLength(1); expect(options.onOpen).not.toHaveBeenCalled();
  expect(options.onStatus).toHaveBeenLastCalledWith('paused');
  expect(jest.getTimerCount()).toBe(0);
});

it('does not create a socket from a token lookup completed after stop or timeout', async () => {
  let resolve!: (token: string) => void;
  const token = new Promise<string>(yes => { resolve = yes; });
  const getToken = jest.fn<Promise<string | null>, []>().mockReturnValueOnce(token).mockResolvedValue('fresh');
  setup(getToken); connection.start();
  jest.advanceTimersByTime(11000); await flush(); expect(sockets).toHaveLength(1);
  resolve('stale'); await flush(); expect(sockets).toHaveLength(1);
  connection.stop(); expect(jest.getTimerCount()).toBe(0);
});

it('reports terminal auth/access failures as disconnected without retrying', async () => {
  const options = setup(); connection.start(); await flush(); sockets[0].disconnect(4001);
  expect(options.onStatus).toHaveBeenLastCalledWith('unavailable');
  expect(CHAT_SOCKET_LABEL.unavailable).toBe('Disconnected');
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(60000); await flush(); expect(sockets).toHaveLength(1);
});

it('reports a failed or closed send so the caller can use its REST fallback', async () => {
  setup(); connection.start(); await flush(); expect(connection.send('text')).toBe(false);
  sockets[0].open(); expect(connection.send('text')).toBe(true);
  sockets[0].send.mockImplementation(() => { throw new Error('dead transport'); });
  expect(connection.send('text')).toBe(false); expect(jest.getTimerCount()).toBe(1);
});

it('does not retry absent credentials and safely encodes current tokens', async () => {
  const options = setup(jest.fn<Promise<string | null>, []>().mockResolvedValue(null));
  connection.start(); await flush(); expect(sockets).toHaveLength(0);
  expect(options.onStatus).toHaveBeenLastCalledWith('unavailable');
  connection.stop(); options.getToken.mockResolvedValue('a+b/c='); connection.start(); await flush();
  expect(options.createSocket).toHaveBeenCalledWith('wss://chat.example.test/ws/?token=a%2Bb%2Fc%3D');
});

it('the actual hook reconnects on foreground/focus and cleans up on route change and unmount', async () => {
  const urls: string[] = [];
  global.WebSocket = class extends FakeSocket {
    constructor(url: string) { super(); urls.push(url); sockets.push(this); }
  } as unknown as typeof WebSocket;
  jest.mocked(AsyncStorage.getItem).mockResolvedValue('fresh-token');
  const onOpen = jest.fn();
  let state!: ReturnType<typeof useChatSocket>;
  function Harness({ path = '/ws/chat/2/' }) {
    state = useChatSocket(path, { onOpen, onMessage: jest.fn() }); return null;
  }
  await act(async () => { renderer = create(<Harness />); });
  expect(state.status).toBe('connecting');
  act(() => sockets[0].open()); expect(state.status).toBe('connected');
  act(() => { mockAppState = 'background'; mockListeners.forEach(fn => fn('background')); });
  expect(state.status).toBe('paused'); expect(sockets[0].close).toHaveBeenCalledTimes(1);
  await act(async () => {
    mockAppState = 'active'; mockListeners.forEach(fn => fn('active')); mockListeners.forEach(fn => fn('active'));
  });
  expect(sockets).toHaveLength(2); act(() => sockets[1].open()); expect(onOpen).toHaveBeenCalledTimes(2);
  await act(async () => { mockFocused = false; renderer!.update(<Harness />); });
  expect(sockets[1].close).toHaveBeenCalledTimes(1);
  await act(async () => { mockFocused = true; renderer!.update(<Harness path="/ws/clubs/3/" />); });
  expect(sockets).toHaveLength(3); expect(urls[2]).toContain('/ws/clubs/3/?token=');
  act(() => sockets[2].disconnect());
  act(() => renderer!.unmount()); renderer = undefined;
  expect(mockListeners.size).toBe(0); expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(60000); await flush(); expect(sockets).toHaveLength(3);
});
