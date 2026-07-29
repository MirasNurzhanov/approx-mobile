import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/services/api';
import { blockUser } from '@/services/blocked';
import { AuraMark } from '@/components/ui/AuraMark';
import { IconBack, IconMore } from '@/components/ui/icons';
import { RelationshipBadge } from '@/components/ui/RelationshipBadge';
import { ProfileLinks } from '@/components/ProfileLinks';
import { PresenceDot } from '@/components/PresenceDot';
import type { ProfileLink } from '@/services/links';
import type { Presence } from '@/services/presence';

// ─── Types ────────────────────────────────────────────────────────────────────
type Relationship = 'stranger' | 'hi_sent' | 'hi_received' | 'connected' | 'friend';

interface Interest {
  icon: string;
  name: string;
}

interface UserProfile {
  id: number;
  username: string;
  is_private?: boolean;
  bio?: string;
  date_joined?: string;
  interests?: Interest[];
  relationship?: Relationship;
  aura_points?: number;
  profile_picture?: string;
  stats?: { friends: number; connections: number; quests: number };
  // Absent entirely when the viewer isn't allowed to see them.
  links?: ProfileLink[];
  presence?: Presence;
}

// The server omits anything this viewer may not see, so "did the field arrive"
// is the only question worth asking here — never "should I draw it".
function isLocked(profile: UserProfile): boolean {
  return !!profile.is_private && !('bio' in profile);
}

// ─── Constants ────────────────────────────────────────────────────────────────
// Ring tint only. The label and glyph now come from RelationshipBadge, so
// colour is no longer the sole carrier of the relationship.
const REL_COLOR: Record<Relationship, string> = {
  stranger:    '#FFFFFF',
  hi_sent:     '#00b4a6',
  hi_received: '#00b4a6',
  connected:   '#FF9500',
  friend:      '#007AFF',
};

