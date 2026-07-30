import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Speedometer } from '@/components/Speedometer';
import { DraggableTabs, type DraggableTabKey } from '@/components/DraggableTabs';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { IconClose, IconSearch } from '@/components/ui/icons';
import { api } from '@/services/api';
import { blockUser, refreshBlocked, useBlockedUsers } from '@/services/blocked';
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
import { clubsApi, type Club } from '@/services/clubs';
import { colors, fonts, radius } from '@/constants/theme';
import type { Presence } from '@/services/presence';

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab = 'alerts' | 'chats' | 'clubs';

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

/**
 * Every chat row is the same card, whoever it holds.
 *
 * A connection's card used to carry a full-width "Add Friend" button inside it,
 * which made it a head taller than a friend's — so a list of both read as two
 * kinds of thing, and the ragged heights were the first thing you saw. Adding a
 * friend is now the compact action beside the menu: same row, same height, and
 * the card is still a chat you tap to open.
 */
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
        </View>

        <View style={styles.cardTail}>
          {type === 'connected' && onAddFriend && (
            <Pressable
              style={[styles.addFriendBtn, requestSent && styles.addFriendBtnSent]}
              onPress={() => { if (!requestSent) onAddFriend(user); }}
              disabled={requestSent}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                requestSent
                  ? `Friend request sent to ${user.username}`
                  : `Add ${user.username} as a friend`
              }
              accessibilityState={{ disabled: requestSent }}
            >
              <Ionicons
                name={requestSent ? 'checkmark' : 'person-add-outline'}
                size={15}
                color={requestSent ? colors.teal : colors.t2}
              />
            </Pressable>
          )}
          <Pressable
            style={styles.menuBtn}
            onPress={() => onMenu(user, type)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`More options for ${user.username}`}
          >
            <Ionicons name="ellipsis-vertical" size={16} color={colors.t3} />
          </Pressable>
        </View>
      </View>
    </Card>
  );
}

// ─── Club card ────────────────────────────────────────────────────────────────
function ClubCard({ club, onPress }: { club: Club; onPress: () => void }) {
  return (
    <Pressable style={styles.clubCard} onPress={onPress}>
      {club.emblem ? (
        <Image source={{ uri: club.emblem }} style={styles.clubEmblem} />
      ) : (
        <View style={styles.clubEmblemFallback}>
          <Text style={styles.clubEmblemInitial}>{club.name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.clubCardBody}>
        <View style={styles.clubCardTop}>
          <Text style={styles.clubCardName} numberOfLines={1}>{club.name}</Text>
          {club.role && (
            <View style={styles.clubRoleBadge}>
              <Text style={styles.clubRoleText}>
                {club.role === 'president' ? '👑 President' : club.role === 'vice' ? '⭐ Vice' : 'Member'}
              </Text>
            </View>
          )}
        </View>
        {club.interest && (
          <Text style={styles.clubInterest}>{club.interest.icon} {club.interest.name}</Text>
        )}
        <View style={styles.clubMemberRow}>
          <Ionicons name="people-outline" size={12} color={colors.t3} />
          <Text style={styles.clubMemberCount}>{club.member_count} members</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Search ───────────────────────────────────────────────────────────────────
// One field over everything this screen holds: the people you can message —
// friends and connections — and the clubs, yours and the ones you could join.
// Three tabs meant three places to look for a name you already knew, and the
// Clubs tab in particular is two unbounded lists you were expected to scroll.
//
// Nothing new is fetched. Every list this searches is already in memory and
// already polling, so a query is a filter, not a request — and it can't show
// you anyone the screen wasn't allowed to show you in the first place.

type ChatUser = UserSummary & { chatType: 'connected' | 'friend' };

type SearchRow =
  | { kind: 'label'; key: string; label: string }
  | { kind: 'person'; key: string; user: ChatUser }
  | { kind: 'club'; key: string; club: Club };

function matches(haystack: string | undefined, needle: string): boolean {
  return !!haystack && haystack.toLowerCase().includes(needle);
}

function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View style={styles.searchWrap}>
      <IconSearch size={16} color={colors.t3} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder="Search people and clubs"
        placeholderTextColor={colors.t3}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search your chats and clubs"
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <IconClose size={16} color={colors.t3} />
        </Pressable>
      )}
    </View>
  );
}

