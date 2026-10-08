import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  RefreshControl,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/services/api';
import { useContentActions } from '@/components/ContentActions';
import { sectionise } from '@/services/interestCategories';
import { type ClubRole } from '@/services/clubs';
import { Ionicons } from '@expo/vector-icons';
import { IconBack, IconMore } from '@/components/ui/icons';
import { RelationshipBadge } from '@/components/ui/RelationshipBadge';
import { ProfileLinks } from '@/components/ProfileLinks';
import { SwiftProfileSection } from '@/components/profile/SwiftProfileSection';
import { hiddenProfileMessage, profileDetailsHidden } from '@/components/profile/profilePrivacy';
import { PresenceDot } from '@/components/PresenceDot';
import { fonts, radius } from '@/constants/theme';
import { PROFESSIONS, COUNTRIES, flagEmoji } from '@/constants/onboardingData';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import type { ProfileLink } from '@/services/links';
import type { Presence } from '@/services/presence';

// ─── Types ────────────────────────────────────────────────────────────────────
type Relationship = 'stranger' | 'hi_sent' | 'hi_received' | 'connected' | 'friend';

interface Interest { icon: string; name: string; category?: string; category_label?: string; }

interface UserProfile {
  id: number;
  username: string;
  is_private?: boolean;
  can_view_swifts?: boolean;
  bio?: string;
  date_joined?: string;
  interests?: Interest[];
  relationship?: Relationship;
  profile_picture?: string;
  stats?: { friends: number; connections: number };
  links?: ProfileLink[];
  presence?: Presence;
  age?: number | null;
  nationality?: string | null;
  profession?: string | null;
  clubs?: { id: number; name: string; emblem?: string; role: ClubRole }[];
}

function isLocked(profile: UserProfile): boolean {
  return profileDetailsHidden(profile);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#be185d', '#0284c7'];

function avatarBg(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + (hash << 5) - hash;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'long' }); }
  catch { return ''; }
}

const makeRelColor = (colors: ColorPalette): Record<Relationship, string> => ({
  stranger:    colors.border,
  hi_sent:     colors.teal,
  hi_received: colors.teal,
  connected:   colors.orange,
  friend:      colors.blue,
});

// ─── Sections ─────────────────────────────────────────────────────────────────
// The screen below owns the profile and the relationship; each section only
// renders one band of it, so the screen reads as its own table of contents.

function ProfileHeader({ username, relationship, top, onBack, onMenu }: {
  username: string;
  relationship: Relationship;
  top: number;
  onBack: () => void;
  onMenu: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.header, { paddingTop: top + 6 }]}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.2 }]}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <IconBack size={24} color={colors.teal} />
      </Pressable>

      <View style={styles.headerCenter} accessible accessibilityRole="header">
        <Text style={styles.headerTitle} numberOfLines={1}>{username}</Text>
        <View style={styles.relRow}>
          <RelationshipBadge relationship={relationship} />
        </View>
      </View>

      <Pressable
        onPress={onMenu}
        hitSlop={12}
        style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.2 }]}
        accessibilityRole="button"
        accessibilityLabel={`More options for ${username}`}
      >
        <IconMore size={22} color={colors.t3} />
      </Pressable>
    </View>
  );
}

