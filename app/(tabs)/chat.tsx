import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Speedometer } from '@/components/Speedometer';
import { api } from '@/services/api';

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab = 'pending' | 'connected' | 'friends' | 'blocked';

interface UserSummary {
  id: number;
  username: string;
  last_message?: string;
  last_message_at?: string;
}

interface FriendList {
  connections: UserSummary[];
  friends: UserSummary[];
}

interface PendingRequest {
  id: number;
  from_user: UserSummary;
  message?: string;
  created_at?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const ACCENT = {
  pending:   '#00b4a6',
  connected: '#FF9500',
  friend:    '#007AFF',
  blocked:   '#3a3a3a',
};

// ─── Shared sub-components ────────────────────────────────────────────────────
function Avatar({ name, borderColor }: { name: string; borderColor: string }) {
  return (
    <View style={[styles.avatar, { borderColor }]}>
      <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

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
  return (
    <View style={[styles.card, styles.cardPending]}>
      <Avatar name={request.from_user.username} borderColor={ACCENT.pending} />
      <View style={styles.cardBody}>
        <Text style={styles.cardName}>{request.from_user.username}</Text>
        <Text style={styles.cardSub}>Sent you a Hi 👋</Text>
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => onAccept(request.id)}
            activeOpacity={0.8}
          >
            <Text style={styles.btnPrimaryText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() => onDecline(request.id)}
            activeOpacity={0.8}
          >
            <Text style={styles.btnGhostText}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Connected / Friend card ──────────────────────────────────────────────────
interface UserCardProps {
  user: UserSummary;
  type: 'connected' | 'friend';
  onMessage: (user: UserSummary) => void;
  onAddFriend?: (user: UserSummary) => void;
  onMenu: (user: UserSummary, type: 'connected' | 'friend') => void;
}

function UserCard({ user, type, onMessage, onAddFriend, onMenu }: UserCardProps) {
  const borderColor = type === 'connected' ? ACCENT.connected : ACCENT.friend;
  const hasMessage = !!user.last_message;

  return (
    <TouchableOpacity style={styles.card} onPress={() => onMessage(user)} activeOpacity={0.85}>
      <Avatar name={user.username} borderColor={borderColor} />
      <View style={styles.cardBody}>
        <Text style={styles.cardName}>{user.username}</Text>
        <Text
          style={[styles.cardSub, !hasMessage && styles.cardSubEmpty]}
          numberOfLines={1}
        >
          {hasMessage ? user.last_message : 'No messages yet'}
        </Text>
        {type === 'connected' && onAddFriend && (
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={() => onAddFriend(user)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnGhostText}>Add Friend</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {/* Three-dots menu */}
      <TouchableOpacity
        style={styles.menuBtn}
        onPress={() => onMenu(user, type)}
        hitSlop={10}
      >
        <Text style={styles.menuDots}>⋮</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Blocked card ─────────────────────────────────────────────────────────────
interface BlockedCardProps {
  user: UserSummary;
  onUnblock: (user: UserSummary) => void;
}

function BlockedCard({ user, onUnblock }: BlockedCardProps) {
  return (
    <View style={[styles.card, styles.cardBlocked]}>
      <Avatar name={user.username} borderColor={ACCENT.blocked} />
      <View style={styles.cardBody}>
        <Text style={[styles.cardName, styles.cardNameBlocked]}>{user.username}</Text>
        <Text style={styles.cardSub}>Blocked</Text>
      </View>
      <TouchableOpacity
        style={[styles.btn, styles.btnGhost, { alignSelf: 'center' }]}
        onPress={() => onUnblock(user)}
        activeOpacity={0.8}
      >
        <Text style={styles.btnGhostText}>Unblock</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ChatScreen() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [friendList, setFriendList] = useState<FriendList>({ connections: [], friends: [] });
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [blocked, setBlocked] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchAll() {
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
      setPending(Array.isArray(pendingRes.value.data) ? pendingRes.value.data : []);
    }
    if (blockedRes.status === 'fulfilled') {
      setBlocked(Array.isArray(blockedRes.value.data) ? blockedRes.value.data : []);
    }
  }

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, []);

  // ── Connections tab shows only users NOT already in friends list ──
  const friendIds = new Set(friendList.friends.map((f) => f.id));
  const connections = friendList.connections.filter((c) => !friendIds.has(c.id));

  // ── Pending ───────────────────────────────────────────────────────
  function handleAccept(id: number) {
    setPending((prev) => prev.filter((r) => r.id !== id));
    api.post(`/api/friends/requests/${id}/accept/`)
      .then(() =>
        api.get<FriendList>('/api/friends/list/').then((r) =>
          setFriendList({
            connections: r.data.connections ?? [],
            friends:     r.data.friends     ?? [],
          }),
        ),
      )
      .catch(() => {});
  }

  function handleDecline(id: number) {
    setPending((prev) => prev.filter((r) => r.id !== id));
    api.post(`/api/friends/requests/${id}/decline/`).catch(() => {});
  }

  // ── Block / remove ───────────────────────────────────────────────
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
    setFriendList((prev) => ({
      ...prev,
      friends: prev.friends.filter((u) => u.id !== user.id),
    }));
    api.delete(`/api/friends/${user.id}/remove/`).catch(() => {});
  }

  function handleRemoveConnection(user: UserSummary) {
    setFriendList((prev) => ({
      ...prev,
      connections: prev.connections.filter((u) => u.id !== user.id),
    }));
    api.delete(`/api/friends/${user.id}/remove/`).catch(() => {});
  }

  function handleUnblock(user: UserSummary) {
    setBlocked((prev) => prev.filter((u) => u.id !== user.id));
    api.post(`/api/friends/unblock/${user.id}/`).catch(() => {});
  }

  function handleAddFriend(user: UserSummary) {
    api.post('/api/friends/add/', { user_id: user.id }).catch(() => {});
  }

  // ── ⋮ menu ───────────────────────────────────────────────────────
  function openMenu(user: UserSummary, type: 'connected' | 'friend') {
    const removeLabel = type === 'friend' ? 'Remove Friend' : 'Remove Connection';
    const removeAction = type === 'friend'
      ? () => handleRemoveFriend(user)
      : () => handleRemoveConnection(user);

    Alert.alert(user.username, undefined, [
      { text: removeLabel, style: 'destructive', onPress: removeAction },
      { text: 'Block User', style: 'destructive', onPress: () => handleBlock(user) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ── Navigation ───────────────────────────────────────────────────
  function handleMessage(user: UserSummary) {
    router.push({
      pathname: '/messages/[id]',
      params: { id: user.id, username: user.username },
    } as any);
  }

  // ── Tabs config ──────────────────────────────────────────────────
  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor="#00b4a6"
      colors={['#00b4a6']}
    />
  );

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'pending',   label: 'Pending',   count: pending.length },
    { key: 'connected', label: 'Connected', count: connections.length },
    { key: 'friends',   label: 'Friends',   count: friendList.friends.length },
    { key: 'blocked',   label: 'Blocked',   count: blocked.length },
  ];

  return (
    <View style={[styles.container, { paddingTop: top }]}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chat</Text>
      </View>

      {/* ── Tab bar ── */}
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
                <View style={[styles.badge, isActive && styles.badgeActive]}>
                  <Text style={[styles.badgeText, isActive && styles.badgeTextActive]}>
                    {tab.count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* ── Content ── */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="#00b4a6" size="large" />
        </View>
      ) : activeTab === 'pending' ? (
        <FlatList
          data={pending}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <PendingCard
              request={item}
              onAccept={handleAccept}
              onDecline={handleDecline}
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState message={'No pending requests\nWave at people on the map'} />
          }
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
        />
      ) : activeTab === 'connected' ? (
        <FlatList
          data={connections}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <UserCard
              user={item}
              type="connected"
              onMessage={handleMessage}
              onAddFriend={handleAddFriend}
              onMenu={openMenu}
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState message={'No connections yet\nAccept incoming Hi requests'} />
          }
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
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
          ListEmptyComponent={
            <EmptyState message={'No friends yet\nUpgrade a connection to friend'} />
          }
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          data={blocked}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <BlockedCard user={item} onUnblock={handleUnblock} />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState message="No blocked users" />
          }
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  header: { paddingHorizontal: 20, paddingBottom: 8, paddingTop: 4 },
  headerTitle: { color: '#ffffff', fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#161616',
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
  tabItemActive: { borderBottomColor: '#00b4a6' },
  tabLabel: { color: '#3a3a3a', fontSize: 13, fontWeight: '600' },
  tabLabelActive: { color: '#00b4a6' },
  badge: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeActive: { backgroundColor: '#00b4a6' },
  badgeText: { color: '#555', fontSize: 10, fontWeight: '800' },
  badgeTextActive: { color: '#0a0a0a' },

  // List
  list: { padding: 16, paddingBottom: 230, gap: 10 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Card
  card: {
    backgroundColor: '#0f0f0f',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    gap: 12,
  },
  cardPending: {
    borderColor: '#00b4a615',
    backgroundColor: '#0c1514',
  },
  cardBlocked: {
    opacity: 0.6,
  },

  // Avatar
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#181818',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },

  // Card body
  cardBody: { flex: 1, gap: 2 },
  cardName: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  cardNameBlocked: { color: '#555' },
  cardSub: { color: '#555', fontSize: 12, lineHeight: 17 },
  cardSubEmpty: { color: '#2a2a2a', fontStyle: 'italic' },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 10 },

  // ⋮ menu button
  menuBtn: {
    alignSelf: 'flex-start',
    paddingLeft: 8,
    paddingVertical: 2,
  },
  menuDots: { color: '#3a3a3a', fontSize: 20, lineHeight: 24 },

  // Buttons
  btn: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 10 },
  btnPrimary: { backgroundColor: '#00b4a6' },
  btnPrimaryText: { color: '#0a0a0a', fontSize: 12, fontWeight: '700' },
  btnGhost: {
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: '#252525',
  },
  btnGhostText: { color: '#666', fontSize: 12, fontWeight: '600' },

  // Empty state
  empty: { alignItems: 'center', paddingTop: 64 },
  emptyText: { color: '#2a2a2a', fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
