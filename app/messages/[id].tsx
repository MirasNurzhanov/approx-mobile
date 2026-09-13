import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { useDirectMessages } from '@/hooks/useDirectMessages';
import { CHAT_SOCKET_LABEL, type ChatSocketStatus } from '@/services/chatSocket';
import type { DirectMessage as Message } from '@/services/directMessages';
import { decodeStoryReply } from '@/services/storyReply';
import { announce } from '@/hooks/useReduceMotion';
import { useContentActions } from '@/components/ContentActions';
import { GlassIconButton, GlassSurface } from '@/components/ui/GlassSurface';
import { usePermissionPrimer } from '@/components/PermissionPrimer';
import { Avatar } from '@/components/ui/Avatar';
import { IconMore } from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { PresenceDot } from '@/components/PresenceDot';
import type { Presence } from '@/services/presence';

/** Slow on purpose: one request, on one focused screen. */
const PRESENCE_POLL_MS = 30_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** What a screen reader says when a message arrives. A message only changes the
 *  list — there is no focus change — so nothing is announced unless we do it.
 *
 *  At module scope for the same reason as `isBlank`: the ternary and `??` this
 *  needs are "value blocks" the compiler cannot lower inside a `try`. */
function arrivalNotice(m: Message, username?: string): string {
  if (m.text) return `${username ?? 'New message'}: ${m.text}`;
  return `${username ?? 'Someone'} sent a photo`;
}

// ─── Chat pieces ──────────────────────────────────────────────────────────────

function MessagesHeader({
  username, otherUserPicture, presence, socketStatus, top, onBack, onOpenProfile, onMenu,
}: {
  username?: string;
  otherUserPicture?: string | null;
  presence?: Presence | null;
  socketStatus: ChatSocketStatus;
  top: number;
  onBack: () => void;
  onOpenProfile: () => void;
  onMenu: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.header, { paddingTop: top + 6 }]}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={24} color={colors.t1} />
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.headerProfile, pressed && { opacity: 0.7 }]}
        onPress={onOpenProfile}
        accessibilityRole="button"
        accessibilityLabel={`View ${username ?? 'user'}'s profile`}
      >
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
          {socketStatus !== 'connected' && (
            <Text style={styles.statusText}>{CHAT_SOCKET_LABEL[socketStatus]}</Text>
          )}
        </View>
      </Pressable>

      {/* Report / Block, reachable from the conversation itself. A private
          message is still user-generated content, and telling somebody to go
          and find the sender's profile first is the kind of friction that
          means abuse goes unreported. */}
      <Pressable
        onPress={onMenu}
        hitSlop={12}
        style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={`Report or block ${username ?? 'this person'}`}
      >
        <IconMore size={20} color={colors.t1} />
      </Pressable>
    </View>
  );
}