function ProfileHero({ profile, relationship, relColor, metaLine, locked }: {
  profile: UserProfile;
  relationship: Relationship;
  relColor: string;
  metaLine: string | null;
  locked: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const bg = avatarBg(profile.username);
  const initial = profile.username.charAt(0).toUpperCase();
  return (
    <View style={styles.hero}>
      {(relationship === 'friend' || relationship === 'connected') ? (
        <View style={[styles.avatarRing, { borderColor: relColor + '60' }]}>
          <View style={[styles.avatar, { backgroundColor: bg }]}>
            {profile.profile_picture
              ? <Image source={{ uri: profile.profile_picture }} style={styles.avatarImage} />
              : <Text style={styles.avatarInitial}>{initial}</Text>
            }
          </View>
        </View>
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Ionicons name="person-outline" size={38} color={colors.t3} />
        </View>
      )}

      <Text style={styles.username}>{profile.username}</Text>

      {metaLine ? (
        <Text style={styles.userMetaLine}>{metaLine}</Text>
      ) : null}

      {profile.presence && (
        <View style={styles.presenceRow}>
          <PresenceDot presence={profile.presence} size={9} withText />
        </View>
      )}

      {locked ? (
        <View style={styles.lockedBox}>
          <Text style={styles.lockedTitle}>Profile details hidden</Text>
          <Text style={styles.lockedBody}>
            {hiddenProfileMessage(profile, relationship)}
          </Text>
        </View>
      ) : (
        <>
          {profile.bio
            ? <Text style={styles.bio}>{profile.bio}</Text>
            : <Text style={styles.bioEmpty}>No bio</Text>
          }
          {profile.date_joined && (
            <Text style={styles.joinDate}>Member since {fmtDate(profile.date_joined)}</Text>
          )}
        </>
      )}
    </View>
  );
}

/** Grouped like everywhere else. On somebody else's profile this is what the
 *  list is actually for: "mostly climbing and cycling" reads in a glance where
 *  twenty ungrouped chips do not. */
function InterestsSection({ interests }: { interests: Interest[] }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  if (interests.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Interests</Text>
      {sectionise(interests).map((group, index, all) => (
        <View
          key={group.key || 'more'}
          style={index > 0 ? styles.interestGroup : undefined}
        >
          {all.length > 1 && (
            <View style={styles.interestGroupHeader}>
              <Ionicons name={group.icon} size={13} color={group.color} />
              <Text style={styles.interestGroupLabel}>{group.label}</Text>
            </View>
          )}
          <View style={styles.chipWrap}>
            {group.items.map((tag) => (
              <View key={tag.name} style={styles.chip}>
                <Text style={styles.chipText}>{tag.name}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function ClubsSection({ clubs, onOpenClub }: {
  clubs: UserProfile['clubs'];
  onOpenClub: (clubId: number) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Clubs</Text>
      {!clubs || clubs.length === 0 ? (
        <Text style={styles.clubsEmpty}>Not a member of any clubs yet</Text>
      ) : (
        clubs.map(club => (
          <Pressable
            key={club.id}
            style={({ pressed }) => [styles.clubRow, pressed && { opacity: 0.7 }]}
            onPress={() => onOpenClub(club.id)}
          >
            {club.emblem ? (
              <Image source={{ uri: club.emblem }} style={styles.clubEmblem} />
            ) : (
              <View style={styles.clubEmblemFallback}>
                <Ionicons name="people-outline" size={18} color={colors.t3} />
              </View>
            )}
            <Text style={styles.clubName} numberOfLines={1}>{club.name}</Text>
            {club.role && (
              <View style={styles.clubRoleBadge}>
                <Text style={styles.clubRoleText}>
                  {club.role === 'owner' ? '👑 Owner' : 'Member'}
                </Text>
              </View>
            )}
          </Pressable>
        ))
      )}
    </View>
  );
}

/** The one button whose meaning depends entirely on where the two of you
 *  already stand. */
function RelationshipActions({ relationship, actionLoading, onSendHi, onAcceptHi, onMessage }: {
  relationship: Relationship;
  actionLoading: string | null;
  onSendHi: () => void;
  onAcceptHi: () => void;
  onMessage: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      {relationship === 'stranger' && (
        <Pressable
          style={({ pressed }) => [styles.btnPrimary, actionLoading === 'hi' && styles.btnOff, pressed && { opacity: 0.8 }]}
          onPress={onSendHi}
          disabled={actionLoading !== null}
        >
          {actionLoading === 'hi'
            ? <ActivityIndicator color={colors.bg} size="small" />
            : <Text style={styles.btnPrimaryText}>Send Hi 👋</Text>
          }
        </Pressable>
      )}
      {relationship === 'hi_sent' && (
        <Pressable style={[styles.btnPrimary, styles.btnOff]} disabled>
          <Text style={styles.btnPrimaryText}>Hi Sent ✓</Text>
        </Pressable>
      )}
      {relationship === 'hi_received' && (
        <Pressable
          style={({ pressed }) => [styles.btnPrimary, actionLoading === 'accept' && styles.btnOff, pressed && { opacity: 0.8 }]}
          onPress={onAcceptHi}
          disabled={actionLoading !== null}
        >
          {actionLoading === 'accept'
            ? <ActivityIndicator color={colors.bg} size="small" />
            : <Text style={styles.btnPrimaryText}>Accept Hi 👋</Text>
          }
        </Pressable>
      )}
      {(relationship === 'connected' || relationship === 'friend') && (
        <Pressable
          style={({ pressed }) => [styles.btnPrimary, pressed && { opacity: 0.8 }]}
          onPress={onMessage}
        >
          <Text style={styles.btnPrimaryText}>Message 💬</Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function UserProfileScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const REL_COLOR = useMemo(() => makeRelColor(colors), [colors]);
  const { id, username: usernameParam } = useLocalSearchParams<{ id: string; username?: string }>();
  const { top } = useSafeAreaInsets();

  const [profile,       setProfile]       = useState<UserProfile | null>(null);
  const [relationship,  setRelationship]  = useState<Relationship>('stranger');
  const [loading,       setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { present, sheets } = useContentActions();

  const profileRequest = useRef<AbortController | null>(null);
  const loadProfile = useCallback(async () => {
    profileRequest.current?.abort();
    const controller = new AbortController();
    profileRequest.current = controller;
    // Revalidate before rendering personal details or starting a Swift request.
    setProfile(null);
    setRelationship('stranger');
    setLoading(true);
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId < 1) { setLoading(false); return; }
    await api.get<UserProfile>(`/api/users/profile/${numId}/`, { signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return;
      setProfile(data);
      setRelationship(data.relationship ?? 'stranger');
    }).catch(() => {
      if (!controller.signal.aborted) setProfile(null);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
  }, [id]);

  useFocusEffect(useCallback(() => {
    void loadProfile();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadProfile();
      else { profileRequest.current?.abort(); setProfile(null); }
    });
    return () => { subscription.remove(); profileRequest.current?.abort(); setProfile(null); };
  }, [loadProfile]));


  async function sendHi() {
    setActionLoading('hi');
    try {
      await api.post('/api/friends/hi/', { receiver_id: Number(id) });
      setRelationship('hi_sent');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not send Hi.');
    }
    // Reached on both paths: the `catch` alerts and stops there. Not a
    // `finally` — React Compiler bails on any component containing one.
    setActionLoading(null);
  }

  async function acceptHi() {
    setActionLoading('accept');
    try {
      await api.post('/api/friends/hi/accept/', { sender_id: Number(id) });
      setRelationship('connected');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not accept Hi.');
    }
    // Reached on both paths: the `catch` alerts and stops there.
    setActionLoading(null);
  }

  function goToMessages() {
    router.push({ pathname: '/messages/[id]', params: { id: id!, username: profile?.username ?? usernameParam ?? 'Chat' } });
  }

  // Report and Block, through the same menu every other surface uses.
  //
  // What was here before is worth recording, because it is exactly what App
  // Review found: "Report User" posted to `/api/users/report/<id>/`, a route
  // that did not exist, swallowed the resulting 404 in a bare `catch {}`, and
  // then showed "Thank you — our team will review this account" unconditionally.
  // Nobody was ever reported and every reporter was told they had been.
  //
  // The shared sheet cannot do that: `services/reporting` throws on every
  // non-2xx, and the confirmation state is only reachable after the server has
  // accepted the report.
  function openMenu() {
    const username = profile?.username ?? 'this user';
    present({
      target: 'user',
      targetId: Number(id),
      subject: `@${username}`,
      authorId: Number(id),
      authorUsername: username,
      authorAvatar: profile?.profile_picture,
      // Leaving somebody's profile open after blocking them reads as the block
      // not having worked.
      onRemoved: () => router.back(),
    });
  }

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.errorText}>Profile not found</Text>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backLink, pressed && { opacity: 0.2 }]}
        >
          <Text style={styles.backLinkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const rel      = relationship;
  const relColor = REL_COLOR[rel];
  const interests = profile.interests ?? [];
  const locked   = isLocked(profile);

  const age = typeof profile.age === 'number' && Number.isFinite(profile.age) ? profile.age : null;
  // The lookup and the `?? null` are separate statements because a `??` inside
  // a ternary branch is a logical test block React Compiler cannot lower, and
  // it gives up on the whole screen when it meets one.
  const natFound  = profile.nationality ? COUNTRIES.find(c => c.code === profile.nationality) : undefined;
  const profFound = profile.profession  ? PROFESSIONS.find(p => p.key === profile.profession) : undefined;
  const natInfo  = natFound  ?? null;
  const profInfo = profFound ?? null;
  // Built by pushing rather than as an array of ternaries filtered down: a
  // ternary feeding a logical test is a shape React Compiler cannot lower, and
  // it gives up on the whole screen when it meets one.
  const metaParts: string[] = [];
  if (natInfo) metaParts.push(`${flagEmoji(natInfo.code)} ${natInfo.name}`);
  if (profInfo) metaParts.push(`${profInfo.emoji} ${profInfo.label}`);
  if (age !== null) metaParts.push(String(age));
  const metaLine = metaParts.length > 0 ? metaParts.join(' · ') : null;

  return (
    <View style={styles.root}>
      {sheets}
      <ProfileHeader
        username={profile.username}
        relationship={rel}
        top={top}
        onBack={() => router.back()}
        onMenu={openMenu}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void loadProfile(); }} tintColor={colors.teal} />}>
        <ProfileHero
          profile={profile}
          relationship={rel}
          relColor={relColor}
          metaLine={metaLine}
          locked={locked}
        />

        {profile.can_view_swifts === true && !locked && <SwiftProfileSection creatorId={profile.id} canView />}

        <InterestsSection interests={interests} />

        {/* ── Links ── */}
        {(profile.links?.length ?? 0) > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Links</Text>
            <ProfileLinks links={profile.links!} />
          </View>
        )}

        <ClubsSection
          clubs={profile.clubs}
          onOpenClub={(clubId) => router.push({ pathname: '/clubs/[id]', params: { id: clubId } })}
        />

        <RelationshipActions
          relationship={rel}
          actionLoading={actionLoading}
          onSendHi={sendHi}
          onAcceptHi={acceptHi}
          onMessage={goToMessages}
        />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  headerBtn: { width: 34, alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 16,
    color: colors.t1,
  },
  relRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },

  scroll: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 60 },

  hero: { alignItems: 'center', marginBottom: 36 },
  avatarRing: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  avatar: {
    width: 86, height: 86, borderRadius: 43,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontSize: 34, fontWeight: '700' },
  avatarImage:   { width: 86, height: 86, borderRadius: 43 },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },

  username:     { fontFamily: fonts.display, fontWeight: '700', fontSize: 22, color: colors.t1, marginBottom: 6 },
  userMetaLine: { fontFamily: fonts.body, fontSize: 13, color: colors.t2, textAlign: 'center', marginBottom: 8 },
  presenceRow:  { marginBottom: 10 },
  bio:        { fontFamily: fonts.body, fontSize: 14, color: colors.t2, lineHeight: 20, textAlign: 'center', maxWidth: 280, marginBottom: 12 },
  bioEmpty:   { fontFamily: fonts.body, fontSize: 13, color: colors.t3, marginBottom: 12 },
  joinDate:   { fontFamily: fonts.body, fontSize: 12, color: colors.t3 },

  lockedBox:  { alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 12, paddingHorizontal: 24 },
  lockedTitle: { fontFamily: fonts.display, fontWeight: '600', fontSize: 15, color: colors.t1 },
  lockedBody:  { fontFamily: fonts.body, fontSize: 13, color: colors.t2, lineHeight: 19, textAlign: 'center' },

  section:      { marginBottom: 28 },
  sectionTitle: {
    fontFamily: fonts.body, fontWeight: '700', fontSize: 10,
    letterSpacing: 1.2, textTransform: 'uppercase', color: colors.t3, marginBottom: 12,
  },

  interestGroup: { marginTop: 14 },
  interestGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  interestGroupLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: colors.t2,
  },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.tealTint,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.tealLine,
  },
  chipText: { fontFamily: fonts.body, fontWeight: '500', fontSize: 13, color: colors.teal },

  clubsEmpty: { fontFamily: fonts.body, fontSize: 13, color: colors.t3, textAlign: 'center', paddingVertical: 8 },
  clubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  clubEmblem: { width: 36, height: 36, borderRadius: 8 },
  clubEmblemFallback: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clubName: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.t1 },
  clubRoleBadge: {
    backgroundColor: colors.tealTint,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.tealLine,
  },
  clubRoleText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600', color: colors.teal },

  btnRow: { flexDirection: 'row', gap: 12 },
  btnPrimary: {
    backgroundColor: colors.teal,
    borderRadius: radius.m,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnPrimaryText: { fontFamily: fonts.body, fontWeight: '700', fontSize: 15, color: colors.bg },
  btnSecondary: {
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: { fontFamily: fonts.body, fontWeight: '600', fontSize: 15, color: colors.t2 },
  btnOff: { opacity: 0.55 },

  errorText:    { fontFamily: fonts.body, fontSize: 16, color: colors.t2, marginBottom: 16 },
  backLink:     { paddingVertical: 10 },
  backLinkText: { fontFamily: fonts.body, fontSize: 14, color: colors.teal },
});
