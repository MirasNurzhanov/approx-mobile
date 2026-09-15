import { api } from './api';

/** Never cache/reuse: every handshake (including retries) needs a fresh ticket. */
export async function getSocketTicket(path: string): Promise<string> {
  try {
    const { data } = await api.post('/api/socket-ticket/', { path }, { timeout: 8000 });
    if (typeof data?.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.ticket)) {
      throw new Error('Invalid ticket');
    }
    return data.ticket;
  } catch {
    // Axios errors include the authorization header and request/response body.
    throw new Error('A secure chat connection could not be started.');
  }
}
