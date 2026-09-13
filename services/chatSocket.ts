export type ChatSocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'paused' | 'unavailable';

export const CHAT_SOCKET_LABEL: Record<ChatSocketStatus, string> = {
  connecting: 'Connecting…', connected: '', reconnecting: 'Reconnecting…',
  paused: 'Connection paused', unavailable: 'Disconnected',
};
export const MAX_RETRY_DELAY_MS = 30_000;
export function retryDelay(attempt: number, random = Math.random): number {
  return Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** Math.min(attempt, 5)) * (0.5 + random() * 0.5);
}

type Options = {
  url: string;
  getToken: () => Promise<string | null>;
  createSocket: (url: string) => WebSocket;
  onStatus: (status: ChatSocketStatus) => void;
  onMessage: (data: string) => void;
  onOpen: () => void;
  onClose?: (code: number) => void;
};

/** One owned socket/attempt. Closing, token loading and retry timers share a generation. */
export class ChatSocketConnection {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private stable: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private attempt = 0;
  private running = false;
  private connecting = false;

  constructor(private options: Options) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    void this.connect();
  }

  stop() {
    this.running = false;
    this.generation += 1;
    this.connecting = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.closeSocket();
    this.options.onStatus('paused');
  }

  send(data: string): boolean {
    if (this.socket?.readyState !== 1) return false;
    try { this.socket.send(data); return true; }
    catch { this.retry(); return false; }
  }

  private closeSocket() {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
    if (this.stable) clearTimeout(this.stable);
    this.stable = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      try { socket.close(); } catch { /* It is already unusable. */ }
    }
  }

  private retry() {
    this.generation += 1;
    this.connecting = false;
    this.closeSocket();
    if (!this.running || this.timer) return;
    this.options.onStatus('reconnecting');
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, retryDelay(this.attempt++));
  }

  private async connect() {
    if (!this.running || this.connecting || this.socket) return;
    this.connecting = true;
    const generation = ++this.generation;
    this.options.onStatus(this.attempt ? 'reconnecting' : 'connecting');
    // Covers both a stalled token lookup and a handshake that never finishes.
    this.deadline = setTimeout(() => this.retry(), 10_000);
    try {
      const token = await this.options.getToken();
      if (!this.running || generation !== this.generation) return;
      if (!token) {
        this.connecting = false;
        this.closeSocket();
        this.options.onStatus('unavailable');
        return;
      }
      const socket = this.options.createSocket(`${this.options.url}?token=${encodeURIComponent(token)}`);
      this.socket = socket;
      const current = () => this.running && generation === this.generation && socket === this.socket;
      socket.onopen = () => {
        if (!current()) return;
        if (this.deadline) clearTimeout(this.deadline);
        this.deadline = null;
        this.connecting = false;
        this.stable = setTimeout(() => { this.attempt = 0; }, 10_000);
        this.options.onStatus('connected');
        this.options.onOpen();
      };
      socket.onmessage = event => { if (current()) this.options.onMessage(String(event.data)); };
      socket.onerror = () => { if (current()) this.retry(); };
      socket.onclose = event => {
        if (!current()) return;
        if ([4001, 4003, 4004].includes(event.code)) {
          this.connecting = false;
          this.closeSocket();
          this.options.onStatus('unavailable');
        } else this.retry();
        this.options.onClose?.(event.code);
      };
    } catch {
      if (this.running && generation === this.generation) this.retry();
    }
  }
}
