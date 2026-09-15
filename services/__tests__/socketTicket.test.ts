import { api } from '../api';
import { getSocketTicket } from '../socketTicket';
import { ChatSocketConnection } from '../chatSocket';

jest.mock('../api', () => ({ api: { post: jest.fn() } }));

test('requests a fresh path-bound ticket for every attempt', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: { ticket: 'a'.repeat(43) } });
  await getSocketTicket('/ws/notifications/');
  await getSocketTicket('/ws/notifications/');
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post).toHaveBeenLastCalledWith('/api/socket-ticket/', { path: '/ws/notifications/' }, { timeout: 8000 });
});

test('never forwards Axios errors containing credentials', async () => {
  jest.mocked(api.post).mockRejectedValue({ message: 'secret-jwt', config: { headers: { Authorization: 'secret-jwt' } } });
  await expect(getSocketTicket('/ws/notifications/')).rejects.toEqual(new Error('A secure chat connection could not be started.'));
});

test('socket retries use new tickets and never put access JWTs in URLs', async () => {
  jest.useFakeTimers();
  const getTicket = jest.fn().mockResolvedValueOnce('first-ticket').mockResolvedValueOnce('second-ticket');
  const socket = { close: jest.fn(), onerror: null } as unknown as WebSocket;
  const createSocket = jest.fn(() => socket);
  const connection = new ChatSocketConnection({
    url: 'wss://example.test/ws/notifications/', getTicket, createSocket,
    onStatus: jest.fn(), onMessage: jest.fn(), onOpen: jest.fn(),
  });
  connection.start();
  await Promise.resolve();
  expect(createSocket).toHaveBeenLastCalledWith('wss://example.test/ws/notifications/?ticket=first-ticket');
  socket.onerror?.({} as Event);
  await jest.advanceTimersByTimeAsync(1000);
  expect(getTicket).toHaveBeenCalledTimes(2);
  expect(createSocket).toHaveBeenLastCalledWith('wss://example.test/ws/notifications/?ticket=second-ticket');
  connection.stop();
  jest.useRealTimers();
});

test('a ticket returned after stop cannot open a stale socket', async () => {
  let resolve!: (ticket: string) => void;
  const createSocket = jest.fn();
  const connection = new ChatSocketConnection({
    url: 'wss://example.test/ws/notifications/',
    getTicket: () => new Promise(done => { resolve = done; }), createSocket,
    onStatus: jest.fn(), onMessage: jest.fn(), onOpen: jest.fn(),
  });
  connection.start();
  connection.stop();
  resolve('old-ticket');
  await Promise.resolve();
  expect(createSocket).not.toHaveBeenCalled();
});
