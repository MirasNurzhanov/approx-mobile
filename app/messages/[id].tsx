import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  text?: string;
  image?: string;
  sender_id: number;   // always normalised to a number
  created_at: string;
  pending?: boolean;
}

// Raw shape from API / WebSocket — sender can be an id or an object.
interface RawMessage {
  id?: string | number;
  // all plausible text field names from Django backends
  message?: string;
  text?: string;
  content?: string;
  body?: string;
  msg?: string;
  image?: string;
  sender_id?: number;
  sender?: number | { id: number; username?: string };
  timestamp?: string;
  created_at?: string;
  [key: string]: unknown; // catch-all so we can inspect unknown fields
}

const WS_BASE = 'wss://project-x-production-3261.up.railway.app';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// Resolves sender_id regardless of shape, always returning a number.
// Coerces strings to numbers so === comparisons never silently fail.
function extractSenderId(raw: RawMessage): number {
  if (raw.sender_id != null) return Number(raw.sender_id);
  if (typeof raw.sender === 'number') return raw.sender;
  if (typeof raw.sender === 'string') return Number(raw.sender);
  if (raw.sender && typeof raw.sender === 'object') return Number(raw.sender.id);
  return -1;
}

function extractText(raw: RawMessage): string | undefined {
  // content is the confirmed field name for this API.
  // The others are kept as fallbacks for history vs WS shape differences.
  const value = raw.content ?? raw.message ?? raw.text ?? raw.body ?? raw.msg;
  if (value != null) return String(value);
  return undefined;
}

