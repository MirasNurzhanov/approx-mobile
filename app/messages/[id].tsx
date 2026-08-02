import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { decodeStoryReply } from '@/services/storyReply';
import { announce } from '@/hooks/useReduceMotion';
import { usePermissionPrimer } from '@/components/PermissionPrimer';
import { Avatar } from '@/components/ui/Avatar';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { PresenceDot } from '@/components/PresenceDot';
import type { Presence } from '@/services/presence';

/** Slow on purpose: one request, on one focused screen. */
const PRESENCE_POLL_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  text?: string;
  image?: string;
  sender_id: number;
  created_at: string;
  pending?: boolean;
}

interface RawMessage {
  id?: string | number;
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
  [key: string]: unknown;
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

function extractSenderId(raw: RawMessage): number {
  if (raw.sender_id != null) return Number(raw.sender_id);
  if (typeof raw.sender === 'number') return raw.sender;
  if (typeof raw.sender === 'string') return Number(raw.sender);
  if (raw.sender && typeof raw.sender === 'object') return Number(raw.sender.id);
  return -1;
}

function extractText(raw: RawMessage): string | undefined {
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { id, username } = useLocalSearchParams<{ id: string; username: string }>();
  const { top, bottom } = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [wsReady, setWsReady] = useState(false);
  const [otherUserPicture, setOtherUserPicture] = useState<string | null>(null);
  const [presence, setPresence] = useState<Presence | undefined>(undefined);
  const { ensure: ensurePermission, primer } = usePermissionPrimer();

  const currentUserIdRef = useRef<number | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const flatListRef = useRef<FlatList>(null);



  useEffect(() => {
    console.log("[Messages] fetching current user profile..")
    api.get<{ id: number | string }>('/api/users/profile/')
      .then((r) => {console.log("[Messages] User's current id:" , r.data.id) ,  currentUserIdRef.current = Number(r.data.id); })
      .catch(() => {});

    // Presence rides the profile fetch this screen already makes. Refreshed on
    // a slow timer while the thread is open — this is the one screen where
    // "are they there right now" is the actual question being asked, and it is
    // a single request on a single focused screen rather than a background
    // loop competing with the map's.
    const load = () =>
      api.get<{ profile_picture?: string; presence?: Presence }>(`/api/users/profile/${id}/`)
        .then((r) => {
          setOtherUserPicture(r.data.profile_picture ?? null);
          // undefined, not null: absent means "not ours to show", and
          // PresenceDot renders nothing for it.
          setPresence(r.data.presence);
        })
        .catch(() => {});

    load();
    const timer = setInterval(load, PRESENCE_POLL_MS);
    return () => clearInterval(timer);
  }, [id]);

  useEffect(() => {
    AsyncStorage.setItem('chat_last_seen', new Date().toISOString());
    const timer = setTimeout(() => {
      api.post(`/api/friends/messages/${id}/read/`).catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [id]);

  useEffect(() => {
    api.get<RawMessage[]>(`/api/friends/messages/${id}/`)
      .then((r) => {
        const raw = Array.isArray(r.data) ? r.data : [];
        setMessages(raw.map((m) => normalise(m)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

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
          if (!incoming.text && !incoming.image) return;

          // A message arriving only changes the list — there is no focus
          // change, so a screen reader says nothing unless we announce it.
          if (incoming.sender_id !== currentUserIdRef.current) {
            announce(
              incoming.text
                ? `${username ?? 'New message'}: ${incoming.text}`
                : `${username ?? 'Someone'} sent a photo`,
            );
          }

          setMessages((prev) => {
            if (incoming.id && prev.some((m) => m.id === incoming.id && !m.pending)) return prev;
            const isFromMe = incoming.sender_id === currentUserIdRef.current;
            if (isFromMe) {
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

      socket.onclose = () => { if (active) setWsReady(false); };
      socket.onerror = () => { if (active) setWsReady(false); };
    }

    connect();
    return () => {
      active = false;
      ws.current?.close();
      ws.current = null;
    };
  }, [id]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length]);

  function sendText() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');

    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ content: trimmed }));
    } else {
      api.post<RawMessage>(`/api/friends/messages/${id}/`, { content: trimmed })
        .then((r) => setMessages((prev) => [...prev, normalise(r.data)]))
        .catch(() => {});
    }
  }

  function sendImage(asset: ImagePicker.ImagePickerAsset) {
    const tempId = `temp-img-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: tempId, image: asset.uri, sender_id: currentUserIdRef.current ?? -1, created_at: new Date().toISOString(), pending: true },
    ]);

    const formData = new FormData();
    formData.append('image', { uri: asset.uri, type: asset.mimeType ?? 'image/jpeg', name: 'attachment.jpg' } as any);
    api.post(`/api/friends/messages/${id}/`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).catch(() => {});
  }

  async function handleAttach() {
    // The system picker needs no permission; asking would spend a prompt for
    // nothing. See app/permissions.tsx.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled) return;
    sendImage(result.assets[0]);
  }

  async function handleCamera() {
    // Explains itself first, and offers a route to Settings if the camera was
    // refused earlier — previously this returned silently and the button just
    // appeared broken.
    if (!(await ensurePermission('camera'))) return;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled) return;
    sendImage(result.assets[0]);
  }

  const canSend = text.trim().length > 0;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </Pressable>

        <Avatar
          uri={otherUserPicture}
          name={username ?? 'C'}
          size="sm"
          ringColor={colors.t3}
          presence={presence}
        />

        <View style={styles.headerInfo}>
          <View style={styles.headerNameRow}>
            <Text style={styles.headerName} numberOfLines={1}>{username ?? 'Chat'}</Text>
          </View>
          {/* Two different facts, previously conflated: this line is the other
              person's presence, and the one below is our own socket. The old
              green dot was driven by `wsReady` — it lit up when *we* connected,
              regardless of whether they were anywhere near the app. */}
          {presence ? (
            <PresenceDot presence={presence} size={7} withText />
          ) : null}
          {!wsReady && (
            <Text style={styles.statusText}>Reconnecting…</Text>
          )}
        </View>
      </View>

      {/* Messages */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.teal} size="large" />
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
            const storyReply = decodeStoryReply(item.text);
            return (
              <View style={[styles.row, isMine ? styles.rowRight : styles.rowLeft]}>
                <View
                  style={[
                    styles.bubble,
                    isMine ? styles.bubbleMine : styles.bubbleTheirs,
                    item.pending && styles.bubblePending,
                  ]}
                >
                  {storyReply ? (
                    <>
                      <Text style={isMine ? styles.storyReplyLabelMine : styles.storyReplyLabelTheirs}>
                        {isMine ? 'You replied to their story' : 'Replied to your story'}
                      </Text>
                      {storyReply.image ? (
                        <Image
                          source={{ uri: storyReply.image }}
                          style={styles.storyReplyImage}
                          resizeMode="cover"
                        />
                      ) : null}
                      {storyReply.excerpt ? (
                        <View style={[styles.storyReplyQuote, isMine ? styles.storyReplyQuoteMine : styles.storyReplyQuoteTheirs]}>
                          <Text
                            style={isMine ? styles.storyReplyQuoteTextMine : styles.storyReplyQuoteTextTheirs}
                            numberOfLines={2}
                          >
                            “{storyReply.excerpt}”
                          </Text>
                        </View>
                      ) : null}
                      <Text style={isMine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>
                        {storyReply.comment}
                      </Text>
                    </>
                  ) : item.image ? (
                    <Image source={{ uri: item.image }} style={styles.bubbleImage} resizeMode="cover" />
                  ) : (
                    <Text style={isMine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>
                      {item.text}
                    </Text>
                  )}
                  <Text style={[styles.bubbleTime, isMine ? styles.bubbleTimeMine : styles.bubbleTimeTheirs]}>
                    {fmtTime(item.created_at)}{item.pending ? ' ·' : ''}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Input bar */}
      <View style={[styles.inputBar, { paddingBottom: bottom + 8 }]}>
        <Pressable style={styles.attachBtn} onPress={handleCamera} hitSlop={4}>
          <Ionicons name="camera-outline" size={20} color={colors.t3} />
        </Pressable>

        <Pressable style={styles.attachBtn} onPress={handleAttach} hitSlop={4}>
          <Ionicons name="image-outline" size={20} color={colors.t3} />
        </Pressable>

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor={colors.t3}
          multiline
          maxLength={2000}
        />

        <Pressable
          style={[styles.sendBtn, canSend && styles.sendBtnActive]}
          onPress={sendText}
          disabled={!canSend}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
        >
          <Ionicons name="send" size={16} color={canSend ? colors.bg : colors.t3} />
        </Pressable>
      </View>
      {primer}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  backBtn: { padding: 4 },
  headerInfo: { flex: 1, gap: 2 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerName: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 17,
    color: colors.t1,
    flexShrink: 1,
  },
  statusText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.t3,
  },

  // Loading / empty
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { fontFamily: fonts.body, color: colors.t3, fontSize: 14 },

  // List
  listContent: { paddingHorizontal: 14, paddingVertical: 16, gap: 6, flexGrow: 1 },

  // Rows
  row: { flexDirection: 'row' },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },

  // Bubbles
  bubble: {
    maxWidth: '75%',
    borderRadius: radius.l,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 7,
    gap: 4,
  },
  bubbleMine: {
    backgroundColor: colors.teal,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubblePending: { opacity: 0.55 },

  bubbleTextMine: {
    fontFamily: fonts.body,
    color: '#04211D',
    fontSize: 15,
    lineHeight: 21,
  },
  bubbleTextTheirs: {
    fontFamily: fonts.body,
    color: colors.t1,
    fontSize: 15,
    lineHeight: 21,
  },
  bubbleTime: {
    fontSize: 10,
    fontFamily: fonts.body,
    alignSelf: 'flex-end',
  },
  bubbleTimeMine: { color: colors.tealTint },
  bubbleTimeTheirs: { color: colors.t3 },

  bubbleImage: {
    width: 210,
    height: 210,
    borderRadius: radius.m,
  },

  // Story-reply bubbles
  storyReplyLabelMine: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(4,33,29,0.7)',
  },
  storyReplyLabelTheirs: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: colors.t3,
  },
  storyReplyImage: {
    width: 180,
    height: 220,
    borderRadius: radius.m,
  },
  storyReplyQuote: {
    borderLeftWidth: 2,
    paddingLeft: 8,
  },
  storyReplyQuoteMine: { borderLeftColor: 'rgba(4,33,29,0.4)' },
  storyReplyQuoteTheirs: { borderLeftColor: colors.border },
  storyReplyQuoteTextMine: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontStyle: 'italic',
    color: 'rgba(4,33,29,0.8)',
  },
  storyReplyQuoteTextTheirs: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.t2,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  attachBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    backgroundColor: colors.surface2,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    fontFamily: fonts.body,
    color: colors.t1,
    fontSize: 15,
    lineHeight: 20,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtnActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
});
