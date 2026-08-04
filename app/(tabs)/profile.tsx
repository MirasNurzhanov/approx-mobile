import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { ProfileLinks } from '@/components/ProfileLinks';
import type { ProfileLink } from '@/services/links';
import { useAuth } from '@/context/AuthContext';
import { Speedometer } from '@/components/Speedometer';
import { AuraMark } from '@/components/ui/AuraMark';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  IconCamera,
  IconChevron,
  IconGlobe,
  IconHeart,
  IconImage,
  IconLogout,
  IconPencil,
  IconSound,
  iconForInterest,
  type IconComponent,
  type IconProps,
} from '@/components/ui/icons';
import { useScrollHandler } from '@/hooks/useScrollHandler';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { PROFESSIONS, COUNTRIES, flagEmoji } from '@/constants/onboardingData';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Profile {
  id: number;
  username: string;
  bio?: string;
  links?: ProfileLink[];
  date_joined?: string;
  interests?: { icon: string; name: string }[];
  aura_points?: number;
  profile_picture?: string;
  profession?: string | null;
  nationality?: string | null;
  date_of_birth?: string | null;
}

interface FriendList {
  friends: { id: number }[];
  connections: { id: number }[];
}

// ─── ActionRow ────────────────────────────────────────────────────────────────
function ActionRow({ icon: Icon, label, onPress }: {
  icon: IconComponent;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Icon size={20} color={colors.t1} />
      <Text style={styles.actionLabel}>{label}</Text>
      <IconChevron size={16} color={colors.t3} />
    </Pressable>
  );
}