function normalise(raw: RawMessage, fallbackId?: string): Message {
  return {
    id:         String(raw.id ?? fallbackId ?? Date.now()),
    text:       extractText(raw),
    image:      raw.image,
    sender_id:  extractSenderId(raw),
    created_at: raw.timestamp ?? raw.created_at ?? new Date().toISOString(),
  };
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function MessagesScreen() {
  const router = useRouter();
  const { id, username } = useLocalSearchParams<{ id: string; username: string }>();
  const { top, bottom } = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [wsReady, setWsReady] = useState(false);

  const currentUserIdRef = useRef<number | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const flatListRef = useRef<FlatList>(null);

  // ── Fetch current user id ────────────────────────────────────────────────
  useEffect(() => {
    api.get<{ id: number | string }>('/api/users/profile/')
      .then((r) => {
        // Profile returns { id } not { sender_id } — read it directly.
        const uid = Number(r.data.id);
        currentUserIdRef.current = uid;
        console.log('[Messages] current user id:', uid, '| raw value:', r.data.id, '| type:', typeof r.data.id);
      })
      .catch((e) => console.log('[Messages] profile fetch failed:', e?.response?.status));
  }, []);

  // ── Fetch message history ────────────────────────────────────────────────
  useEffect(() => {
    api.get<RawMessage[]>(`/api/friends/messages/${id}/`)
      .then((r) => {
        const raw = Array.isArray(r.data) ? r.data : [];
        setMessages(raw.map((m) => normalise(m)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // ── WebSocket ────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;

    async function connect() {
      const token = await AsyncStorage.getItem('access_token');
      if (!token || !active) return;

      const socket = new WebSocket(`${WS_BASE}/ws/chat/${id}/?token=${token}`);

      socket.onopen = () => {
        if (!active) { socket.close(); return; }
        ws.current = socket;
        setWsReady(true);
      };

      socket.onmessage = (event) => {
        try {
          const raw: RawMessage = JSON.parse(event.data);
          const incoming = normalise(raw);
          if (!incoming.text && !incoming.image) {
            // Not a chat message (e.g. presence/error event) — skip silently.
            console.log('[WS] skipped non-message event:', JSON.stringify(raw));
            return;
          }

          setMessages((prev) => {
            // Dedup: ignore if exact server id already exists (handles re-delivery)
            if (incoming.id && prev.some((m) => m.id === incoming.id && !m.pending)) {
              return prev;
            }

            const isFromMe = incoming.sender_id === currentUserIdRef.current;
            if (isFromMe) {
              // Replace the most-recent pending message with matching text.
              // Manual reverse loop — findLastIndex not guaranteed on all Hermes builds.
              for (let i = prev.length - 1; i >= 0; i--) {
                if (prev[i].pending && prev[i].text === incoming.text) {
                  const updated = [...prev];
                  updated[i] = incoming;
                  return updated;
                }
              }
            }

            return [...prev, incoming];
          });
        } catch {}
      };

      socket.onclose  = () => { if (active) setWsReady(false); };
      socket.onerror  = () => { if (active) setWsReady(false); };
    }

    connect();

    return () => {
      active = false;
      ws.current?.close();
      ws.current = null;
    };
  }, [id]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length]);

  // ── Send text ────────────────────────────────────────────────────────────
  function sendText() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');

    const wsOpen = ws.current?.readyState === WebSocket.OPEN;

    if (wsOpen) {
      // WS is live — send only, let the server broadcast deliver the message
      // back through onmessage so it appears exactly once.
      ws.current!.send(JSON.stringify({ content: trimmed }));
    } else {
      // No WS — POST and only add to the list if the request succeeded.
      api.post<RawMessage>(`/api/friends/messages/${id}/`, { content: trimmed })
        .then((r) => {
          setMessages((prev) => [...prev, normalise(r.data)]);
        })
        .catch(() => {});
    }
  }

  // ── Attach image ─────────────────────────────────────────────────────────
  async function handleAttach() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    const tempId = `temp-img-${Date.now()}`;

    // Optimistic local display
    setMessages((prev) => [
      ...prev,
      {
        id:         tempId,
        image:      asset.uri,
        sender_id:  currentUserIdRef.current ?? -1,
        created_at: new Date().toISOString(),
        pending:    true,
      },
    ]);

    // Upload via REST
    const formData = new FormData();
    formData.append('image', {
      uri:  asset.uri,
      type: asset.mimeType ?? 'image/jpeg',
      name: 'attachment.jpg',
    } as any);

    api.post(`/api/friends/messages/${id}/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).catch(() => {});
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#00b4a6" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>{username ?? 'Chat'}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, wsReady ? styles.statusOnline : styles.statusOffline]} />
            <Text style={styles.statusText}>{wsReady ? 'Connected' : 'Reconnecting…'}</Text>
          </View>
        </View>
      </View>

      {/* ── Messages ── */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="#00b4a6" size="large" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No messages yet — say hello!</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isMine = item.sender_id === currentUserIdRef.current;
            console.log(
              '[Messages] bubble | sender_id:', item.sender_id, typeof item.sender_id,
              '| currentUserId:', currentUserIdRef.current, typeof currentUserIdRef.current,
              '| isMine:', isMine,
            );
            return (
              <View style={[styles.row, isMine && styles.rowRight]}>
                <View
                  style={[
                    styles.bubble,
                    isMine ? styles.bubbleMine : styles.bubbleTheirs,
                    item.pending && styles.bubblePending,
                  ]}
                >
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={styles.bubbleImage} resizeMode="cover" />
                  ) : (
                    <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
                      {item.text}
                    </Text>
                  )}
                  <Text style={[styles.bubbleTime, isMine && styles.bubbleTimeMine]}>
                    {fmtTime(item.created_at)}
                    {item.pending ? '  ·' : ''}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* ── Input bar ── */}
      <View style={[styles.inputBar, { paddingBottom: bottom + 8 }]}>
        <TouchableOpacity style={styles.attachBtn} onPress={handleAttach} activeOpacity={0.7}>
          <Ionicons name="image-outline" size={22} color="#00b4a6" />
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor="#2e2e2e"
          multiline
          maxLength={2000}
        />

        <TouchableOpacity
          style={[styles.sendBtn, !text.trim() && styles.sendBtnOff]}
          onPress={sendText}
          disabled={!text.trim()}
          activeOpacity={0.8}
        >
          <Ionicons name="send" size={17} color={text.trim() ? '#0a0a0a' : '#2e2e2e'} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#141414',
    backgroundColor: '#0a0a0a',
  },
  backBtn: { padding: 4, marginRight: 4 },
  headerInfo: { flex: 1 },
  headerName: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusOnline: { backgroundColor: '#00b4a6' },
  statusOffline: { backgroundColor: '#2e2e2e' },
  statusText: { color: '#444', fontSize: 11 },

  // Loading / empty
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { color: '#2a2a2a', fontSize: 14 },

  // Message list
  listContent: { paddingHorizontal: 14, paddingVertical: 16, gap: 6, flexGrow: 1 },

  // Bubble row
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  rowRight: { justifyContent: 'flex-end' },

  // Bubble
  bubble: {
    maxWidth: '75%',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 7,
    gap: 3,
  },
  bubbleMine: {
    backgroundColor: '#00b4a6',
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderBottomLeftRadius: 4,
  },
  bubblePending: { opacity: 0.55 },

  bubbleText: { color: '#ffffff', fontSize: 15, lineHeight: 21 },
  bubbleTextMine: { color: '#ffffff' },
  bubbleTime: { color: 'rgba(255,255,255,0.5)', fontSize: 10, alignSelf: 'flex-end' },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.6)' },

  bubbleImage: {
    width: 210,
    height: 210,
    borderRadius: 14,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#141414',
    backgroundColor: '#0a0a0a',
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: '#111111',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 20,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#00b4a6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
});
