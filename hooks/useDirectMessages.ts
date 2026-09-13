import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type ViewToken } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { api } from '@/services/api';
import { catchUpHistory, failMessage, mergeMessages, newMessageId, type HistoryPage } from '@/services/chatHistory';
import { normaliseMessage, type DirectMessage, type RawDirectMessage } from '@/services/directMessages';
import { useChatSocket } from './useChatSocket';

export function useDirectMessages(otherId: string, currentUserId: number | null,
  onIncoming: (message: DirectMessage) => void) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const lifecycle = useRef(0);
  const latest = useRef<number | null>(null);
  const syncing = useRef(false);
  const syncAgain = useRef(false);
  const olderBusy = useRef(false);
  const sends = useRef(new Set<string>());
  const focused = useIsFocused();
  const readState = useRef({ focused, currentUserId, otherId });
  const lastRead = useRef(0);
  const visibleThrough = useRef(0);
  useEffect(() => { readState.current = { focused, currentUserId, otherId }; });

  const refresh = useCallback(async () => {
    if (syncing.current) { syncAgain.current = true; return; }
    syncing.current = true;
    const epoch = lifecycle.current;
    try {
      do {
        syncAgain.current = false;
        const boundary = latest.current;
        const result = await catchUpHistory<RawDirectMessage>(
          async before => (await api.get<HistoryPage<RawDirectMessage>>(
            `/api/friends/messages/${otherId}/`, { params: before ? { before } : {} },
          )).data,
          boundary, () => lifecycle.current === epoch,
        );
        if (!result || lifecycle.current !== epoch) return;
        const incoming = result.rows.map(normaliseMessage);
        latest.current = Math.max(latest.current ?? 0, ...incoming.map(row => Number(row.id)), 0);
        setMessages(previous => mergeMessages(previous, incoming));
        if (boundary === null) setNextBefore(result.firstPage.next_before);
        setHistoryError(null);
      } while (syncAgain.current && lifecycle.current === epoch);
    } catch {
      if (lifecycle.current === epoch) setHistoryError('Could not refresh messages. Tap to retry.');
    } finally {
      if (lifecycle.current === epoch) { syncing.current = false; setLoading(false); }
    }
  }, [otherId]);

  useEffect(() => {
    lifecycle.current += 1;
    latest.current = null;
    syncing.current = false;
    syncAgain.current = false;
    olderBusy.current = false;
    lastRead.current = 0;
    visibleThrough.current = 0;
    sends.current.clear();
    setMessages([]);
    setLoading(true);
    setLoadingOlder(false);
    setNextBefore(null);
    void refresh();
    return () => { lifecycle.current += 1; };
  }, [otherId, refresh]);

  const { status } = useChatSocket(`/ws/chat/${otherId}/`, {
    onOpen: () => { void refresh(); },
    onMessage: data => {
      let raw: RawDirectMessage;
      try { raw = JSON.parse(data); } catch { return; }
      if (!raw || typeof raw !== 'object') return;
      if (raw.type === 'error') {
        if (raw.client_id) setMessages(rows => failMessage(rows, raw.client_id!, raw.detail));
        return;
      }
      if (!raw.id) return;
      const incoming = normaliseMessage(raw);
      if (!incoming.text && !incoming.image) return;
      setMessages(rows => mergeMessages(rows, [incoming]));
      if (incoming.sender_id !== currentUserId) onIncoming(incoming);
    },
  });

  const loadOlder = useCallback(async () => {
    if (olderBusy.current || nextBefore === null) return;
    olderBusy.current = true;
    setLoadingOlder(true);
    const epoch = lifecycle.current;
    try {
      const response = await api.get<HistoryPage<RawDirectMessage>>(`/api/friends/messages/${otherId}/`, {
        params: { before: nextBefore },
      });
      if (epoch !== lifecycle.current) return;
      setMessages(rows => mergeMessages(rows, response.data.results.map(normaliseMessage)));
      setNextBefore(response.data.next_before);
      setHistoryError(null);
    } catch {
      if (epoch === lifecycle.current) setHistoryError('Could not load older messages. Try again.');
    } finally {
      if (epoch === lifecycle.current) { olderBusy.current = false; setLoadingOlder(false); }
    }
  }, [nextBefore, otherId]);

  async function deliver(message: DirectMessage) {
    const clientId = message.client_id;
    if (!clientId || sends.current.has(clientId)) return;
    const epoch = lifecycle.current;
    sends.current.add(clientId);
    setMessages(rows => rows.map(row => row.client_id === clientId
      ? { ...row, pending: true, failed: false } : row));
    try {
      // REST provides a correlated acknowledgement even if the socket is dead.
      // The server's unique client_id also makes a manual retry safe after a lost response.
      const response = await api.post<RawDirectMessage>(`/api/friends/messages/${otherId}/`, {
        content: message.text, client_id: clientId,
      }, { timeout: 15_000 });
      if (epoch !== lifecycle.current) return;
      const confirmed = normaliseMessage(response.data);
      setMessages(rows => mergeMessages(rows, [confirmed]));
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (epoch === lifecycle.current) setMessages(rows => failMessage(rows, clientId, detail));
    } finally {
      if (epoch === lifecycle.current) sends.current.delete(clientId);
    }
  }

  function sendText(text: string): boolean {
    if (!text.trim() || currentUserId === null) return false;
    const clientId = newMessageId();
    const message: DirectMessage = {
      id: `pending-${clientId}`, client_id: clientId, text: text.trim(),
      sender_id: currentUserId, created_at: new Date().toISOString(), pending: true,
    };
    setMessages(rows => [...rows, message]);
    void deliver(message);
    return true;
  }

  const acknowledgeVisible = useCallback(() => {
    const state = readState.current;
    const through = visibleThrough.current;
    if (!state.focused || AppState.currentState !== 'active' || through <= lastRead.current) return;
    const epoch = lifecycle.current;
    lastRead.current = through;
    void api.post(`/api/friends/messages/${state.otherId}/read/`, { through_id: through }).catch(() => {
      if (epoch === lifecycle.current && lastRead.current === through) lastRead.current = 0;
    });
  }, []);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<DirectMessage>[] }) => {
    visibleThrough.current = Math.max(0, ...viewableItems.filter(token => token.isViewable
      && token.item.sender_id === Number(readState.current.otherId) && !token.item.pending)
      .map(token => Number(token.item.id)).filter(Number.isFinite));
    acknowledgeVisible();
  }, [acknowledgeVisible]);
  useEffect(() => {
    if (focused) acknowledgeVisible();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') acknowledgeVisible();
    });
    return () => subscription.remove();
  }, [focused, acknowledgeVisible, status]);

  return { messages, setMessages, loading, loadingOlder, nextBefore, historyError,
    refresh, loadOlder, status, sendText, retry: deliver, onViewableItemsChanged };
}
