import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { BASE_URL } from '@/services/api';
import { ChatSocketConnection, type ChatSocketStatus } from '@/services/chatSocket';

export function useChatSocket(path: string, callbacks: {
  onMessage: (data: string) => void;
  onOpen: () => void;
  onClose?: (code: number) => void;
}) {
  const focused = useIsFocused();
  const [status, setStatus] = useState<ChatSocketStatus>('connecting');
  const callbackRef = useRef(callbacks);
  const connectionRef = useRef<ChatSocketConnection | null>(null);
  useEffect(() => { callbackRef.current = callbacks; });
  useEffect(() => {
    const connection = new ChatSocketConnection({
      url: `${BASE_URL.replace(/^http/, 'ws')}${path}`,
      getToken: () => AsyncStorage.getItem('access_token'),
      createSocket: url => new WebSocket(url),
      onStatus: setStatus,
      onMessage: data => callbackRef.current.onMessage(data),
      onOpen: () => callbackRef.current.onOpen(),
      onClose: code => callbackRef.current.onClose?.(code),
    });
    connectionRef.current = connection;
    const update = () => {
      if (focused && (AppState.currentState === 'active' || AppState.currentState == null)) connection.start();
      else connection.stop();
    };
    update();
    const subscription = AppState.addEventListener('change', state => {
      if (focused && state === 'active') connection.start();
      else connection.stop();
    });
    return () => {
      subscription.remove();
      connection.stop();
      connectionRef.current = null;
    };
  }, [path, focused]);
  const send = useCallback((data: string) => connectionRef.current?.send(data) ?? false, []);
  return { status, send };
}
