import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Speedometer } from '@/components/Speedometer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { api } from '@/services/api';
import { triggerNearbyRefresh } from '@/services/nearbyRefresh';
import { storyReplyPreview } from '@/services/storyReply';
import { useScrollHandler } from '@/hooks/useScrollHandler';
import { colors, fonts, radius } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab = 'pending' | 'connected' | 'friends' | 'blocked';

interface UserSummary {
  id: number;
  username: string;
  last_message?: string;
  last_message_at?: string;
  unread_count?: number;
  profile_picture?: string;
}

interface FriendList {
  connections: UserSummary[];
  friends: UserSummary[];
}

interface PendingRequest {
  id: number;
  from_user?: UserSummary;
  sender?: UserSummary;
  message?: string;
  created_at?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

// ─── Pending card ─────────────────────────────────────────────────────────────
interface PendingCardProps {
  request: PendingRequest;
  onAccept: (id: number) => void;
  onDecline: (id: number) => void;
}

function PendingCard({ request, onAccept, onDecline }: PendingCardProps) {
  const user = request.sender ?? request.from_user;
  if (!user) return null;
  return (
    <Card>
      <View style={styles.cardRow}>
        <Avatar uri={user.profile_picture} name={user.username} size="md" ringColor={colors.t3} />
        <View style={styles.cardBody}>
          <Text style={styles.cardName}>{user.username}</Text>
          <Text style={styles.cardSub}>Sent you a Hi 👋</Text>
          <View style={styles.cardActions}>
            <Button
              label="Accept"
              variant="primary"
              size="sm"
              onPress={() => onAccept(request.id)}
            />
            <Button
              label="Decline"
              variant="ghost"
              size="sm"
              onPress={() => onDecline(request.id)}
            />
          </View>
        </View>
      </View>
    </Card>
  );
}

// ─── User card (Connected / Friend) ──────────────────────────────────────────
interface UserCardProps {
  user: UserSummary;
  type: 'connected' | 'friend';
  requestSent?: boolean;
  onMessage: (user: UserSummary) => void;
  onAddFriend?: (user: UserSummary) => void;
  onMenu: (user: UserSummary, type: 'connected' | 'friend') => void;
}

function UserCard({ user, type, requestSent, onMessage, onAddFriend, onMenu }: UserCardProps) {
  const ringColor = type === 'connected' ? colors.orange : colors.blue;
  const hasMessage = !!user.last_message;
  const unread = user.unread_count ?? 0;

  return (
    <Card onPress={() => onMessage(user)}>
      <View style={styles.cardRow}>
        <Avatar uri={user.profile_picture} name={user.username} size="md" ringColor={ringColor} />
        <View style={styles.cardBody}>
          <View style={styles.cardNameRow}>
            <Text style={styles.cardName}>{user.username}</Text>
            {user.last_message_at ? (
              <Text style={styles.cardTime}>{fmtTime(user.last_message_at)}</Text>
            ) : null}
          </View>
          <View style={styles.cardSubRow}>
            <Text
              style={[styles.cardSub, !hasMessage && styles.cardSubEmpty]}
              numberOfLines={1}
            >
              {hasMessage ? storyReplyPreview(user.last_message) : 'No messages yet'}
            </Text>
            {unread > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </View>
          {type === 'connected' && onAddFriend && (
            <View style={styles.cardActions}>
              <Button
                label={requestSent ? 'Request Sent ✓' : 'Add Friend'}
                variant={requestSent ? 'secondary' : 'ghost'}
                size="sm"
                disabled={requestSent}
                onPress={() => { if (!requestSent) onAddFriend(user); }}
              />
            </View>
          )}
        </View>
        <Pressable
          style={styles.menuBtn}
          onPress={() => onMenu(user, type)}
          hitSlop={10}
        >
          <Ionicons name="ellipsis-vertical" size={16} color={colors.t3} />
        </Pressable>
      </View>
    </Card>
  );
}

// ─── Blocked card ─────────────────────────────────────────────────────────────
interface BlockedCardProps {
  user: UserSummary;
  onUnblock: (user: UserSummary) => void;
}

function BlockedCard({ user, onUnblock }: BlockedCardProps) {
  return (
    <Card style={styles.cardBlocked}>
      <View style={styles.cardRow}>
        <Avatar uri={user.profile_picture} name={user.username} size="md" ringColor={colors.t3} />
        <View style={styles.cardBody}>
          <Text style={[styles.cardName, styles.cardNameBlocked]}>{user.username}</Text>
          <Text style={styles.cardSub}>Blocked</Text>
        </View>
        <Button label="Unblock" variant="ghost" size="sm" onPress={() => onUnblock(user)} />
      </View>
    </Card>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ChatScreen() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const scrollProps = useScrollHandler();

  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [friendList, setFriendList] = useState<FriendList>({ connections: [], friends: [] });
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [blocked, setBlocked] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sentRequestIds, setSentRequestIds] = useState<Set<number>>(new Set());

  const fetchUnreadBreakdown = useCallback(async () => {
    try {
      const res = await api.get<unknown>('/api/friends/messages/unread/breakdown/');
      const data = res.data;
      // Accept { [userId]: count } or [{ user_id, count }]
      const countMap = new Map<number, number>();
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
          countMap.set(Number(k), Number(v) || 0);
        }
      } else if (Array.isArray(data)) {
        for (const entry of data as any[]) {
          const uid = entry.user_id ?? entry.id;
          if (uid != null) countMap.set(Number(uid), Number(entry.count ?? entry.unread_count) || 0);
        }
      }
      if (countMap.size === 0) return;
      setFriendList((prev) => ({
        connections: prev.connections.map((u) =>
          countMap.has(u.id) ? { ...u, unread_count: countMap.get(u.id) } : u,
        ),
        friends: prev.friends.map((u) =>
          countMap.has(u.id) ? { ...u, unread_count: countMap.get(u.id) } : u,
        ),
      }));
    } catch {}
  }, []);

