import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { clubsApi, type Club, type ClubMember, type ClubRole } from '@/services/clubs';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { colors, fonts, radius } from '@/constants/theme';

function roleBadge(role: ClubRole) {
  if (role === 'president') return '👑';
  if (role === 'vice') return '⭐';
  return '';
}

function roleLabel(role: ClubRole) {
  if (role === 'president') return 'President';
  if (role === 'vice') return 'Vice';
  return 'Member';
}

function MemberRow({
  member,
  isPresident,
  currentUserId,
  onManage,
}: {
  member: ClubMember;
  isPresident: boolean;
  currentUserId?: number;
  onManage: (member: ClubMember) => void;
}) {
  const isSelf = member.id === currentUserId;
  return (
    <View style={styles.memberRow}>
      <Avatar uri={member.profile_picture} name={member.username} size="sm" />
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>
          {roleBadge(member.role)} @{member.username}
        </Text>
        <Text style={styles.memberRole}>{roleLabel(member.role)}</Text>
      </View>
      {isPresident && !isSelf && (
        <Pressable onPress={() => onManage(member)} hitSlop={10}>
          <Ionicons name="ellipsis-vertical" size={16} color={colors.t3} />
        </Pressable>
      )}
    </View>
  );
}

export default function ClubDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { top } = useSafeAreaInsets();

  const [club, setClub] = useState<Club | null>(null);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState(false);

  const clubId = Number(id);

  const fetchAll = useCallback(async () => {
    const [clubRes, membersRes] = await Promise.allSettled([
      clubsApi.get(clubId),
      clubsApi.members(clubId),
    ]);
    if (clubRes.status === 'fulfilled') setClub(clubRes.value.data);
    if (membersRes.status === 'fulfilled') setMembers(membersRes.value.data);
  }, [clubId]);

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

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
    Alert.alert('Leave Club', `Leave ${club?.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          setActioning(true);
          try {
            await clubsApi.leave(clubId);
            router.back();
          } catch (e: any) {
            Alert.alert('Error', e?.response?.data?.detail ?? 'Could not leave club.');
            setActioning(false);
          }
        },
      },
    ]);
  }

  function openManage(member: ClubMember) {
    Alert.alert(`@${member.username}`, undefined, [
      {
        text: member.role === 'vice' ? 'Demote to Member' : 'Promote to Vice',
        onPress: () => handlePromote(member),
      },
      { text: 'Transfer Presidency', onPress: () => handleTransfer(member) },
      { text: 'Kick from Club', style: 'destructive', onPress: () => handleKick(member) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleKick(member: ClubMember) {
    try {
      await clubsApi.kick(clubId, member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch {
      Alert.alert('Error', 'Could not kick member.');
    }
  }

  async function handlePromote(member: ClubMember) {
    try {
      await clubsApi.promote(clubId, member.id);
      await fetchAll();
    } catch {
      Alert.alert('Error', 'Could not change role.');
    }
  }

  function openClubManage() {
    Alert.alert(club!.name, 'Club management', [
      {
        text: 'Leave Club',
        style: 'destructive',
        onPress: handleLeave,
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleTransfer(member: ClubMember) {
    Alert.alert(
      'Transfer Presidency',
      `Make @${member.username} the new president? You will become Vice.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Transfer', style: 'destructive', onPress: async () => {
            try {
              await clubsApi.transfer(clubId, member.id);
              await fetchAll();
            } catch {
              Alert.alert('Error', 'Could not transfer presidency.');
            }
          },
        },
      ],
    );
  }

  const isPresident = club?.role === 'president';
  const isMember = !!club?.role || !!club?.is_member;

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
          ) : isPresident ? (
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
              <Text style={styles.memberCountText}>{club.member_count}</Text>
            </View>
          </View>

          {club.role && (
            <View style={styles.myRoleBadge}>
              <Text style={styles.myRoleText}>{roleBadge(club.role)} {roleLabel(club.role)}</Text>
            </View>
          )}

          {club.description ? (
            <Text style={styles.description}>{club.description}</Text>
          ) : null}
        </View>

        {/* Members */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>MEMBERS</Text>
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              isPresident={isPresident}
              onManage={openManage}
            />
          ))}
          {members.length === 0 && (
            <Text style={styles.emptyText}>No members yet.</Text>
          )}
        </View>

        {/* President: leave option via danger button */}
        {isPresident && (
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 }}>
            <Button label="Leave Club" variant="danger" size="md" fullWidth onPress={handleLeave} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
  sectionTitle: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

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

  emptyText: { fontFamily: fonts.body, fontSize: 14, color: colors.t3, textAlign: 'center', paddingVertical: 24 },
  errorText: { fontFamily: fonts.body, fontSize: 15, color: colors.t3, marginBottom: 16 },
  backLink: { paddingHorizontal: 20, paddingVertical: 10 },
  backLinkText: { fontFamily: fonts.body, fontSize: 14, color: colors.teal },
});
