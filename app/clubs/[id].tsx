import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { clubsApi, type Club, type ClubMember, type ClubRole } from '@/services/clubs';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// ─── Types ────────────────────────────────────────────────────────────────────
interface InviteUser {
  id: number;
  username: string;
  profile_picture?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** The server's minimum username-search length (users.views.MIN_SEARCH_LENGTH). */
const MIN_INVITE_QUERY = 2;

function roleBadge(role: ClubRole) {
  if (role === 'owner') return '👑';
  return '';
}

function roleLabel(role: ClubRole) {
  if (role === 'owner') return 'Owner';
  return 'Member';
}

// ─── MemberRow ────────────────────────────────────────────────────────────────
function MemberRow({
  member,
  viewerIsCreator,
  currentUserId,
  onMenu,
}: {
  member: ClubMember;
  viewerIsCreator: boolean;
  currentUserId: number | null;
  onMenu: (member: ClubMember) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const isSelf = Number(member.user.id) === Number(currentUserId);
  const showMenu = !isSelf && viewerIsCreator;

  return (
    <View style={styles.memberRow}>
      <Avatar uri={member.user.profile_picture} name={member.user.username} size="sm" />
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>
          {roleBadge(member.role)}{roleBadge(member.role) ? ' ' : ''}@{member.user.username}
        </Text>
        <Text style={styles.memberRole}>{roleLabel(member.role)}</Text>
      </View>
      {showMenu && (
        <Pressable onPress={() => onMenu(member)} hitSlop={12} style={{ padding: 4 }}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.t2} />
        </Pressable>
      )}
    </View>
  );
}

// ─── Module-level cache ───────────────────────────────────────────────────────
// Keyed by club id: revisiting a club paints the last-known detail + member
// list immediately while the refresh runs in the background.
const _clubCache = new Map<number, { club: Club; members: ClubMember[] }>();

// ─── Sections ─────────────────────────────────────────────────────────────────

/** Emblem, name, what it is about, and the way into its chat. */
function ClubHero({ club, memberCount, myRole, isMember, onOpenChat }: {
  club: Club;
  memberCount: number;
  myRole: ClubRole | null | undefined;
  isMember: boolean;
  onOpenChat: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.hero}>
      {club.emblem ? (
        <Image source={{ uri: club.emblem }} style={styles.emblem} />
      ) : (
        <View style={styles.emblemFallback}>
          <Text style={styles.emblemInitial}>{club.name?.charAt(0)?.toUpperCase() ?? '?'}</Text>
        </View>
      )}

      <Text style={styles.clubName}>{club.name ?? ''}</Text>

      <View style={styles.metaRow}>
        {club.interest?.name && (
          <View style={styles.interestBadge}>
            <Text style={styles.interestIcon}>{club.interest.icon}</Text>
            <Text style={styles.interestName}>{club.interest.name}</Text>
          </View>
        )}
        <View style={styles.memberCountBadge}>
          <Ionicons name="people-outline" size={13} color={colors.t3} />
          <Text style={styles.memberCountText}>{memberCount}</Text>
        </View>
      </View>

      {myRole && (
        <View style={styles.myRoleBadge}>
          <Text style={styles.myRoleText}>{roleBadge(myRole)}{roleBadge(myRole) ? ' ' : ''}{roleLabel(myRole)}</Text>
        </View>
      )}

      {club.description ? (
        <Text style={styles.description}>{club.description}</Text>
      ) : null}

      {isMember && (
        <Pressable style={styles.chatBtn} onPress={onOpenChat}>
          <Ionicons name="chatbubbles-outline" size={18} color={colors.bg} />
          <Text style={styles.chatBtnText}>Open Club Chat</Text>
        </Pressable>
      )}
    </View>
  );
}

function MembersSection({ members, canManage, isCreator, currentUserId, onInvite, onMemberMenu }: {
  members: ClubMember[];
  canManage: boolean;
  isCreator: boolean;
  currentUserId: number | null;
  onInvite: () => void;
  onMemberMenu: (member: ClubMember) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>MEMBERS</Text>
        {canManage && (
          <Pressable style={styles.inviteHeaderBtn} onPress={onInvite} hitSlop={10}>
            <Ionicons name="person-add-outline" size={15} color={colors.teal} />
            <Text style={styles.inviteHeaderText}>Invite</Text>
          </Pressable>
        )}
      </View>

      {members.map((m) => (
        <MemberRow
          key={m.user.id}
          member={m}
          viewerIsCreator={isCreator}
          currentUserId={currentUserId}
          onMenu={onMemberMenu}
        />
      ))}
      {members.length === 0 && (
        <Text style={styles.emptyText}>No members yet.</Text>
      )}
    </View>
  );
}