function SearchPersonRow({ user, onPress }: { user: ChatUser; onPress: () => void }) {
  const isFriend = user.chatType === 'friend';
  return (
    <Card onPress={onPress}>
      <View style={styles.searchRow}>
        <Avatar
          uri={user.profile_picture}
          name={user.username}
          size="md"
          ringColor={isFriend ? colors.blue : colors.orange}
          presence={user.presence}
        />
        <View style={styles.searchRowBody}>
          <Text style={styles.cardName} numberOfLines={1}>{user.username}</Text>
          <Text style={styles.searchRowMeta} numberOfLines={1}>
            {isFriend ? 'Friend' : 'Connected'}
            {user.last_message ? ` · ${storyReplyPreview(user.last_message)}` : ''}
          </Text>
        </View>
        {(user.unread_count ?? 0) > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>
              {(user.unread_count ?? 0) > 9 ? '9+' : user.unread_count}
            </Text>
          </View>
        )}
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
  const [tabOrder, setTabOrder] = useState<DraggableTabKey[]>(['alerts', 'chats', 'clubs']);
  const [query, setQuery] = useState('');
  const [friendList, setFriendList] = useState<FriendList>({ connections: [], friends: [] });
  const [alerts, setAlerts] = useState<AlertsData>(EMPTY_ALERTS);
  useBlockedUsers();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sentRequestIds, setSentRequestIds] = useState<Set<number>>(new Set());
  const [markingRead, setMarkingRead] = useState(false);
  const [actioning, setActioning] = useState<Record<string, 'accept' | 'decline'>>({});
  const [myClubs, setMyClubs] = useState<Club[]>([]);
  const [discoverClubs, setDiscoverClubs] = useState<Club[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(false);

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

  const fetchClubs = useCallback(async () => {
    setLoadingClubs(true);
    try {
      const [myRes, discoverRes] = await Promise.allSettled([
        clubsApi.list(),
        clubsApi.discover(),
      ]);
      if (myRes.status === 'fulfilled') setMyClubs(myRes.value.data);
      if (discoverRes.status === 'fulfilled') setDiscoverClubs(discoverRes.value.data);
    } catch {} finally {
      setLoadingClubs(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'clubs') fetchClubs();
  }, [activeTab, fetchClubs]);

  useFocusEffect(useCallback(() => {
    fetchClubs();
  }, [fetchClubs]));

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

  // Friends first, then connections — the same tiering the nearby list uses, so
  // "who am I closest to" reads the same way everywhere. Recency only sorts
  // within a tier, so an active connection can't push your friends down the
  // list.
  const chatUsers: ChatUser[] = [
    ...friendList.friends.map((u) => ({ ...u, chatType: 'friend' as const })),
    ...connections.map((u) => ({ ...u, chatType: 'connected' as const })),
  ].sort((a, b) => {
    if (a.chatType !== b.chatType) return a.chatType === 'friend' ? -1 : 1;
    if (a.last_message_at && b.last_message_at) return b.last_message_at.localeCompare(a.last_message_at);
    if (a.last_message_at) return -1;
    if (b.last_message_at) return 1;
    return 0;
  });

  // ── Search across people and clubs ─────────────────────────────────
  const trimmed = query.trim();
  const searching = trimmed.length > 0;

  const searchRows: SearchRow[] = useMemo(() => {
    const needle = trimmed.toLowerCase();
    if (!needle) return [];

    const people = chatUsers.filter((u) => matches(u.username, needle));

    // A club can be in both lists across a refresh; the one you are in wins,
    // because its row carries your role.
    const clubById = new Map<number, Club>();
    for (const club of [...discoverClubs, ...myClubs]) clubById.set(club.id, club);
    const clubs = [...clubById.values()].filter(
      (c) => matches(c.name, needle) || matches(c.interest?.name, needle),
    );

    return [
      ...(people.length ? [{ kind: 'label' as const, key: 'l-people', label: 'PEOPLE' }] : []),
      ...people.map((user) => ({ kind: 'person' as const, key: `p-${user.id}`, user })),
      ...(clubs.length ? [{ kind: 'label' as const, key: 'l-clubs', label: 'CLUBS' }] : []),
      ...clubs.map((club) => ({ kind: 'club' as const, key: `c-${club.id}`, club })),
    ];
    // chatUsers is rebuilt every render from friendList; depending on the two
    // lists it comes from keeps this from recomputing on unrelated state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, friendList, myClubs, discoverClubs]);

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'alerts', label: 'Alerts', count: unreadCount },
    { key: 'chats',  label: 'Chats',  count: chatUsers.length },
    { key: 'clubs',  label: 'Clubs',  count: myClubs.length },
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

      <SearchField value={query} onChange={setQuery} />

      {/* The tabs are what you are searching *instead of*, so they step aside
          while a query is live rather than sitting above results that belong
          to none of them. */}
      {!searching && (
        <DraggableTabs
          tabs={TABS}
          activeTab={activeTab}
          order={tabOrder}
          onTabPress={(key) => setActiveTab(key)}
          onOrderChange={setTabOrder}
        />
      )}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : searching ? (
        <FlatList
          data={searchRows}
          keyExtractor={(item) => item.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => {
            if (item.kind === 'label') {
              return <Text style={styles.searchSectionLabel}>{item.label}</Text>;
            }
            if (item.kind === 'person') {
              return (
                <SearchPersonRow
                  user={item.user}
                  onPress={() => handleMessage(item.user)}
                />
              );
            }
            return (
              <ClubCard
                club={item.club}
                onPress={() =>
                  router.push({ pathname: '/clubs/[id]', params: { id: item.club.id } } as any)
                }
              />
            );
          }}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              message={`Nothing matches “${trimmed}”\nThis searches your friends, connections and clubs`}
            />
          }
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        />
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
      ) : activeTab === 'chats' ? (
        <FlatList
          data={chatUsers}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <UserCard
              user={item}
              type={item.chatType}
              requestSent={sentRequestIds.has(item.id)}
              onMessage={handleMessage}
              onAddFriend={item.chatType === 'connected' ? handleAddFriend : undefined}
              onMenu={openMenu}
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState message={'No chats yet\nAccept incoming Hi requests'} />}
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.clubsScroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={loadingClubs} onRefresh={fetchClubs} tintColor={colors.teal} colors={[colors.teal]} />
          }
        >
          {myClubs.length === 0 && (
            <Pressable style={styles.createClubBtn} onPress={() => router.push('/create-club' as any)}>
              <Ionicons name="add-circle-outline" size={18} color={colors.teal} />
              <Text style={styles.createClubBtnText}>Create a Club</Text>
            </Pressable>
          )}

          {loadingClubs ? (
            <ActivityIndicator color={colors.teal} style={{ marginTop: 40 }} />
          ) : (
            <>
              {myClubs.length > 0 && (
                <>
                  <Text style={styles.clubsSectionLabel}>MY CLUBS</Text>
                  {myClubs.map((club) => (
                    <ClubCard
                      key={club.id}
                      club={club}
                      onPress={() => router.push({ pathname: '/clubs/[id]', params: { id: club.id } } as any)}
                    />
                  ))}
                </>
              )}

              <Text style={styles.clubsSectionLabel}>DISCOVER</Text>
              {discoverClubs.length > 0 ? (
                discoverClubs.map((club) => (
                  <ClubCard
                    key={club.id}
                    club={club}
                    onPress={() => router.push({ pathname: '/clubs/[id]', params: { id: club.id } } as any)}
                  />
                ))
              ) : (
                <Text style={styles.clubsEmptyText}>No clubs to discover yet.</Text>
              )}
            </>
          )}
        </ScrollView>
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

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    height: 44,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t1,
    // Android pads text inputs by default, which pushes the text off centre
    // inside a fixed-height row.
    paddingVertical: 0,
  },
  searchSectionLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
    marginTop: 6,
    marginBottom: 2,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  searchRowBody: { flex: 1, gap: 3 },
  searchRowMeta: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
  },

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
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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

  // Trailing actions. Both are icon-sized, so a connection's row is exactly as
  // tall as a friend's.
  cardTail: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addFriendBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addFriendBtnSent: { backgroundColor: colors.tealTint, borderColor: colors.tealLine },

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
  menuBtn: { paddingHorizontal: 4, paddingVertical: 6 },

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

  // Clubs tab
  clubsScroll: { padding: 16, paddingBottom: 230 },

  createClubBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.tealLine,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginBottom: 20,
  },
  createClubBtnText: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.teal,
  },

  clubsSectionLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 4,
  },

  clubCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clubEmblem: { width: 48, height: 48, borderRadius: 24 },
  clubEmblemFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clubEmblemInitial: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '700',
    color: colors.teal,
  },
  clubCardBody: { flex: 1, gap: 3 },
  clubCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  clubCardName: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.t1,
  },
  clubRoleBadge: {
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  clubRoleText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600', color: colors.teal },
  clubInterest: { fontFamily: fonts.body, fontSize: 12, color: colors.t2 },
  clubMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clubMemberCount: { fontFamily: fonts.body, fontSize: 12, color: colors.t3 },

  clubsEmptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t3,
    textAlign: 'center',
    lineHeight: 21,
    paddingVertical: 24,
  },
});
