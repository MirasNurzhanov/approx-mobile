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
import { blockUser, refreshBlocked, unblockUser, useBlockedUsers } from '@/services/blocked';
import { triggerNearbyRefresh } from '@/services/nearbyRefresh';
import { storyReplyPreview } from '@/services/storyReply';
import {
  deriveAlerts,
  EMPTY_ALERTS,
  isRead,
  loadAlerts,
  refreshAlertsCount,
  requestActionUrl,
  type AlertRequest,
  type AlertsData,
  type Notification,
} from '@/services/alerts';
import { NotifRow, RequestRow } from '@/components/alerts/AlertRow';
import { useScrollHandler } from '@/hooks/useScrollHandler';
import { colors, fonts } from '@/constants/theme';
import type { Presence } from '@/services/presence';

// ─── Types ────────────────────────────────────────────────────────────────────
// 'alerts' took over the slot "Pending" used to hold, and absorbed it: the
// incoming Hi requests that lived there now sit alongside friend requests and
// story activity in one list. Leading slot, because that is where people look
// for things waiting on them.
type Tab = 'alerts' | 'connected' | 'friends' | 'blocked';

/** One flat row stream for the Alerts tab, so it scrolls in a FlatList like
 *  every other tab rather than needing its own scroll container. */
type AlertRow =
  | { kind: 'label'; key: string; label: string }
  | { kind: 'request'; key: string; request: AlertRequest }
  | { kind: 'activity'; key: string; notif: Notification };

interface UserSummary {
  id: number;
  username: string;
  last_message?: string;
  last_message_at?: string;
  unread_count?: number;
  profile_picture?: string;
  /** Absent when this viewer may not see it — render no indicator, not grey. */
  presence?: Presence;
}

interface FriendList {
  connections: UserSummary[];
  friends: UserSummary[];
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
        <Avatar uri={user.profile_picture} name={user.username} size="md" ringColor={ringColor} presence={user.presence} />
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

