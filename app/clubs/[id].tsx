import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ClubDetailScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, fromCreate } = useLocalSearchParams<{ id: string; fromCreate?: string }>();
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const clubId = Number(id);
  const cached = _clubCache.get(clubId);

  const [club, setClub] = useState<Club | null>(cached?.club ?? null);
  const [members, setMembers] = useState<ClubMember[]>(cached?.members ?? []);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(cached === undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState(false);

  // Invite modal
  const [showInvite, setShowInvite] = useState(false);
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState<InviteUser[]>([]);
  const [searchingInvite, setSearchingInvite] = useState(false);
  const [invitingIds, setInvitingIds] = useState<Set<number>>(new Set());
  const inviteDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await clubsApi.members(clubId);
      setMembers(res.data);
    } catch {}
  }, [clubId]);

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

    if (clubRes.status === 'fulfilled') {
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
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const memberRecord = members.find((m) => Number(m.user.id) === Number(currentUserId));
  const isMember  = !!memberRecord || fromCreate === '1';
  const isOwner   = memberRecord?.role === 'owner' || (fromCreate === '1' && !memberRecord);
  // club.creator may come back as a bare id or a nested { id, username } object
  const creatorId = (club?.creator as any)?.id ?? club?.creator;
  const isCreator = (!!creatorId && Number(creatorId) === Number(currentUserId)) || fromCreate === '1';
  const canManage = isCreator;

  // ── Join / Leave ──────────────────────────────────────────────────────────
  async function handleJoin() {
    setActioning(true);
    try {
      await clubsApi.join(clubId);
      await fetchAll();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not join club.');
    } finally {
      setActioning(false);
    }
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
    Alert.alert(
      `Delete ${club!.name}?`,
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
    Alert.alert(club!.name, undefined, [
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

  // ── Invite ────────────────────────────────────────────────────────────────
  function onInviteQueryChange(text: string) {
    setInviteQuery(text);
    if (inviteDebounce.current) clearTimeout(inviteDebounce.current);
    if (!text.trim()) { setInviteResults([]); return; }
    inviteDebounce.current = setTimeout(() => searchInviteUsers(text.trim()), 350);
  }

  async function searchInviteUsers(q: string) {
    setSearchingInvite(true);
    try {
      const { data } = await api.get<InviteUser[]>(`/api/users/search/?q=${encodeURIComponent(q)}`);
      const memberIds = new Set(members.map((m) => m.user.id));
      setInviteResults(data.filter((u) => !memberIds.has(u.id)));
    } catch {
      setInviteResults([]);
    } finally {
      setSearchingInvite(false);
    }
  }

  async function handleInvite(user: InviteUser) {
    setInvitingIds((prev) => new Set(prev).add(user.id));
    try {
      await clubsApi.invite(clubId, user.id);
      await fetchMembers();
      setInviteResults((prev) => prev.filter((u) => u.id !== user.id));
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not invite user.');
    } finally {
      setInvitingIds((prev) => { const s = new Set(prev); s.delete(user.id); return s; });
    }
  }

  function closeInviteModal() {
    setShowInvite(false);
    setInviteQuery('');
    setInviteResults([]);
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
        {/* Club hero */}
        <View style={styles.hero}>
          {club.emblem ? (
            <Image source={{ uri: club.emblem }} style={styles.emblem} />
          ) : (
            <View style={styles.emblemFallback}>
              <Text style={styles.emblemInitial}>{club.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}

          <Text style={styles.clubName}>{club.name}</Text>

          <View style={styles.metaRow}>
            {club.interest && (
              <View style={styles.interestBadge}>
                <Text style={styles.interestIcon}>{club.interest.icon}</Text>
                <Text style={styles.interestName}>{club.interest.name}</Text>
              </View>
            )}
            <View style={styles.memberCountBadge}>
              <Ionicons name="people-outline" size={13} color={colors.t3} />
              <Text style={styles.memberCountText}>{members.length || club.member_count}</Text>
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
            <Pressable
              style={styles.chatBtn}
              onPress={() =>
                router.push({
                  pathname: '/clubs/[id]/chat',
                  params: {
                    id: club.id,
                    name: club.name,
                    emblem: club.emblem ?? '',
                    memberCount: members.length || club.member_count,
                  },
                } as any)
              }
            >
              <Ionicons name="chatbubbles-outline" size={18} color={colors.bg} />
              <Text style={styles.chatBtnText}>Open Club Chat</Text>
            </Pressable>
          )}
        </View>

        {/* Members section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>MEMBERS</Text>
            {canManage && (
              <Pressable style={styles.inviteHeaderBtn} onPress={() => setShowInvite(true)} hitSlop={10}>
                <Ionicons name="person-add-outline" size={15} color={colors.teal} />
                <Text style={styles.inviteHeaderText}>Invite</Text>
              </Pressable>
            )}
          </View>

          {members.map((m) => {
            return (
              <MemberRow
                key={m.user.id}
                member={m}
                viewerIsCreator={isCreator}
                currentUserId={currentUserId}
                onMenu={openMemberMenu}
              />
            );
          })}
          {members.length === 0 && (
            <Text style={styles.emptyText}>No members yet.</Text>
          )}
        </View>

        {/* Creator: Delete Club danger section */}
        {isCreator && (
          <View style={styles.dangerZone}>
            <Button label="Delete Club" variant="danger" size="md" fullWidth onPress={handleDeleteClub} />
          </View>
        )}
      </ScrollView>

      {/* Invite modal */}
      <Modal
        visible={showInvite}
        transparent
        animationType="slide"
        onRequestClose={closeInviteModal}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeInviteModal} />
        <View style={[styles.modalSheet, { paddingBottom: bottom + 20 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Invite Member</Text>
            <Pressable onPress={closeInviteModal} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.t2} />
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={15} color={colors.t3} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by username…"
              placeholderTextColor={colors.t3}
              value={inviteQuery}
              onChangeText={onInviteQueryChange}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            {inviteQuery.length > 0 && (
              <Pressable onPress={() => { setInviteQuery(''); setInviteResults([]); }} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.t3} />
              </Pressable>
            )}
          </View>

          {searchingInvite ? (
            <ActivityIndicator color={colors.teal} style={{ marginTop: 24 }} />
          ) : inviteResults.length > 0 ? (
            <ScrollView style={styles.inviteList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {inviteResults.map((user) => (
                <View key={user.id} style={styles.inviteRow}>
                  <Avatar uri={user.profile_picture} name={user.username} size="sm" />
                  <Text style={styles.inviteUsername} numberOfLines={1}>@{user.username}</Text>
                  <Pressable
                    style={[styles.inviteBtn, invitingIds.has(user.id) && styles.inviteBtnBusy]}
                    onPress={() => handleInvite(user)}
                    disabled={invitingIds.has(user.id)}
                  >
                    {invitingIds.has(user.id) ? (
                      <ActivityIndicator size="small" color={colors.bg} />
                    ) : (
                      <Text style={styles.inviteBtnText}>Invite</Text>
                    )}
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : inviteQuery.length > 0 ? (
            <Text style={styles.inviteEmpty}>No users found.</Text>
          ) : null}
        </View>
      </Modal>
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