function IconMarket({ size = 24 }: IconProps): React.JSX.Element {
  const { colors } = useTheme();
  return <Ionicons name="storefront-outline" size={size} color={colors.teal} />;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtJoined(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// ─── Module-level cache ───────────────────────────────────────────────────────
// Persists across tab switches so the screen feels instant on re-focus.
let _cache: { profile: Profile | null; friendCount: number; connectionCount: number } | null = null;

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { confirmLogout, isSigningOut } = useAuth();
  const { top, bottom } = useSafeAreaInsets();
  const scrollProps = useScrollHandler();

  const [profile, setProfile] = useState<Profile | null>(_cache?.profile ?? null);
  const [friendCount, setFriendCount] = useState(_cache?.friendCount ?? 0);
  const [connectionCount, setConnectionCount] = useState(_cache?.connectionCount ?? 0);
  const [loading, setLoading] = useState(_cache === null);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);


  async function fetchAll() {
    const [profileRes, friendsRes] = await Promise.allSettled([
      api.get<Profile>('/api/users/profile/'),
      api.get<FriendList>('/api/friends/list/'),
    ]);
    const p = profileRes.status === 'fulfilled' ? profileRes.value.data : profile;
    let fc = friendCount;
    let cc = connectionCount;
    if (profileRes.status === 'fulfilled') setProfile(p);
    if (friendsRes.status === 'fulfilled') {
      const data = friendsRes.value.data;
      const friendIds = new Set(data.friends.map((f) => f.id));
      fc = data.friends.length;
      cc = data.connections.filter((c) => !friendIds.has(c.id)).length;
      setFriendCount(fc);
      setConnectionCount(cc);
    }
    _cache = { profile: p, friendCount: fc, connectionCount: cc };
  }

  useFocusEffect(
    useCallback(() => {
      fetchAll().finally(() => setLoading(false));
    }, [])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, []);

  async function pickImage() {
    // No permission request: the system photo picker runs out of process and
    // hands back only the image the user chose, so asking for library access
    // would spend a prompt and buy nothing.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setUploading(true);
      try {
        const uri = result.assets[0].uri;
        const filename = uri.split('/').pop() ?? 'photo.jpg';
        const ext = /\.(\w+)$/.exec(filename)?.[1]?.toLowerCase() ?? 'jpeg';
        const form = new FormData();
        form.append('profile_picture', {
          uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
          name: filename,
          type: ext === 'png' ? 'image/png' : 'image/jpeg',
        } as any);
        const { data } = await api.patch<Profile>('/api/users/profile/', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setProfile(data);
      } catch (e: any) {
        Alert.alert('Upload failed', e?.response?.data?.detail ?? 'Could not upload photo.');
      } finally {
        setUploading(false);
      }
    }
  }


  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.teal} size="large" />
        <Speedometer />
      </View>
    );
  }

  const interests = profile?.interests ?? [];

  const _ageRaw = profile?.date_of_birth
    ? Math.floor((Date.now() - new Date(profile.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;
  const age = _ageRaw !== null && !Number.isNaN(_ageRaw) ? _ageRaw : null;

  const professionInfo = profile?.profession
    ? PROFESSIONS.find(p => p.key === profile.profession) ?? null
    : null;
  const nationalityInfo = profile?.nationality
    ? COUNTRIES.find(c => c.code === profile.nationality) ?? null
    : null;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: top + 20, paddingBottom: bottom + 110 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
        {...scrollProps}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Pressable onPress={pickImage} disabled={uploading} style={styles.avatarWrap}>
            <Avatar uri={profile?.profile_picture} name={profile?.username} size="xl" />
            {uploading ? (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            ) : null}
            <View style={styles.editBadge}>
              <IconCamera size={13} color={colors.t1} />
            </View>
          </Pressable>

          <Text style={styles.username}>{profile?.username ?? '—'}</Text>

          {(nationalityInfo || professionInfo || age !== null) && (
            <Text style={styles.metaLine}>
              {[
                nationalityInfo ? `${flagEmoji(nationalityInfo.code)} ${nationalityInfo.name}` : null,
                professionInfo  ? `${professionInfo.emoji} ${professionInfo.label}`             : null,
                age !== null    ? String(age)                                                   : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          )}

          {profile?.bio ? (
            <Text style={styles.bio}>{profile.bio}</Text>
          ) : null}

          <View style={styles.pillRow}>
            {profile?.aura_points != null && (
              <Pressable
                style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
                onPress={() => router.push('/market')}
              >
                <AuraMark size={13} color={colors.purple} />
                <Text style={styles.pillAura}>{profile.aura_points.toLocaleString()}</Text>
                <IconChevron size={11} color={colors.purple} />
              </Pressable>
            )}
            {profile?.date_joined ? (
              <View style={styles.pill}>
                <Text style={styles.pillText}>Since {fmtJoined(profile.date_joined)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Stats */}
        <Card style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{connectionCount}</Text>
            <Text style={styles.statLabel}>Connections</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{friendCount}</Text>
            <Text style={styles.statLabel}>Friends</Text>
          </View>
        </Card>

        {/* Interests */}
        {interests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>INTERESTS</Text>
            <View style={styles.chipWrap}>
              {interests.map((tag, i) => {
                const Icon = iconForInterest(tag.name);
                return (
                  <View key={i} style={styles.chip}>
                    <Icon size={14} color={colors.t2} />
                    <Text style={styles.chipText}>{tag.name}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Links */}
        {(profile?.links?.length ?? 0) > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>LINKS</Text>
            <ProfileLinks links={profile!.links!} />
          </View>
        )}

        {/* Action rows */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>MORE</Text>
          <View style={styles.rowGroup}>
            <ActionRow icon={IconMarket} label="Market"         onPress={() => router.push('/market')} />
            <ActionRow icon={IconSound}  label="My zone"        onPress={() => router.push('/zone')} />
            <ActionRow icon={IconHeart}  label="Edit interests" onPress={() => router.push('/interests')} />
            <ActionRow icon={IconImage}  label="My stories"     onPress={() => router.push('/saved-stories')} />
            <ActionRow icon={IconGlobe}  label="Links"          onPress={() => router.push('/edit-links')} />
          </View>
        </View>

        {/* Buttons */}
        <View style={styles.btnGroup}>
          <Button label="Edit profile" icon={IconPencil} variant="ghost" size="lg" fullWidth onPress={() => router.push('/edit-profile')} />
          <Button
            label="Sign out"
            icon={IconLogout}
            variant="dangerTint"
            size="lg"
            fullWidth
            loading={isSigningOut}
            onPress={confirmLogout}
          />
        </View>
      </ScrollView>

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20 },

  // Hero — centered column
  hero: { alignItems: 'center', gap: 6, marginBottom: 24 },
  avatarWrap: { marginBottom: 6 },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surface2,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  username: {
    fontFamily: 'SpaceGrotesk-SemiBold',
    fontSize: 24,
    color: colors.t1,
    textAlign: 'center',
  },
  metaLine: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
    textAlign: 'center',
  },
  bio: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t2,
    lineHeight: 20,
    textAlign: 'center',
  },

  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillAura: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 13,
    color: colors.purple,
  },
  pillText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.t2,
  },

  // Stats
  statsCard: {
    flexDirection: 'row',
    paddingVertical: 18,
    marginBottom: 24,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 18,
    color: colors.t1,
  },
  statLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.t3,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 4,
  },

  // Section
  section: { marginBottom: 24 },
  sectionLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  // Interests
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    fontFamily: fonts.body,
    color: colors.t1,
    fontSize: 13,
    fontWeight: '500',
  },

  // Action rows
  rowGroup: { gap: 6 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
  },
  actionLabel: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t1,
  },
  pressed: { opacity: 0.6 },

  // Bottom buttons
  btnGroup: { gap: 10, marginTop: 4 },
});