const AVATAR_COLORS = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#be185d', '#0284c7'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function avatarBg(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + (hash << 5) - hash;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'long' });
  } catch {
    return '';
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function UserProfileScreen() {
  const router = useRouter();
  const { id, username: usernameParam } = useLocalSearchParams<{ id: string; username?: string }>();
  const { top } = useSafeAreaInsets();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [relationship, setRelationship] = useState<Relationship>('stranger');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    const numId = Number(id);
    console.log('[UserProfile] fetching profile + relationship for id:', numId);

    Promise.allSettled([
      api.get<UserProfile>(`/api/users/profile/${numId}/`),
      api.get<{ friends: { id: number }[]; connections: { id: number }[] }>('/api/friends/list/'),
      api.get<{ id: number; sender?: { id: number }; from_user?: { id: number } }[]>('/api/friends/requests/'),
      api.get<{ id: number; relationship?: string }[]>('/api/proximity/nearby/'),
    ]).then(([profileRes, friendsRes, requestsRes, nearbyRes]) => {
      if (profileRes.status === 'fulfilled') {
        console.log('[UserProfile] profile:', JSON.stringify(profileRes.value.data).slice(0, 300));
        setProfile(profileRes.value.data);

        // If the profile endpoint already returns relationship, trust it and stop
        if (profileRes.value.data.relationship) {
          setRelationship(profileRes.value.data.relationship);
          return;
        }
      } else {
        console.log('[UserProfile] profile error:', profileRes.reason?.response?.status);
      }

      // Derive relationship from other sources, in priority order
      let rel: Relationship = 'stranger';

      if (friendsRes.status === 'fulfilled') {
        const { friends, connections } = friendsRes.value.data;
        if (friends.some((u) => Number(u.id) === numId)) {
          rel = 'friend';
        } else if (connections.some((u) => Number(u.id) === numId)) {
          rel = 'connected';
        }
      }

      if (rel === 'stranger' && requestsRes.status === 'fulfilled') {
        const reqs = Array.isArray(requestsRes.value.data) ? requestsRes.value.data : [];
        const received = reqs.some((r) => Number(r.sender?.id ?? r.from_user?.id) === numId);
        if (received) rel = 'hi_received';
      }

      if (rel === 'stranger' && nearbyRes.status === 'fulfilled') {
        const found = (nearbyRes.value.data ?? []).find((u) => Number(u.id) === numId);
        if (found?.relationship) rel = found.relationship as Relationship;
      }

      console.log('[UserProfile] derived relationship:', rel);
      setRelationship(rel);
    }).finally(() => setLoading(false));
  }, [id]);

  // ── Actions ──────────────────────────────────────────────────────────────
  async function sendHi() {
    setActionLoading('hi');
    try {
      await api.post('/api/friends/hi/', { receiver_id: Number(id) });
      setRelationship('hi_sent');
    } catch (e: any) {
      console.log('[UserProfile] sendHi error:', e?.response?.status, JSON.stringify(e?.response?.data));
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not send Hi.');
    } finally {
      setActionLoading(null);
    }
  }

  async function acceptHi() {
    setActionLoading('accept');
    try {
      await api.post('/api/friends/hi/accept/', { sender_id: Number(id) });
      setRelationship('connected');
    } catch (e: any) {
      console.log('[UserProfile] acceptHi error:', e?.response?.status, JSON.stringify(e?.response?.data));
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not accept Hi.');
    } finally {
      setActionLoading(null);
    }
  }

  function goToMessages() {
    router.push({
      pathname: '/messages/[id]',
      params: { id: id!, username: profile?.username ?? usernameParam ?? 'Chat' },
    });
  }

  function openMenu() {
    const username = profile?.username ?? 'this user';
    const options = ['Block User', 'Report User', 'Cancel'];

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 2, destructiveButtonIndex: 0 },
        (index) => {
          if (index === 0) confirmBlock(username);
          if (index === 1) confirmReport(username);
        },
      );
    } else {
      Alert.alert(username, undefined, [
        { text: 'Block User',  style: 'destructive', onPress: () => confirmBlock(username) },
        { text: 'Report User', onPress: () => confirmReport(username) },
        { text: 'Cancel',      style: 'cancel' },
      ]);
    }
  }

  function confirmBlock(username: string) {
    Alert.alert(
      `Block ${username}?`,
      'They will no longer be able to see you or contact you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser({
                id: Number(id),
                username,
                profile_picture: profile?.profile_picture,
              });
              router.back();
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.detail ?? 'Could not block user.');
            }
          },
        },
      ],
    );
  }

  function confirmReport(username: string) {
    Alert.alert(
      `Report ${username}?`,
      'Our team will review this account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.post(`/api/users/report/${id}/`);
              Alert.alert('Reported', 'Thank you — our team will review this account.');
            } catch {
              Alert.alert('Reported', 'Thank you — our team will review this account.');
            }
          },
        },
      ],
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color="#00b4a6" size="large" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.errorText}>Profile not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backLinkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const rel = relationship;
  const relColor = REL_COLOR[rel];
  const bg = avatarBg(profile.username);
  const initial = profile.username.charAt(0).toUpperCase();
  const interests = profile.interests ?? [];
  const locked = isLocked(profile);

  return (
    <View style={styles.root}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: top + 6 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <IconBack size={24} color="#00b4a6" />
        </TouchableOpacity>

        <View style={styles.headerCenter} accessible accessibilityRole="header">
          <Text style={styles.headerTitle} numberOfLines={1}>{profile.username}</Text>
          {/* The relationship was a coloured dot plus grey text at 2.65:1 —
              unreadable, and meaningless in greyscale. The badge carries a
              glyph and a word as well as the colour. */}
          <View style={styles.relRow}>
            <RelationshipBadge relationship={rel} />
          </View>
        </View>

        <TouchableOpacity
          onPress={openMenu}
          hitSlop={12}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${profile.username}`}
          accessibilityHint="Block or report this account"
        >
          <IconMore size={22} color="#9C9CA6" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Avatar ── */}
        <View style={styles.hero}>
          <View style={[styles.avatarRing, { borderColor: relColor + '60' }]}>
            <View style={[styles.avatar, { backgroundColor: bg }]}>
              {profile.profile_picture ? (
                <Image source={{ uri: profile.profile_picture }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarInitial}>{initial}</Text>
              )}
            </View>
          </View>

          <Text style={styles.username}>{profile.username}</Text>

          {/* Absent presence renders nothing at all. A private account the
              viewer has not been approved for never carries the key, so this
              disappears alongside the rest of the profile rather than sitting
              there as a lone grey dot. */}
          {profile.presence && (
            <View style={styles.presenceRow}>
              <PresenceDot presence={profile.presence} size={9} withText />
            </View>
          )}

          {locked ? (
            <View style={styles.lockedBox}>
              <Text style={styles.lockedTitle}>This account is private</Text>
              <Text style={styles.lockedBody}>
                {rel === 'hi_sent'
                  ? 'Your request is waiting for them to accept.'
                  : 'Send a Hi to ask for access. If they accept, you’ll see their full profile.'}
              </Text>
            </View>
          ) : (
            <>
              {profile.bio ? (
                <Text style={styles.bio}>{profile.bio}</Text>
              ) : (
                <Text style={styles.bioEmpty}>No bio</Text>
              )}

              {profile.aura_points != null && (
                <View style={styles.auraRow}>
                  <AuraMark size={15} color="#8b5cf6" />
                  <Text style={styles.auraValue}>{profile.aura_points.toLocaleString()}</Text>
                  <Text style={styles.auraLabel}>Aura Points</Text>
                </View>
              )}

              {profile.date_joined && (
                <Text style={styles.joinDate}>Member since {fmtDate(profile.date_joined)}</Text>
              )}
            </>
          )}
        </View>

        {/* ── Interests ── */}
        {interests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interests</Text>
            <View style={styles.chipWrap}>
              {interests.map((tag, i) => (
                <View key={i} style={styles.chip}>
                  <Text style={styles.chipText}>{tag.name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Links ── */}
        {(profile.links?.length ?? 0) > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Links</Text>
            <ProfileLinks links={profile.links!} />
          </View>
        )}

        {/* ── Actions ── */}
        <View style={styles.section}>
          {rel === 'stranger' && (
            <TouchableOpacity
              style={[styles.btnPrimary, actionLoading === 'hi' && styles.btnOff]}
              onPress={sendHi}
              disabled={actionLoading !== null}
              activeOpacity={0.8}
            >
              {actionLoading === 'hi' ? (
                <ActivityIndicator color="#0a0a0a" size="small" />
              ) : (
                <Text style={styles.btnPrimaryText}>Send Hi 👋</Text>
              )}
            </TouchableOpacity>
          )}

          {rel === 'hi_sent' && (
            <TouchableOpacity
              style={[styles.btnPrimary, styles.btnOff]}
              disabled
              activeOpacity={1}
            >
              <Text style={styles.btnPrimaryText}>Hi Sent ✓</Text>
            </TouchableOpacity>
          )}

          {rel === 'hi_received' && (
            <TouchableOpacity
              style={[styles.btnPrimary, actionLoading === 'accept' && styles.btnOff]}
              onPress={acceptHi}
              disabled={actionLoading !== null}
              activeOpacity={0.8}
            >
              {actionLoading === 'accept' ? (
                <ActivityIndicator color="#0a0a0a" size="small" />
              ) : (
                <Text style={styles.btnPrimaryText}>Accept Hi 👋</Text>
              )}
            </TouchableOpacity>
          )}

          {(rel === 'connected' || rel === 'friend') && (
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={goToMessages}
              activeOpacity={0.8}
            >
              <Text style={styles.btnPrimaryText}>Message 💬</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { alignItems: 'center', justifyContent: 'center' },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#141414',
    backgroundColor: '#0a0a0a',
  },
  headerBtn: { width: 34, alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  relRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  relDot: { width: 6, height: 6, borderRadius: 3 },
  relText: { color: '#9C9CA6', fontSize: 11 },

  scroll: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 60 },

  // ── Hero ──
  hero: { alignItems: 'center', marginBottom: 36 },
  avatarRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontSize: 34, fontWeight: '700' },
  avatarImage: { width: 86, height: 86, borderRadius: 43 },

  username: { color: '#ffffff', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  presenceRow: { marginBottom: 10 },
  bio: { color: '#9C9CA6', fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 280, marginBottom: 12 },
  bioEmpty: { color: '#8A8A94', fontSize: 13, marginBottom: 12 },

  lockedBox: {
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 12,
    paddingHorizontal: 24,
  },
  lockedTitle: { color: '#F4F4F6', fontSize: 15, fontWeight: '600' },
  lockedBody: { color: '#9C9CA6', fontSize: 13, lineHeight: 19, textAlign: 'center' },

  auraRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  auraValue: { color: '#8b5cf6', fontSize: 15, fontWeight: '700' },
  auraLabel: { color: '#9C9CA6', fontSize: 13 },

  joinDate: { color: '#8A8A94', fontSize: 12 },

  // ── Section ──
  section: { marginBottom: 28 },
  sectionTitle: {
    color: '#8A8A94',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  // ── Interests ──
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#0d1f1e',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#00b4a630',
  },
  chipText: { color: '#00b4a6', fontSize: 13, fontWeight: '500' },

  // ── Buttons ──
  btnRow: { flexDirection: 'row', gap: 12 },
  btnPrimary: {
    backgroundColor: '#00b4a6',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#0a0a0a', fontSize: 15, fontWeight: '700' },
  btnSecondary: {
    backgroundColor: '#141414',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#252525',
  },
  btnSecondaryText: { color: '#aaa', fontSize: 15, fontWeight: '600' },
  btnOff: { opacity: 0.55 },

  // ── Error ──
  errorText: { color: '#9C9CA6', fontSize: 16, marginBottom: 16 },
  backLink: { paddingVertical: 10 },
  backLinkText: { color: '#00b4a6', fontSize: 14 },
});
