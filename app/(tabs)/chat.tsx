import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
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
import {
  clubsApi,
  fetchMyLocation,
  UNPLACED,
  visibilityLabel,
  type Club,
  type MyClubLocation,
} from '@/services/clubs';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
function ClubCard({
  club,
  onPress,
  onJoin,
  joining,
}: {
  club: Club;
  onPress: () => void;
  onJoin?: () => void;
  joining?: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
          {/* `my_role`, not `role`: the club list serialises the viewer's own
              membership under that name (see ClubSerializer.get_my_role). It
              is absent on a club you have not joined, which is what keeps the
              badge off the discover list. */}
          {club.my_role && (
            <View style={styles.clubRoleBadge}>
              <Text style={styles.clubRoleText}>
                {club.my_role === 'owner' ? '👑 Owner' : 'Member'}
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
          {/* Where the club reaches. Worth a line on the card: a district club
              and a city club are different offers, and the difference is
              invisible once you are inside the area either way. */}
          {visibilityLabel(club) ? (
            <>
              <Ionicons name="location-outline" size={12} color={colors.t3} />
              <Text style={styles.clubMemberCount} numberOfLines={1}>
                {visibilityLabel(club)}
              </Text>
            </>
          ) : null}
        </View>
      </View>
      {onJoin !== undefined && (
        <Pressable
          style={[styles.clubJoinBtn, joining && styles.clubJoinBtnBusy]}
          onPress={onJoin}
          disabled={joining}
        >
          {joining ? (
            <ActivityIndicator size="small" color={colors.bg} />
          ) : (
            <Text style={styles.clubJoinBtnText}>Join</Text>
          )}
        </Pressable>
      )}
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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

// ─── Module-level cache ───────────────────────────────────────────────────────
// Persists across tab switches so the screen paints instantly on re-focus and
// the spinner only ever shows on the first visit of a session.
let _cache: { friendList: FriendList; alerts: AlertsData } | null = null;

// ─── Screen ───────────────────────────────────────────────────────────────────
// ─── Tab bodies ───────────────────────────────────────────────────────────────
// One component per thing the screen can be showing. The screen below owns all
// the data and the actions; each of these is only the list that draws it.

type ScrollProps = ReturnType<typeof useScrollHandler>;

function SearchResultsList({ rows, trimmed, scrollProps, onMessage, onOpenClub }: {
  rows: SearchRow[];
  trimmed: string;
  scrollProps: ScrollProps;
  onMessage: (user: ChatUser) => void;
  onOpenClub: (clubId: number) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.key}
      windowSize={5}
      initialNumToRender={8}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      renderItem={({ item }) => {
        if (item.kind === 'label') {
          return <Text style={styles.searchSectionLabel}>{item.label}</Text>;
        }
        if (item.kind === 'person') {
          return <SearchPersonRow user={item.user} onPress={() => onMessage(item.user)} />;
        }
        return <ClubCard club={item.club} onPress={() => onOpenClub(item.club.id)} />;
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
  );
}

function AlertsList({ rows, actioning, unreadCount, hasUnreadActivity, markingRead, refreshControl, scrollProps, onRequest, onOpenActivity, onOpenProfile, onMarkAllRead }: {
  rows: AlertRow[];
  actioning: Record<string, 'accept' | 'decline'>;
  unreadCount: number;
  hasUnreadActivity: boolean;
  markingRead: boolean;
  refreshControl: React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
  scrollProps: ScrollProps;
  onRequest: (request: AlertRequest, action: 'accept' | 'decline') => void;
  onOpenActivity: (notif: Notification) => void;
  onOpenProfile: (userId: number) => void;
  onMarkAllRead: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.key}
      windowSize={5}
      initialNumToRender={8}
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
              onAccept={() => onRequest(item.request, 'accept')}
              onDecline={() => onRequest(item.request, 'decline')}
              onPressUser={() => onOpenProfile(item.request.user.id)}
            />
          );
        }
        return <NotifRow notif={item.notif} onPress={() => onOpenActivity(item.notif)} />;
      }}
      ListHeaderComponent={
        unreadCount > 0 ? (
          <View style={styles.alertsHeader}>
            <View style={styles.unreadPill}>
              <Text style={styles.unreadPillText}>{unreadCount} unread</Text>
            </View>
            {hasUnreadActivity && (
              <Pressable onPress={onMarkAllRead} disabled={markingRead} hitSlop={10}>
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
  );
}

function ChatsList({ users, sentRequestIds, refreshControl, scrollProps, onMessage, onAddFriend, onMenu }: {
  users: ChatUser[];
  sentRequestIds: Set<number>;
  refreshControl: React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
  scrollProps: ScrollProps;
  onMessage: (user: UserSummary) => void;
  onAddFriend: (user: UserSummary) => void;
  onMenu: (user: UserSummary, type: 'connected' | 'friend') => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <FlatList
      data={users}
      keyExtractor={(item) => String(item.id)}
      windowSize={5}
      initialNumToRender={8}
      renderItem={({ item }) => (
        <UserCard
          user={item}
          type={item.chatType}
          requestSent={sentRequestIds.has(item.id)}
          onMessage={onMessage}
          onAddFriend={item.chatType === 'connected' ? onAddFriend : undefined}
          onMenu={onMenu}
        />
      )}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<EmptyState message={'No chats yet\nAccept incoming Hi requests'} />}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
      {...scrollProps}
    />
  );
}

function ClubsTab({ myClubs, discoverClubs, clubPlace, loadingClubs, refreshingPlace, joiningClubId, onRefreshClubs, onCreateClub, onOpenClub, onJoin, onRetryLocation }: {
  myClubs: Club[];
  discoverClubs: Club[];
  clubPlace: MyClubLocation;
  loadingClubs: boolean;
  refreshingPlace: boolean;
  joiningClubId: number | null;
  onRefreshClubs: () => void;
  onCreateClub: () => void;
  onOpenClub: (clubId: number) => void;
  onJoin: (clubId: number) => void;
  onRetryLocation: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.clubsScroll}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={loadingClubs} onRefresh={onRefreshClubs} tintColor={colors.teal} colors={[colors.teal]} />
      }
    >
      <Pressable style={styles.createClubBtn} onPress={onCreateClub}>
        <Ionicons name="add-circle-outline" size={18} color="#ffffff" />
        <Text style={styles.createClubBtnText}>Create Club</Text>
      </Pressable>

      {loadingClubs ? (
        <ActivityIndicator color={colors.teal} style={{ marginTop: 40 }} />
      ) : (
        <>
          {myClubs.length > 0 && (
            <>
              <Text style={styles.clubsSectionLabel}>MY CLUBS</Text>
              {myClubs.map((club) => (
                <ClubCard key={club.id} club={club} onPress={() => onOpenClub(club.id)} />
              ))}
            </>
          )}

          <Text style={styles.clubsSectionLabel}>
            {clubPlace.resolved && clubPlace.city
              ? `DISCOVER IN ${clubPlace.city.name.toUpperCase()}`
              : 'DISCOVER'}
          </Text>

          {/* An unplaceable user is not shown an empty list and left to
              guess. Clubs are scoped to areas now, so "we cannot tell where
              you are" is the answer, and it comes with the fix. */}
          {!clubPlace.resolved && (
            <View style={styles.locationNotice}>
              <Ionicons name="location-outline" size={18} color={colors.t2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.locationNoticeText}>
                  {clubPlace.detail ||
                    'Aura needs your location to show clubs near you.'}
                </Text>
                <Pressable
                  style={styles.locationNoticeBtn}
                  onPress={onRetryLocation}
                  disabled={refreshingPlace}
                  accessibilityRole="button"
                  accessibilityLabel="Update my location"
                >
                  {refreshingPlace ? (
                    <ActivityIndicator color={colors.teal} size="small" />
                  ) : (
                    <Text style={styles.locationNoticeBtnText}>Update my location</Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          {discoverClubs.length > 0 ? (
            discoverClubs.map((club) => (
              <ClubCard
                key={club.id}
                club={club}
                onPress={() => onOpenClub(club.id)}
                onJoin={() => onJoin(club.id)}
                joining={joiningClubId === club.id}
              />
            ))
          ) : (
            clubPlace.resolved && (
              <Text style={styles.clubsEmptyText}>
                {clubPlace.city
                  ? `No clubs in ${clubPlace.city.name} yet. Create the first one.`
                  : 'No clubs to discover yet.'}
              </Text>
            )
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
/**
 * The Clubs tab's own data: the two lists, where the server thinks you are, and
 * the three separate things that can be in flight at once.
 *
 * Self-contained because nothing else on this screen reads any of it — the tab
 * is a different feature that happens to share a header.
 *
 * `visible` is the tab being open. It arms the spinner on the way in, which is
 * why `fetchClubs` only ever clears it: the refetch on focus is a silent
 * background refresh and must not blank a list the reader is already using.
 */
function useClubsTab(visible: boolean) {
  const [myClubs, setMyClubs] = useState<Club[]>([]);
  const [discoverClubs, setDiscoverClubs] = useState<Club[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(false);
  const [joiningClubId, setJoiningClubId] = useState<number | null>(null);
  // Discovery only shows clubs scoped to where this user actually is, so when
  // the server cannot place them the tab has to say so rather than look empty.
  const [clubPlace, setClubPlace] = useState<MyClubLocation>(UNPLACED);
  const [refreshingPlace, setRefreshingPlace] = useState(false);

  const fetchClubs = useCallback(async () => {
    try {
      const [myRes, discoverRes, placeRes] = await Promise.allSettled([
        clubsApi.myList(),   // GET /api/clubs/?joined=true  — only joined clubs
        clubsApi.list(),     // GET /api/clubs/              — unjoined, and in this area
        fetchMyLocation(),   // why the discover list looks the way it does
      ]);
      if (myRes.status === 'fulfilled') setMyClubs(myRes.value.data);
      if (discoverRes.status === 'fulfilled') setDiscoverClubs(discoverRes.value.data);
      if (placeRes.status === 'fulfilled') setClubPlace(placeRes.value);
    } catch {}
    // The `catch` above swallows everything, so this always runs — it is the old
    // `finally`, unwound. React Compiler cannot lower a `finally` and gives up on
    // the whole hook containing one, which costs this tab its auto-memoization.
    setLoadingClubs(false);
  }, []);

  /** Show the spinner, then fetch. For pull-to-refresh and the tab press. */
  const reload = useCallback(() => {
    setLoadingClubs(true);
    fetchClubs();
  }, [fetchClubs]);

  // One fetch, gated on both conditions. There used to be a plain mount effect
  // beside this that fetched whenever `visible` turned true — and because
  // `useFocusEffect` already fires on the screen's first focus, opening the tab
  // sent the same three requests twice. Folding `visible` into this callback
  // keeps the "switched to Clubs while already on screen" case (the identity
  // changes, so the effect re-runs) without the duplicate on mount, and stops
  // us fetching clubs for a tab that isn't being looked at.
  useFocusEffect(useCallback(() => {
    if (visible) fetchClubs();
  }, [visible, fetchClubs]));

  /** Ask the server to work out where we are properly, upstream and all.
   *  The cheap lookup on every load answers from stored boundaries; this is the
   *  one that can place somebody in a city nobody has opened this tab in. */
  async function retryLocation() {
    setRefreshingPlace(true);
    // Neither call rejects — `fetchMyLocation` answers with UNPLACED on failure
    // and `fetchClubs` swallows its own errors — so the flag clears here rather
    // than in a `finally`, which React Compiler cannot compile.
    setClubPlace(await fetchMyLocation(true));
    await fetchClubs();
    setRefreshingPlace(false);
  }

  async function join(clubId: number) {
    setJoiningClubId(clubId);
    try {
      await clubsApi.join(clubId);
      await fetchClubs();
    } catch (e: any) {
      // A 404 here means the list on screen is older than the user's position —
      // they have walked out of the club's area since it was fetched. Say so,
      // and reload rather than leaving a card that cannot be joined.
      if (e?.response?.status === 404) {
        Alert.alert(
          'Not available here',
          'This club is only for people in its area, and you are outside it now.',
        );
        await fetchClubs();
      } else {
        Alert.alert('Error', e?.response?.data?.detail ?? 'Could not join club.');
      }
    }
    // Reached on both paths — the `catch` handles every failure and rethrows
    // nothing — so the spinner clears without a compiler-defeating `finally`.
    setJoiningClubId(null);
  }

  return {
    /** Arms the spinner for the press that reveals the tab. */
    arm: () => setLoadingClubs(true),
    /** Spread straight onto `<ClubsTab>` alongside its navigation callbacks. */
    tabProps: {
      myClubs,
      discoverClubs,
      clubPlace,
      loadingClubs,
      refreshingPlace,
      joiningClubId,
      onRefreshClubs: reload,
      onJoin: join,
      onRetryLocation: retryLocation,
    },
  };
}

/**
 * The things you can do *to* a person from their row: block, remove, add, open.
 *
 * All optimistic — the list updates first and the request follows, because none
 * of these are worth a spinner on a row you are already looking at. Blocking is
 * the one that rolls back and re-fetches if the server disagrees; removals are
 * left alone, since a failed remove that silently reappears on the next poll is
 * less alarming than a row that flickers back under the reader's thumb.
 */
function usePeopleActions({ setFriendList, setSentRequestIds, onBlockFailed, router }: {
  setFriendList: React.Dispatch<React.SetStateAction<FriendList>>;
  setSentRequestIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  onBlockFailed: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  function handleBlock(user: UserSummary) {
    setFriendList((prev) => ({
      connections: prev.connections.filter((u) => u.id !== user.id),
      friends:     prev.friends.filter((u) => u.id !== user.id),
    }));
    blockUser(user)
      .then(() => triggerNearbyRefresh())
      .catch(() => {
        Alert.alert('Could not block', `Blocking @${user.username} failed. Please try again.`);
        onBlockFailed();
      });
  }

  function remove(user: UserSummary, tier: 'friends' | 'connections') {
    setFriendList((prev) => ({ ...prev, [tier]: prev[tier].filter((u) => u.id !== user.id) }));
    api.delete(`/api/friends/${user.id}/remove/`).catch(() => {});
  }

  return {
    onAddFriend(user: UserSummary) {
      api.post(`/api/friends/request/${user.id}/`)
        .then(() => setSentRequestIds((prev) => new Set(prev).add(user.id)))
        .catch((e) => console.log('[Friend Request] error:', e?.response?.status));
    },

    onMenu(user: UserSummary, type: 'connected' | 'friend') {
      const isFriend = type === 'friend';
      Alert.alert(user.username, undefined, [
        {
          text: isFriend ? 'Remove Friend' : 'Remove Connection',
          style: 'destructive',
          onPress: () => remove(user, isFriend ? 'friends' : 'connections'),
        },
        { text: 'Block User', style: 'destructive', onPress: () => handleBlock(user) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },

    onMessage(user: UserSummary) {
      // Clear the badge on the way in: the thread marks itself read on open, so
      // waiting for the next poll would leave a count on a chat you just read.
      setFriendList((prev) => ({
        connections: prev.connections.map((u) => u.id === user.id ? { ...u, unread_count: 0 } : u),
        friends:     prev.friends.map((u)     => u.id === user.id ? { ...u, unread_count: 0 } : u),
      }));
      router.push({ pathname: '/messages/[id]', params: { id: user.id, username: user.username } } as any);
    },
  };
}

/**
 * The chats list, and the one search box that spans it and the clubs lists.
 *
 * Ordering is friends first, then connections — the same tiering the nearby
 * list uses, so "who am I closest to" reads the same way everywhere. Recency
 * only sorts *within* a tier, so an active connection can never push your
 * friends down the list.
 */
function useChatSearch(
  query: string,
  friendList: FriendList,
  connections: UserSummary[],
  myClubs: Club[],
  discoverClubs: Club[],
) {
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

  const trimmed = query.trim();

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

  return { chatUsers, trimmed, searching: trimmed.length > 0, searchRows };
}

export default function ChatScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const scrollProps = useScrollHandler();

  const [activeTab, setActiveTab] = useState<Tab>('alerts');
  const [tabOrder, setTabOrder] = useState<DraggableTabKey[]>(['alerts', 'chats', 'clubs']);
  const [query, setQuery] = useState('');
  const [friendList, setFriendList] = useState<FriendList>(_cache?.friendList ?? { connections: [], friends: [] });
  const [alerts, setAlerts] = useState<AlertsData>(_cache?.alerts ?? EMPTY_ALERTS);
  useBlockedUsers();
  const [loading, setLoading] = useState(_cache === null);
  const [refreshing, setRefreshing] = useState(false);
  const [sentRequestIds, setSentRequestIds] = useState<Set<number>>(new Set());
  const [markingRead, setMarkingRead] = useState(false);
  const [actioning, setActioning] = useState<Record<string, 'accept' | 'decline'>>({});
  const clubsTab = useClubsTab(activeTab === 'clubs');
  const peopleActions = usePeopleActions({
    setFriendList,
    setSentRequestIds,
    onBlockFailed: () => fetchAll(),
    router,
  });

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
    let list = _cache?.friendList ?? { connections: [], friends: [] };
    let alertsData = _cache?.alerts ?? EMPTY_ALERTS;
    if (listRes.status === 'fulfilled') {
      const data = listRes.value.data;
      list = {
        connections: data.connections ?? [],
        friends:     data.friends     ?? [],
      };
      setFriendList(list);
    }
    if (alertsRes.status === 'fulfilled') {
      alertsData = alertsRes.value;
      setAlerts(alertsData);
    }
    _cache = { friendList: list, alerts: alertsData };
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
    pollRef.current = setInterval(fetchAll, 15_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchAll, fetchUnreadBreakdown]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Promise `.finally` rather than a `try/finally` block: it stops the spinner
    // on rejection just the same, but React Compiler can compile it, and a
    // `finally` statement makes it bail on this whole screen.
    await fetchAll().finally(() => setRefreshing(false));
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
    }
    // Runs on both paths: the `catch` only logs, so nothing escapes it.
    setActioning((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }

  async function markAllRead() {
    setMarkingRead(true);
    try {
      await api.patch('/api/notifications/mark-all-read/');
    } catch {}
    // Refresh either way — a failed mark-all still wants the true unread state.
    await fetchAll();
    setMarkingRead(false);
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

  const { chatUsers, trimmed, searching, searchRows } = useChatSearch(
    query, friendList, connections, clubsTab.tabProps.myClubs, clubsTab.tabProps.discoverClubs,
  );

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'alerts', label: 'Alerts', count: unreadCount },
    { key: 'chats',  label: 'Chats',  count: chatUsers.length },
    { key: 'clubs',  label: 'Clubs',  count: clubsTab.tabProps.myClubs.length },
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
          onTabPress={(key) => {
            // The spinner belongs to the press that reveals the list, not to
            // an effect reacting to the tab change afterwards.
            if (key === 'clubs') clubsTab.arm();
            setActiveTab(key);
          }}
          onOrderChange={setTabOrder}
        />
      )}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : searching ? (
        <SearchResultsList
          rows={searchRows}
          trimmed={trimmed}
          scrollProps={scrollProps}
          onMessage={peopleActions.onMessage}
          onOpenClub={(clubId) => router.push({ pathname: '/clubs/[id]', params: { id: clubId } } as any)}
        />
      ) : activeTab === 'alerts' ? (
        <AlertsList
          rows={alertRows}
          actioning={actioning}
          unreadCount={unreadCount}
          hasUnreadActivity={hasUnreadActivity}
          markingRead={markingRead}
          refreshControl={refreshControl}
          scrollProps={scrollProps}
          onRequest={handleRequest}
          onOpenActivity={openActivity}
          onOpenProfile={(userId) => router.push({ pathname: '/profile/[id]', params: { id: userId } } as any)}
          onMarkAllRead={markAllRead}
        />
      ) : activeTab === 'chats' ? (
        <ChatsList
          users={chatUsers}
          sentRequestIds={sentRequestIds}
          refreshControl={refreshControl}
          scrollProps={scrollProps}
          onMessage={peopleActions.onMessage}
          onAddFriend={peopleActions.onAddFriend}
          onMenu={peopleActions.onMenu}
        />
      ) : (
        <ClubsTab
          {...clubsTab.tabProps}
          onCreateClub={() => router.push('/create-club' as any)}
          onOpenClub={(clubId) => router.push({ pathname: '/clubs/[id]', params: { id: clubId } } as any)}
        />
      )}

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
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
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#E8714A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginBottom: 20,
  },
  createClubBtnText: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
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

  clubJoinBtn: {
    backgroundColor: colors.teal,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minWidth: 56,
    alignItems: 'center',
  },
  clubJoinBtnBusy: { opacity: 0.6 },
  clubJoinBtnText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.bg },

  clubsEmptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t3,
    textAlign: 'center',
    lineHeight: 21,
    paddingVertical: 24,
  },

  locationNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    marginBottom: 12,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationNoticeText: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.t2,
  },
  locationNoticeBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    minHeight: 32,
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.m,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
  },
  locationNoticeBtnText: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.teal,
  },
});