  const [activeTab, setActiveTab] = useState<Tab>('alerts');
  const [friendList, setFriendList] = useState<FriendList>({ connections: [], friends: [] });
  const [alerts, setAlerts] = useState<AlertsData>(EMPTY_ALERTS);
  // Shared with Settings → Blocked users: one store, one list.
  const blocked = useBlockedUsers().list ?? [];
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sentRequestIds, setSentRequestIds] = useState<Set<number>>(new Set());
  const [markingRead, setMarkingRead] = useState(false);
  const [actioning, setActioning] = useState<Record<string, 'accept' | 'decline'>>({});

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
    const [listRes, alertsRes] = await Promise.allSettled([
      api.get<FriendList>('/api/friends/list/'),
      loadAlerts(),
      refreshBlocked(),
    ]);
    if (listRes.status === 'fulfilled') {
      const data = listRes.value.data;
      setFriendList({
        connections: data.connections ?? [],
        friends:     data.friends     ?? [],
      });
    }
    if (alertsRes.status === 'fulfilled') setAlerts(alertsRes.value);
    // The nav arc reads the same count from the shared store; nudge it so the
    // wedge badge cannot lag behind the tab badge right next to it.
    refreshAlertsCount();
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
  const { requests, activity, unreadCount } = deriveAlerts(alerts);
  const hasUnreadActivity = activity.some((n) => !isRead(n));

  // ── Alerts ─────────────────────────────────────────────────────────
  async function handleRequest(req: AlertRequest, action: 'accept' | 'decline') {
    const key = `${req.kind}-${req.id}`;
    setActioning((prev) => ({ ...prev, [key]: action }));
    try {
      await api.post(requestActionUrl(req, action));
      setAlerts((prev) => ({
        ...prev,
        requests: prev.requests.filter((r) => !(r.id === req.id && r.kind === req.kind)),
      }));
      // Accepting makes a connection and declining frees that person to be
      // waved at again — both change what the map should be showing.
      triggerNearbyRefresh();
      // Accepting a Hi adds a connection, so the list behind this tab is stale.
      fetchAll();
    } catch (e) {
      console.log(`[Alerts] ${req.kind} ${action} failed`, e);
    } finally {
      setActioning((prev) => { const next = { ...prev }; delete next[key]; return next; });
    }
  }

  async function markAllRead() {
    setMarkingRead(true);
    try {
      await api.patch('/api/notifications/mark-all-read/');
    } catch {}
    finally {
      await fetchAll();
      setMarkingRead(false);
    }
  }

  /** Follow an alert to whatever it is about. A reply lives in the chat it was
   *  sent to; a reaction has no thread, so it goes to who reacted. */
  function openActivity(n: Notification) {
    if (!isRead(n)) {
      // Optimistic: the row un-bolds now, the server catches up.
      setAlerts((prev) => ({
        ...prev,
        notifications: prev.notifications.map((x) =>
          x.id === n.id ? { ...x, is_read: true, read: true } : x,
        ),
      }));
      api.patch(`/api/notifications/${n.id}/read/`).then(refreshAlertsCount).catch(() => {});
    }

    if (n.sender_id == null) return;
    if (n.notification_type === 'story_reply') {
      router.push({
        pathname: '/messages/[id]',
        params: { id: n.sender_id, username: n.sender_username ?? '' },
      } as any);
    } else {
      router.push({ pathname: '/profile/[id]', params: { id: n.sender_id } } as any);
    }
  }

  const alertRows: AlertRow[] = [
    ...(requests.length > 0
      ? [{ kind: 'label' as const, key: 'l-req', label: 'REQUESTS' }]
      : []),
    ...requests.map((request) => ({
      kind: 'request' as const,
      key: `r-${request.kind}-${request.id}`,
      request,
    })),
    ...(activity.length > 0
      ? [{ kind: 'label' as const, key: 'l-act', label: 'ACTIVITY' }]
      : []),
    ...activity.map((notif) => ({ kind: 'activity' as const, key: `a-${notif.id}`, notif })),
  ];

  // ── Block / remove ─────────────────────────────────────────────────
  function removeFromLists(userId: number) {
    setFriendList((prev) => ({
      connections: prev.connections.filter((u) => u.id !== userId),
      friends:     prev.friends.filter((u) => u.id !== userId),
    }));
  }

  function handleBlock(user: UserSummary) {
    removeFromLists(user.id);
    blockUser(user)
      .then(() => triggerNearbyRefresh())
      .catch(() => {
        Alert.alert('Could not block', `Blocking @${user.username} failed. Please try again.`);
        fetchAll();
      });
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
    unblockUser(user.id)
      .then(() => {
        // A suspended friendship/connection comes back on unblock.
        fetchAll();
        triggerNearbyRefresh();
      })
      .catch(() => {
        Alert.alert('Could not unblock', `Unblocking @${user.username} failed. Please try again.`);
      });
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
    { key: 'alerts',    label: 'Alerts',    count: unreadCount },
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
        <Text style={styles.headerTitle}>Chat</Text>
      </View>

      {/* Tab bar — underline style */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          // Unanswered requests are the one count here that somebody else is
          // waiting on, so Alerts carries a red badge rather than a grey one.
          const isAlerts = tab.key === 'alerts';
          return (
            <Pressable
              key={tab.key}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => setActiveTab(tab.key)}
              accessibilityRole="button"
              accessibilityLabel={
                isAlerts && tab.count > 0 ? `Alerts, ${tab.count} unread` : tab.label
              }
            >
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {tab.label}
              </Text>
              {tab.count > 0 && (
                <View
                  style={[
                    styles.tabBadge,
                    isActive && styles.tabBadgeActive,
                    isAlerts && styles.tabBadgeAlerts,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabBadgeText,
                      isActive && styles.tabBadgeTextActive,
                      isAlerts && styles.tabBadgeTextAlerts,
                    ]}
                  >
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
      ) : activeTab === 'alerts' ? (
        <FlatList
          data={alertRows}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => {
            if (item.kind === 'label') {
              return <Text style={styles.alertsSectionLabel}>{item.label}</Text>;
            }
            if (item.kind === 'request') {
              const key = `${item.request.kind}-${item.request.id}`;
              return (
                <RequestRow
                  request={item.request}
                  actioning={actioning[key]}
                  onAccept={() => handleRequest(item.request, 'accept')}
                  onDecline={() => handleRequest(item.request, 'decline')}
                  onPressUser={() =>
                    router.push({
                      pathname: '/profile/[id]',
                      params: { id: item.request.user.id },
                    } as any)
                  }
                />
              );
            }
            return <NotifRow notif={item.notif} onPress={() => openActivity(item.notif)} />;
          }}
          ListHeaderComponent={
            unreadCount > 0 ? (
              <View style={styles.alertsHeader}>
                <View style={styles.unreadPill}>
                  <Text style={styles.unreadPillText}>{unreadCount} unread</Text>
                </View>
                {/* Only offered when it would do something: marking read clears
                    activity, and a request is answered rather than read. */}
                {hasUnreadActivity && (
                  <Pressable onPress={markAllRead} disabled={markingRead} hitSlop={10}>
                    {markingRead ? (
                      <ActivityIndicator color={colors.teal} size="small" />
                    ) : (
                      <Text style={styles.markReadBtn}>Mark all read</Text>
                    )}
                  </Pressable>
                )}
              </View>
            ) : null
          }
          contentContainerStyle={styles.alertsList}
          ListEmptyComponent={
            <EmptyState message={"You're all caught up\nRequests and story activity land here"} />
          }
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
  tabBadgeAlerts: { backgroundColor: colors.red },
  tabBadgeTextAlerts: { color: '#fff' },
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

  // Alerts list — rows carry their own dividers, so no gap between them
  alertsList: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 230 },
  alertsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  alertsSectionLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 6,
  },
  unreadPill: {
    backgroundColor: colors.surface2,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unreadPillText: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: '500',
    color: colors.t2,
  },
  markReadBtn: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: colors.teal,
  },

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