/** One bubble: a story reply, a photo, or plain text. */
function MessageBubble({ item, isMine, onRetry }: { item: Message; isMine: boolean; onRetry: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
                contentFit="cover"
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
          <Image source={{ uri: item.image }} style={styles.bubbleImage} contentFit="cover" />
        ) : (
          <Text style={isMine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>
            {item.text}
          </Text>
        )}
        <Text style={[styles.bubbleTime, isMine ? styles.bubbleTimeMine : styles.bubbleTimeTheirs]}>
          {fmtTime(item.created_at)}{item.pending ? ' · Sending…' : ''}
        </Text>
        {item.failed && (
          <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry message">
            <Text style={isMine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>{item.failure ?? 'Not confirmed'} · Tap to retry</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function MessagesInput({ text, canSend, bottom, onChangeText, onSend, onCamera, onAttach }: {
  text: string;
  canSend: boolean;
  bottom: number;
  onChangeText: (t: string) => void;
  onSend: () => void;
  onCamera: () => void;
  onAttach: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <GlassSurface
      style={[styles.inputBar, { paddingBottom: bottom + 8 }]}
      // Heavier than a floating control: this sits over scrolling messages, and
      // a light wash would let text slide visibly under the composer.
      opacity={0.86}
    >
      <GlassIconButton
        style={styles.attachBtn}
        onPress={onCamera}
        hitSlop={4}
        tone="surface2"
        accessibilityRole="button"
        accessibilityLabel="Take a photo"
      >
        <Ionicons name="camera-outline" size={20} color={colors.t3} />
      </GlassIconButton>

      <GlassIconButton
        style={styles.attachBtn}
        onPress={onAttach}
        hitSlop={4}
        tone="surface2"
        accessibilityRole="button"
        accessibilityLabel="Choose a photo"
      >
        <Ionicons name="image-outline" size={20} color={colors.t3} />
      </GlassIconButton>

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={onChangeText}
        placeholder="Message…"
        placeholderTextColor={colors.t3}
        multiline
        maxLength={2000}
      />

      {/* Glass only while it is the *inactive* state. Once there is something
          to send this is the one filled control on the bar, and a filled
          control that is also translucent stops reading as the primary action
          — so the active style paints over the backdrop deliberately. */}
      <GlassIconButton
        style={[styles.sendBtn, canSend && styles.sendBtnActive]}
        onPress={onSend}
        disabled={!canSend}
        hitSlop={8}
        tone="surface2"
        accessibilityRole="button"
        accessibilityLabel="Send message"
        accessibilityState={{ disabled: !canSend }}
      >
        <Ionicons name="send" size={16} color={canSend ? colors.bg : colors.t3} />
      </GlassIconButton>
    </GlassSurface>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function MessagesScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const { id, username } = useLocalSearchParams<{ id: string; username: string }>();
  const { top, bottom } = useSafeAreaInsets();

  const [text, setText] = useState('');
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [otherUserPicture, setOtherUserPicture] = useState<string | null>(null);
  const [presence, setPresence] = useState<Presence | undefined>(undefined);
  const { ensure: ensurePermission, primer } = usePermissionPrimer();
  const { present, sheets } = useContentActions();

  const currentUserIdRef = useRef<number | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const { messages, setMessages, loading, loadingOlder, nextBefore, historyError,
    refresh, loadOlder, status: socketStatus, sendText: submitText, retry, onViewableItemsChanged,
  } = useDirectMessages(id, currentUserId, message => announce(arrivalNotice(message, username)));



  useEffect(() => {
    api.get<{ id: number | string }>('/api/users/profile/')
      .then((r) => { currentUserIdRef.current = Number(r.data.id); setCurrentUserId(Number(r.data.id)); })
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
  }, [id]);

  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (lastMessageId) {
      // Cleared on re-run and on unmount: messages can land faster than the
      // 50ms delay, and every superseded timer would otherwise still fire.
      const t = setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      return () => clearTimeout(t);
    }
  }, [lastMessageId]);

  function sendText() {
    if (submitText(text)) setText('');
  }

  function sendImage(asset: ImagePicker.ImagePickerAsset) {
    const tempId = `temp-img-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: tempId, image: asset.uri, sender_id: currentUserIdRef.current ?? -1, created_at: new Date().toISOString(), pending: true },
    ]);

    const form = new FormData();
    form.append('image', {
      uri: asset.uri,
      name: asset.uri.split('/').pop() ?? 'photo.jpg',
      type: asset.mimeType ?? 'image/jpeg',
    } as any);
    api.post(`/api/friends/messages/${id}/`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).catch(() => {});
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

  const canSend = text.trim().length > 0 && currentUserId !== null;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <MessagesHeader
        username={username}
        otherUserPicture={otherUserPicture}
        presence={presence}
        socketStatus={socketStatus}
        top={top}
        onBack={() => router.back()}
        onOpenProfile={() => router.push({ pathname: '/profile/[id]', params: { id, username: username ?? '' } })}
        onMenu={() => present({
          target: 'user',
          targetId: Number(id),
          subject: `@${username ?? 'this person'}`,
          authorId: Number(id),
          authorUsername: username,
          // Blocking somebody you are in a conversation with should close it.
          onRemoved: () => router.back(),
        })}
      />

      {historyError && (
        <Pressable onPress={() => { void refresh(); }} accessibilityRole="button">
          <Text style={styles.statusText}>{historyError}</Text>
        </Pressable>
      )}
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
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          ListHeaderComponent={nextBefore !== null ? (
            <Pressable disabled={loadingOlder} onPress={() => { void loadOlder(); }} accessibilityRole="button">
              <Text style={styles.statusText}>{loadingOlder ? 'Loading…' : 'Load older messages'}</Text>
            </Pressable>
          ) : null}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={10}
          windowSize={5}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No messages yet — say hello!</Text>
            </View>
          }
          renderItem={({ item }) => (
            <MessageBubble item={item} isMine={item.sender_id === currentUserIdRef.current} onRetry={() => { void retry(item); }} />
          )}
        />
      )}

      <MessagesInput
        text={text}
        canSend={canSend}
        bottom={bottom}
        onChangeText={setText}
        onSend={sendText}
        onCamera={handleCamera}
        onAttach={handleAttach}
      />
      {primer}
      {sheets}
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
  headerProfile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  menuBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
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
  // No `backgroundColor` on the three below: the fill is drawn behind their
  // content by `GlassBackdrop`, and a background here would sit on top of the
  // blur and hide it. See components/ui/GlassSurface.
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtnActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
});
