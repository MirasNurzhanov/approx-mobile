import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { runBusy } from '@/services/busy';
import { sectionise } from '@/services/interestCategories';
import { registerProfileRefresh } from '@/services/profileRefresh';
import { ProfileLinks } from '@/components/ProfileLinks';
import type { ProfileLink } from '@/services/links';
import { ApproxNav } from '@/components/ApproxNav';
import { ApproxMark } from '@/components/ui/ApproxMark';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  IconCamera,
  IconChevron,
  IconGlobe,
  IconHeart,
  IconImage,
  IconPencil,
  IconSound,
  type IconComponent,
  type IconProps,
} from '@/components/ui/icons';
import { GlassIconButton, GlassSurface } from '@/components/ui/GlassSurface';
import { iconForInterest } from '@/components/ui/interestIcons';
import { useNavContentPadding } from '@/hooks/useNavMetrics';
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
  interests?: { icon: string; name: string; category?: string; category_label?: string }[];
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
  const styles = makeStyles(colors);
  return (
    <GlassIconButton
      style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon size={20} color={colors.t1} />
      <Text style={styles.actionLabel}>{label}</Text>
      <IconChevron size={16} color={colors.t3} />
    </GlassIconButton>
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
  const { top } = useSafeAreaInsets();
  const scrollProps = useScrollHandler();
  const navPadding = useNavContentPadding();

  const [profile, setProfile] = useState<Profile | null>(_cache?.profile ?? null);
  const [friendCount, setFriendCount] = useState(_cache?.friendCount ?? 0);
  const [connectionCount, setConnectionCount] = useState(_cache?.connectionCount ?? 0);
  const [loading, setLoading] = useState(_cache === null);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Mirrors of the state above, updated alongside it, so fetchAll can read
  // current values without closing over the state itself — closing over it
  // would give fetchAll a new identity on every fetch, and useFocusEffect
  // re-runs its effect whenever that identity changes while the screen is
  // focused, which would turn this into an infinite refetch loop.
  const profileRef = useRef(profile);
  const friendCountRef = useRef(friendCount);
  const connectionCountRef = useRef(connectionCount);

  const fetchAll = useCallback(async () => {
    const [profileRes, friendsRes] = await Promise.allSettled([
      api.get<Profile>('/api/users/profile/'),
      api.get<FriendList>('/api/friends/list/'),
    ]);
    const p = profileRes.status === 'fulfilled' ? profileRes.value.data : profileRef.current;
    let fc = friendCountRef.current;
    let cc = connectionCountRef.current;
    if (profileRes.status === 'fulfilled') {
      setProfile(p);
      profileRef.current = p;
    }
    if (friendsRes.status === 'fulfilled') {
      const data = friendsRes.value.data;
      const friendIds = new Set(data.friends.map((f) => f.id));
      fc = data.friends.length;
      cc = data.connections.filter((c) => !friendIds.has(c.id)).length;
      setFriendCount(fc);
      setConnectionCount(cc);
      friendCountRef.current = fc;
      connectionCountRef.current = cc;
    }
    _cache = { profile: p, friendCount: fc, connectionCount: cc };
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchAll().finally(() => setLoading(false));
    }, [fetchAll])
  );

  // Paints an edit made on /edit-profile the instant it saves, rather than
  // waiting on the focus effect above to refetch — see services/profileRefresh
  // for why the gap between those two otherwise shows the old value.
  useEffect(() => {
    registerProfileRefresh((fresh) => {
      // Merged from the ref rather than a `setProfile` updater, so the write
      // to it and to `_cache` happen exactly once instead of risking a repeat
      // or a stale read if React ever re-invokes the updater.
      const merged = { ...(profileRef.current ?? {}), ...fresh } as Profile;
      profileRef.current = merged;
      _cache = {
        profile: merged,
        friendCount: friendCountRef.current,
        connectionCount: connectionCountRef.current,
      };
      setProfile(merged);
    });
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Promise `.finally`, as on the focus effect above: same guarantee that the
    // spinner stops on rejection, but React Compiler can compile it — a
    // `try/finally` statement makes it bail on this whole screen.
    await fetchAll().finally(() => setRefreshing(false));
  }, [fetchAll]);

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
      await runBusy(async () => {
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
      }, () => setUploading(false)).catch((e: any) =>
        Alert.alert('Upload failed', e?.response?.data?.detail ?? 'Could not upload photo.'),
      );
    }
  }


  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.teal} size="large" />
        <ApproxNav />
      </View>
    );
  }

  const interests = profile?.interests ?? [];
  const interestSections = sectionise(interests);

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
        contentContainerStyle={[styles.scroll, { paddingTop: top + 20, paddingBottom: navPadding }]}
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
            <GlassSurface style={styles.editBadge} tone="surface2">
              <IconCamera size={13} color={colors.t1} />
            </GlassSurface>
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
                <ApproxMark size={13} color={colors.purple} />
                <Text style={styles.pillApprox}>{profile.aura_points.toLocaleString()}</Text>
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

        {/* Interests, grouped the same way the pickers group them. A profile
            with thirty picks used to be one undifferentiated wall of chips;
            the headings are what let someone see at a glance that you are
            mostly sport, or mostly music. */}
        {interests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>INTERESTS</Text>
            {interestSections.map((group, index) => (
              <View
                key={group.key || 'more'}
                style={index > 0 ? styles.interestGroup : undefined}
              >
                {/* Only worth a heading when there is more than one — a single
                    group would just be the word "INTERESTS" said twice. */}
                {interestSections.length > 1 && (
                  <View style={styles.interestGroupHeader}>
                    <Ionicons name={group.icon} size={13} color={group.color} />
                    <Text style={styles.interestGroupLabel}>{group.label}</Text>
                  </View>
                )}
                <View style={styles.chipWrap}>
                  {group.items.map((tag) => {
                    const Icon = iconForInterest(tag.name);
                    return (
                      <GlassSurface key={tag.name} style={styles.chip}>
                        <Icon size={14} color={colors.t2} />
                        <Text style={styles.chipText}>{tag.name}</Text>
                      </GlassSurface>
                    );
                  })}
                </View>
              </View>
            ))}
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
            <ActionRow icon={IconImage}  label="My stories"     onPress={() => router.push('/starred-stories')} />
            <ActionRow icon={IconGlobe}  label="Links"          onPress={() => router.push('/edit-links')} />
          </View>
        </View>

        {/* Buttons */}
        <View style={styles.btnGroup}>
          <Button label="Edit profile" icon={IconPencil} variant="ghost" size="lg" fullWidth onPress={() => router.push('/edit-profile')} />
        </View>
      </ScrollView>

      <ApproxNav />
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
  pillApprox: {
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
  // No `backgroundColor` on the three surfaces below — their fill is drawn by
  // `GlassBackdrop`, and a background here would sit on top of the blur.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