function InviteModal({ visible, query, results, searching, searchFailed, invitingIds, invitedIds, bottom, onQueryChange, onClearQuery, onInvite, onDismiss }: {
  visible: boolean;
  query: string;
  results: InviteUser[];
  searching: boolean;
  searchFailed: boolean;
  invitingIds: Set<number>;
  invitedIds: Set<number>;
  bottom: number;
  onQueryChange: (q: string) => void;
  onClearQuery: () => void;
  onInvite: (user: InviteUser) => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      {/* One container for the backdrop and the sheet, so a screen reader stays
          inside the modal and can still reach the backdrop's close.

          It is also what lifts the sheet above the keyboard. The sheet sits at
          the bottom and the search field opens focused, so without this the
          keyboard covered the field and every result under it — typing a name
          showed nothing, and there was no Invite button anyone could reach. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        accessibilityViewIsModal
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={[styles.modalSheet, { paddingBottom: bottom + 20 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Invite Member</Text>
            <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.t2} />
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={15} color={colors.t3} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by username…"
              placeholderTextColor={colors.t3}
              value={query}
              onChangeText={onQueryChange}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            {query.length > 0 && (
              <Pressable onPress={onClearQuery} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.t3} />
              </Pressable>
            )}
          </View>

          {searching ? (
            <ActivityIndicator color={colors.teal} style={{ marginTop: 24 }} />
          ) : results.length > 0 ? (
            <FlatList
              style={styles.inviteList}
              data={results}
              keyExtractor={(user) => String(user.id)}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: user }) => (
                <View style={styles.inviteRow}>
                  <Avatar uri={user.profile_picture} name={user.username} size="sm" />
                  <Text style={styles.inviteUsername} numberOfLines={1}>@{user.username}</Text>
                  <Pressable
                    style={[styles.inviteBtn, (invitingIds.has(user.id) || invitedIds.has(user.id)) && styles.inviteBtnBusy]}
                    onPress={() => onInvite(user)}
                    disabled={invitingIds.has(user.id) || invitedIds.has(user.id)}
                  >
                    {invitingIds.has(user.id) ? (
                      <ActivityIndicator size="small" color={colors.bg} />
                    ) : (
                      <Text style={styles.inviteBtnText}>{invitedIds.has(user.id) ? 'Invited' : 'Invite'}</Text>
                    )}
                  </Pressable>
                </View>
              )}
            />
          ) : searchFailed ? (
            <Text style={styles.inviteEmpty}>Couldn’t search right now. Check your connection and try again.</Text>
          ) : query.trim().length > 0 && query.trim().length < MIN_INVITE_QUERY ? (
            <Text style={styles.inviteEmpty}>Type at least {MIN_INVITE_QUERY} characters.</Text>
          ) : query.trim().length > 0 ? (
            <Text style={styles.inviteEmpty}>No users found.</Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Everything behind the invite modal: its own search, its own debounce, and the
 * set of invites currently in flight.
 *
 * None of it is the screen's business — the screen opens the modal, and the
 * rest is between the modal and the server — so it lives here rather than as
 * six more pieces of state on a screen that already has plenty.
 */
function useClubInvite(clubId: number, members: ClubMember[]) {
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<InviteUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [invitingIds, setInvitingIds] = useState<Set<number>>(new Set());
  const [invitedIds, setInvitedIds] = useState<Set<number>>(new Set());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The query the list should be showing. A slow response for "mi" that lands
  // after the one for "miras" would otherwise replace the right results.
  const latestQuery = useRef('');

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  async function search(q: string) {
    setSearching(true);
    setSearchFailed(false);
    try {
      const { data } = await api.get<InviteUser[]>(`/api/users/search/?q=${encodeURIComponent(q)}`);
      if (latestQuery.current !== q) return;
      const memberIds = new Set(members.map((m) => m.user.id));
      setResults((Array.isArray(data) ? data : []).filter((u) => !memberIds.has(u.id)));
    } catch {
      if (latestQuery.current !== q) return;
      setResults([]);
      setSearchFailed(true);
    }
    // Reached unless a newer query took over, which owns the spinner now. Not a
    // `finally`, which React Compiler cannot compile.
    setSearching(false);
  }

  function onQueryChange(text: string) {
    setQuery(text);
    if (debounce.current) clearTimeout(debounce.current);
    const q = text.trim();
    latestQuery.current = q;
    setSearchFailed(false);
    // The server answers nothing below its minimum, which used to read as
    // "No users found" for a name that exists. The modal says what is missing
    // instead, and no request goes out.
    if (q.length < MIN_INVITE_QUERY) {
      setResults([]);
      setSearching(false);
      return;
    }
    debounce.current = setTimeout(() => search(q), 350);
  }

  function clearQuery() {
    if (debounce.current) clearTimeout(debounce.current);
    latestQuery.current = '';
    setQuery('');
    setResults([]);
    setSearching(false);
    setSearchFailed(false);
  }

  async function onInvite(user: InviteUser) {
    setInvitingIds((prev) => new Set(prev).add(user.id));
    try {
      // An invitation waits for their answer, so the roster does not change yet.
      // 201 is a new invitation and 200 one that was already waiting; both mean
      // this person has been asked.
      await clubsApi.invite(clubId, user.id);
      setInvitedIds((prev) => new Set(prev).add(user.id));
    } catch (e: any) {
      Alert.alert('Could not invite', inviteErrorMessage(e));
    }
    // Reached on both paths: the `catch` alerts and stops there.
    setInvitingIds((prev) => { const s = new Set(prev); s.delete(user.id); return s; });
  }

  return {
    open: () => setVisible(true),
    /** Spread straight onto `<InviteModal>`; `bottom` is the caller's inset. */
    modalProps: {
      visible,
      query,
      results,
      searching,
      searchFailed,
      invitingIds,
      invitedIds,
      onQueryChange,
      onClearQuery: clearQuery,
      onInvite,
      onDismiss: () => { setVisible(false); clearQuery(); },
    },
  };
}

/** What to tell an owner whose invitation did not go through. */
function inviteErrorMessage(e: any): string {
  const status = e?.response?.status;
  const detail = e?.response?.data?.detail;
  if (status === 404) return 'This person can’t be invited.';
  if (status === 429) return 'You’ve sent a lot of invitations and requests recently. Try again later.';
  if (typeof detail === 'string' && detail) return detail;
  if (!e?.response) return 'Check your connection and try again.';
  return 'Something went wrong. Try again.';
}

// ─── Screen ───────────────────────────────────────────────────────────────────
/**
 * Reads the route and hands the club id down as a `key`.
 *
 * The key is the whole point: navigating from one club to another can reuse
 * this screen rather than pushing a new one, and a reused component keeps the
 * state it already had — so the previous club stayed on screen while `clubId`
 * had already moved on. This used to be papered over with an effect that
 * re-derived `club`/`members`/`loading` from the cache whenever `clubId`
 * changed, which meant every such navigation rendered the stale club once and
 * then immediately re-rendered with the right one.
 *
 * Keying on the id makes a different club a different component instance, so
 * the `useState` initialisers below run again and the first render is already
 * correct. React's own answer to "reset all state when a prop changes".
 */
export default function ClubDetailScreen() {
  const { id, fromCreate } = useLocalSearchParams<{ id: string; fromCreate?: string }>();
  const clubId = Number(id);
  return <ClubDetail key={clubId} clubId={clubId} fromCreate={fromCreate} />;
}

function ClubDetail({ clubId, fromCreate }: { clubId: number; fromCreate?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const cached = _clubCache.get(clubId);

  const [club, setClub] = useState<Club | null>(cached?.club ?? null);
  const [members, setMembers] = useState<ClubMember[]>(cached?.members ?? []);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(cached === undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState(false);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await clubsApi.members(clubId);
      setMembers(res.data);
    } catch {}
  }, [clubId]);

  const invite = useClubInvite(clubId, members);

  const fetchAll = useCallback(async () => {
    const [clubRes, membersRes, meRes] = await Promise.allSettled([
      clubsApi.get(clubId),
      clubsApi.members(clubId),
      api.get<{ id: number }>('/api/users/me/'),
    ]);

    const fetchedMembers = membersRes.status === 'fulfilled' ? membersRes.value.data : [];
    setMembers(fetchedMembers);

    const meId = meRes.status === 'fulfilled' ? meRes.value.data.id : null;
    if (meId) setCurrentUserId(meId);

    // `fulfilled` only means the request didn't reject — an empty body still
    // resolves with `data: null`, and caching that would poison every later
    // visit to this club with a club-shaped `null`.
    if (clubRes.status === 'fulfilled' && clubRes.value.data) {
      let clubData = clubRes.value.data;
      if (meId && !clubData.my_role && !clubData.is_member) {
        const myMembership = fetchedMembers.find((m) => Number(m.user.id) === Number(meId));
        if (myMembership) {
          clubData = { ...clubData, my_role: myMembership.role, is_member: true };
        }
      }
      setClub(clubData);
      _clubCache.set(clubId, { club: clubData, members: fetchedMembers });
    }
  }, [clubId]);

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Promise `.finally`, as on the mount effect above: the spinner still stops
    // on rejection, but React Compiler can compile it — a `try/finally`
    // statement makes it bail on this whole screen.
    await fetchAll().finally(() => setRefreshing(false));
  }, [fetchAll]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const memberRecord = members.find((m) => Number(m.user.id) === Number(currentUserId));
  const isMember  = !!memberRecord || fromCreate === '1';
  // club.creator may come back as a bare id or a nested { id, username } object
  const creatorId = (club?.creator as any)?.id ?? club?.creator;
  const isCreator = (!!creatorId && Number(creatorId) === Number(currentUserId)) || fromCreate === '1';
  // Inviting is an owner's right on the server, not only the creator's, so a
  // promoted owner gets the button too.
  const canManage = isCreator || club?.my_role === 'owner' || memberRecord?.role === 'owner';

  // ── Join / Leave ──────────────────────────────────────────────────────────
  async function handleJoin() {
    setActioning(true);
    try {
      await clubsApi.join(clubId);
      await fetchAll();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not join club.');
    }
    // Reached on both paths: the `catch` alerts and stops there.
    setActioning(false);
  }

  async function handleLeave() {
    Alert.alert(
      'Leave Club',
      'Are you sure you want to leave this club?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setActioning(true);
            try {
              await clubsApi.leave(clubId);
              router.replace('/(tabs)/chat' as any);
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.detail ?? 'Could not leave club.');
              setActioning(false);
            }
          },
        },
      ],
    );
  }

  // ── Delete Club ───────────────────────────────────────────────────────────
  function handleDeleteClub() {
    // A real guard, not a `!` assertion: both callers of this function only
    // reach it once `club` has been confirmed non-null by the render below,
    // but the two are otherwise unconnected — this makes that true by
    // construction rather than by every caller remembering to check first.
    if (!club) return;
    Alert.alert(
      `Delete ${club.name}?`,
      'This removes all members and events and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setActioning(true);
            try {
              await clubsApi.deleteClub(clubId);
              router.replace('/(tabs)/chat' as any);
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.detail ?? 'Could not delete club.');
              setActioning(false);
            }
          },
        },
      ],
    );
  }

  // ── Club manage (creator header button) ───────────────────────────────────
  function openClubManage() {
    if (!club) return;
    Alert.alert(club.name, undefined, [
      { text: 'Delete Club', style: 'destructive', onPress: handleDeleteClub },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ── Member management ─────────────────────────────────────────────────────
  function openMemberMenu(member: ClubMember) {
    const options: any[] = [];
    if (member.role === 'member') {
      options.push({ text: 'Promote to Owner', onPress: () => confirmPromoteOwner(member) });
    }
    options.push({ text: 'Kick from Club', style: 'destructive', onPress: () => confirmKick(member) });
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(`@${member.user.username}`, undefined, options);
  }

  function confirmKick(member: ClubMember) {
    Alert.alert(
      'Kick Member',
      `Remove @${member.user.username} from the club?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Kick', style: 'destructive', onPress: () => handleKick(member) },
      ],
    );
  }

  function confirmPromoteOwner(member: ClubMember) {
    Alert.alert(
      'Promote to Owner',
      `Make @${member.user.username} an Owner?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Promote', onPress: () => handlePromoteOwner(member) },
      ],
    );
  }

  async function handleKick(member: ClubMember) {
    try {
      await clubsApi.kick(clubId, member.user.id);
      setMembers((prev) => prev.filter((m) => m.user.id !== member.user.id));
    } catch (error: any) {
      console.log('[Kick] error:', error.response?.status, JSON.stringify(error.response?.data));
      Alert.alert('Error', 'Could not kick member.');
    }
  }

  async function handlePromoteOwner(member: ClubMember) {
    try {
      await clubsApi.promoteOwner(clubId, member.user.id);
      await fetchMembers();
    } catch {
      Alert.alert('Error', 'Could not promote member.');
    }
  }

  // ── Loading / error ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: top }]}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  if (!club) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: top }]}>
        <Text style={styles.errorText}>Club not found.</Text>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backLinkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const myRole = memberRecord?.role;

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      {/* Header bar */}
      <View style={styles.headerBar}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </Pressable>
        <View style={styles.headerActions}>
          {actioning ? (
            <ActivityIndicator color={colors.teal} size="small" />
          ) : isCreator ? (
            <Button label="Manage" variant="ghost" size="sm" onPress={openClubManage} />
          ) : isMember ? (
            <Button label="Leave" variant="ghost" size="sm" onPress={handleLeave} />
          ) : (
            <Button label="Join" variant="primary" size="sm" onPress={handleJoin} />
          )}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
        contentContainerStyle={styles.scroll}
      >
        <ClubHero
          club={club}
          memberCount={members.length || club.member_count}
          myRole={myRole}
          isMember={isMember}
          onOpenChat={() =>
            router.push({
              pathname: '/clubs/[id]/chat',
              params: {
                id: club.id,
                name: club.name ?? '',
                emblem: club.emblem ?? '',
                memberCount: members.length || club.member_count,
              },
            } as any)
          }
        />

        <MembersSection
          members={members}
          canManage={canManage}
          isCreator={isCreator}
          currentUserId={currentUserId}
          onInvite={invite.open}
          onMemberMenu={openMemberMenu}
        />

        {/* Creator: Delete Club danger section */}
        {isCreator && (
          <View style={styles.dangerZone}>
            <Button label="Delete Club" variant="danger" size="md" fullWidth onPress={handleDeleteClub} />
          </View>
        )}
      </ScrollView>

      <InviteModal {...invite.modalProps} bottom={bottom} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: { width: 36 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  scroll: { paddingBottom: 40 },

  hero: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },

  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    backgroundColor: colors.teal,
    borderRadius: radius.l,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  chatBtnText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '700', color: colors.bg },

  emblem: { width: 88, height: 88, borderRadius: 44, marginBottom: 14 },
  emblemFallback: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emblemInitial: { fontFamily: fonts.display, fontSize: 34, fontWeight: '700', color: colors.teal },

  clubName: { fontFamily: fonts.display, fontSize: 26, fontWeight: '700', color: colors.t1, textAlign: 'center' },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },

  interestBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  interestIcon: { fontSize: 13 },
  interestName: { fontFamily: fonts.body, fontSize: 12, color: colors.t2 },

  memberCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  memberCountText: { fontFamily: fonts.body, fontSize: 12, color: colors.t3 },

  myRoleBadge: {
    marginTop: 10,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  myRoleText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.teal },

  description: {
    marginTop: 16,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t2,
    lineHeight: 21,
    textAlign: 'center',
  },

  section: { paddingHorizontal: 20, paddingTop: 8 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
  },

  inviteHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  inviteHeaderText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: colors.teal },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  memberInfo: { flex: 1 },
  memberName: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.t1 },
  memberRole: { fontFamily: fonts.body, fontSize: 12, color: colors.t3, marginTop: 2 },

  dangerZone: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },

  emptyText: { fontFamily: fonts.body, fontSize: 14, color: colors.t3, textAlign: 'center', paddingVertical: 24 },
  errorText: { fontFamily: fonts.body, fontSize: 15, color: colors.t3, marginBottom: 16 },
  backLink: { paddingHorizontal: 20, paddingVertical: 10 },
  backLinkText: { fontFamily: fonts.body, fontSize: 14, color: colors.teal },

  // Invite modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    maxHeight: '75%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: { fontFamily: fonts.display, fontSize: 18, fontWeight: '600', color: colors.t1 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface2,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t1,
    padding: 0,
  },

  inviteList: { maxHeight: 320 },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  inviteUsername: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: '500',
    color: colors.t1,
  },
  inviteBtn: {
    backgroundColor: colors.teal,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
    minWidth: 64,
    alignItems: 'center',
  },
  inviteBtnBusy: { opacity: 0.6 },
  inviteBtnText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.bg },

  inviteEmpty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t3,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