  const fetchAll = useCallback(async () => {
    const [listRes, pendingRes, blockedRes] = await Promise.allSettled([
      api.get<FriendList>('/api/friends/list/'),
      api.get<PendingRequest[]>('/api/friends/requests/'),
      api.get<UserSummary[]>('/api/friends/blocked/'),
    ]);
    if (listRes.status === 'fulfilled') {
      const data = listRes.value.data;
      setFriendList({
        connections: data.connections ?? [],
        friends:     data.friends     ?? [],
      });
    }
    if (pendingRes.status === 'fulfilled') {
      const raw = pendingRes.value.data;
      console.log('[Chat] pending requests raw:', JSON.stringify(raw));
      setPending(Array.isArray(raw) ? raw : []);
    }
    if (blockedRes.status === 'fulfilled') {
      setBlocked(Array.isArray(blockedRes.value.data) ? blockedRes.value.data : []);
    }
  }, []);

  useEffect(() => {
    AsyncStorage.setItem('chat_last_seen', new Date().toISOString());
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useFocusEffect(useCallback(() => {
    fetchAll();
    fetchUnreadBreakdown();
    pollRef.current = setInterval(fetchAll, 5_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchAll, fetchUnreadBreakdown]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const friendIds = new Set(friendList.friends.map((f) => f.id));
  const connections = friendList.connections.filter((c) => !friendIds.has(c.id));

  // ── Pending ────────────────────────────────────────────────────────
  function handleAccept(id: number) {
    setPending((prev) => prev.filter((r) => r.id !== id));
    api.post(`/api/friends/hi/${id}/accept/`)
      .then(() =>
        api.get<FriendList>('/api/friends/list/').then((r) =>
          setFriendList({
            connections: r.data.connections ?? [],
            friends:     r.data.friends     ?? [],
          }),
        ),
      )
      .catch((e) => console.log('[Accept Hi] error:', e?.response?.status));
  }

  function handleDecline(id: number) {
    setPending((prev) => prev.filter((r) => r.id !== id));
    api.post(`/api/friends/hi/${id}/decline/`)
      .catch((e) => console.log('[Decline] error:', e?.response?.status));
    triggerNearbyRefresh();
  }

  // ── Block / remove ─────────────────────────────────────────────────
  function removeFromLists(userId: number) {
    setFriendList((prev) => ({
      connections: prev.connections.filter((u) => u.id !== userId),
      friends:     prev.friends.filter((u) => u.id !== userId),
    }));
  }

  function handleBlock(user: UserSummary) {
    removeFromLists(user.id);
    setBlocked((prev) => (prev.some((u) => u.id === user.id) ? prev : [user, ...prev]));
    api.post(`/api/friends/block/${user.id}/`).catch(() => {});
  }

  function handleRemoveFriend(user: UserSummary) {
    setFriendList((prev) => ({ ...prev, friends: prev.friends.filter((u) => u.id !== user.id) }));
    api.delete(`/api/friends/${user.id}/remove/`).catch(() => {});
  }

  function handleRemoveConnection(user: UserSummary) {
    setFriendList((prev) => ({ ...prev, connections: prev.connections.filter((u) => u.id !== user.id) }));
    api.delete(`/api/friends/${user.id}/remove/`).catch(() => {});
  }

  function handleUnblock(user: UserSummary) {
    setBlocked((prev) => prev.filter((u) => u.id !== user.id));
    api.post(`/api/friends/unblock/${user.id}/`).catch(() => {});
  }

  function handleAddFriend(user: UserSummary) {
    api.post(`/api/friends/request/${user.id}/`)
      .then(() => setSentRequestIds((prev) => new Set(prev).add(user.id)))
      .catch((e) => console.log('[Friend Request] error:', e?.response?.status));
  }

  function openMenu(user: UserSummary, type: 'connected' | 'friend') {
    const removeLabel = type === 'friend' ? 'Remove Friend' : 'Remove Connection';
    const removeAction = type === 'friend' ? () => handleRemoveFriend(user) : () => handleRemoveConnection(user);
    Alert.alert(user.username, undefined, [
      { text: removeLabel, style: 'destructive', onPress: removeAction },
      { text: 'Block User', style: 'destructive', onPress: () => handleBlock(user) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function handleMessage(user: UserSummary) {
    setFriendList((prev) => ({
      connections: prev.connections.map((u) => u.id === user.id ? { ...u, unread_count: 0 } : u),
      friends:     prev.friends.map((u)     => u.id === user.id ? { ...u, unread_count: 0 } : u),
    }));
    router.push({ pathname: '/messages/[id]', params: { id: user.id, username: user.username } } as any);
  }

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'pending',   label: 'Pending',   count: pending.length },
    { key: 'connected', label: 'Connected', count: connections.length },
    { key: 'friends',   label: 'Friends',   count: friendList.friends.length },
    { key: 'blocked',   label: 'Blocked',   count: blocked.length },
  ];

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.teal}
      colors={[colors.teal]}
    />
  );

  return (
    <View style={[styles.container, { paddingTop: top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
      </View>

      {/* Tab bar — underline style */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {tab.label}
              </Text>
              {tab.count > 0 && (
                <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                  <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>
                    {tab.count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : activeTab === 'pending' ? (
        <FlatList
          data={pending}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <PendingCard request={item} onAccept={handleAccept} onDecline={handleDecline} />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState message={'No pending requests\nWave at people on the map'} />}
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        />
      ) : activeTab === 'connected' ? (
        <FlatList
          data={connections}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <UserCard
              user={item}
              type="connected"
              requestSent={sentRequestIds.has(item.id)}
              onMessage={handleMessage}
              onAddFriend={handleAddFriend}
              onMenu={openMenu}
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState message={'No connections yet\nAccept incoming Hi requests'} />}
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        />
      ) : activeTab === 'friends' ? (
        <FlatList
          data={friendList.friends}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <UserCard
              user={item}
              type="friend"
              onMessage={handleMessage}
              onMenu={openMenu}
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState message={'No friends yet\nUpgrade a connection to friend'} />}
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        />
      ) : (
        <FlatList
          data={blocked}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <BlockedCard user={item} onUnblock={handleUnblock} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState message="No blocked users" />}
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        />
      )}

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // Header
  header: { paddingHorizontal: 20, paddingBottom: 8, paddingTop: 4 },
  headerTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 26,
    color: colors.t1,
  },

  // Tab bar — underline style
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: colors.teal },
  tabLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: colors.t3,
  },
  tabLabelActive: { color: colors.t1, fontWeight: '600' },
  tabBadge: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  tabBadgeActive: { backgroundColor: colors.teal },
  tabBadgeText: {
    fontFamily: fonts.body,
    color: colors.t3,
    fontSize: 10,
    fontWeight: '700',
  },
  tabBadgeTextActive: { color: colors.bg },

  // List
  list: { padding: 16, paddingBottom: 230, gap: 10 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Card internals
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardBody: { flex: 1, gap: 3 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardName: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: colors.t1,
  },
  cardNameBlocked: { color: colors.t3 },
  cardTime: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.t3,
  },
  cardSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardSub: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
    lineHeight: 18,
  },
  cardSubEmpty: { color: colors.t3, fontStyle: 'italic' },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 8 },

  // Unread badge
  unreadBadge: {
    backgroundColor: colors.red,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  unreadText: {
    fontFamily: fonts.body,
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },

  // Three-dots menu
  menuBtn: { alignSelf: 'flex-start', paddingLeft: 8, paddingTop: 2 },

  // Blocked dim
  cardBlocked: { opacity: 0.6 },

  // Empty state
  empty: { alignItems: 'center', paddingTop: 64 },
  emptyText: {
    fontFamily: fonts.body,
    color: colors.t3,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
});
