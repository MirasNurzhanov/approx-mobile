import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { Speedometer } from '@/components/Speedometer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useScrollHandler } from '@/hooks/useScrollHandler';
import { colors, fonts, radius } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Profile {
  id: number;
  username: string;
  bio?: string;
  aura_points?: number;
  date_joined?: string;
  interests?: { icon: string; name: string }[];
  profile_picture?: string;
}

interface FriendList {
  friends: { id: number }[];
  connections: { id: number }[];
}

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

// ─── ActionRow ────────────────────────────────────────────────────────────────
function ActionRow({ icon, label, onPress, last = false }: {
  icon: IoniconsName;
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.actionRow, !last && styles.actionRowBorder, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={colors.teal} />
      <Text style={styles.actionLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.t3} />
    </Pressable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const router = useRouter();
  const { logout } = useAuth();
  const { top, bottom } = useSafeAreaInsets();
  const scrollProps = useScrollHandler();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [friendCount, setFriendCount] = useState(0);
  const [connectionCount, setConnectionCount] = useState(0);
  const [questCount, setQuestCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [editVisible, setEditVisible] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [saving, setSaving] = useState(false);

  async function fetchAll() {
    const [profileRes, friendsRes, questsRes] = await Promise.allSettled([
      api.get<Profile>('/api/users/profile/'),
      api.get<FriendList>('/api/friends/list/'),
      api.get<unknown>('/api/quests/'),
    ]);
    if (profileRes.status === 'fulfilled') setProfile(profileRes.value.data);
    if (friendsRes.status === 'fulfilled') {
      const data = friendsRes.value.data;
      const friendIds = new Set(data.friends.map((f) => f.id));
      setFriendCount(data.friends.length);
      setConnectionCount(data.connections.filter((c) => !friendIds.has(c.id)).length);
    }
    if (questsRes.status === 'fulfilled') {
      const data = questsRes.value.data as any;
      if (Array.isArray(data)) {
        setQuestCount(data.filter((q: any) => q.completed || q.status === 'completed').length);
      } else if (data && typeof data === 'object' && 'completed' in data) {
        setQuestCount(Number(data.completed) || 0);
      }
    }
  }

  useEffect(() => { fetchAll().finally(() => setLoading(false)); }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, []);

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to change your profile picture.');
      return;
    }
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

  function openEdit() {
    if (!profile) return;
    setEditUsername(profile.username);
    setEditBio(profile.bio ?? '');
    setEditVisible(true);
  }

  async function saveEdit() {
    if (!editUsername.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.patch<Profile>('/api/users/profile/', {
        username: editUsername.trim(),
        bio: editBio.trim(),
      });
      setProfile(data);
      setEditVisible(false);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.username?.[0] ?? e?.response?.data?.detail ?? 'Could not save changes.');
    } finally {
      setSaving(false);
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
              <Ionicons name="pencil" size={11} color={colors.t1} />
            </View>
          </Pressable>

          <Text style={styles.username}>{profile?.username ?? '—'}</Text>
          {profile?.bio ? (
            <Text style={styles.bio}>{profile.bio}</Text>
          ) : (
            <Text style={styles.bioEmpty}>No bio yet</Text>
          )}
        </View>

        {/* Stats */}
        <Card style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{friendCount}</Text>
            <Text style={styles.statLabel}>Friends</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{connectionCount}</Text>
            <Text style={styles.statLabel}>Connections</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{questCount}</Text>
            <Text style={styles.statLabel}>Quests</Text>
          </View>
        </Card>

        {/* Interests */}
        {interests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>INTERESTS</Text>
            <View style={styles.chipWrap}>
              {interests.map((tag, i) => (
                <View key={i} style={styles.chip}>
                  <Text style={styles.chipText}>{tag.icon} {tag.name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Action rows */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          <Card style={styles.actionsCard}>
            <ActionRow icon="create-outline"   label="Edit Profile"  onPress={openEdit} />
            <ActionRow icon="heart-outline"     label="My Interests"  onPress={() => router.push('/interests')} />
            <ActionRow icon="radio-outline"     label="Zone Setup"    onPress={() => router.push('/zone')} />
            <ActionRow icon="trophy-outline"    label="Leaderboard"   onPress={() => router.push('/leaderboard')} last />
          </Card>
        </View>

        {/* Buttons */}
        <View style={styles.btnGroup}>
          <Button label="Edit Profile" variant="ghost" size="lg" fullWidth onPress={openEdit} />
          <Button
            label="Sign Out"
            variant="danger"
            size="lg"
            fullWidth
            onPress={() => logout()}
          />
        </View>
      </ScrollView>

      {/* Edit modal */}
      <Modal
        visible={editVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setEditVisible(false)} hitSlop={14}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <Pressable onPress={saveEdit} disabled={saving} hitSlop={14}>
              {saving
                ? <ActivityIndicator color={colors.teal} size="small" />
                : <Text style={styles.modalSave}>Save</Text>
              }
            </Pressable>
          </View>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <Input
              label="Username"
              placeholder="yourhandle"
              value={editUsername}
              onChangeText={setEditUsername}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
            />
            <Input
              label="Bio"
              placeholder="Tell people about yourself…"
              value={editBio}
              onChangeText={setEditBio}
              multiline
              maxLength={200}
              hint={`${editBio.length} / 200`}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20 },

  // Hero
  hero: { alignItems: 'center', marginBottom: 24, gap: 8 },
  avatarWrap: { marginBottom: 8 },
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
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 22,
    color: colors.t1,
  },
  bio: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t2,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  bioEmpty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t3,
    fontStyle: 'italic',
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
    fontSize: 17,
    color: colors.t1,
  },
  statLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
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
    backgroundColor: colors.surface2,
    borderRadius: radius.l,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    fontFamily: fonts.body,
    color: colors.t2,
    fontSize: 13,
    fontWeight: '500',
  },

  // Action rows
  actionsCard: { padding: 0, overflow: 'hidden' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  actionRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
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

  // Edit modal
  modalRoot: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 16,
    color: colors.t1,
  },
  modalCancel: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t3,
  },
  modalSave: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.teal,
  },
  modalScroll: { flex: 1 },
  modalContent: { padding: 20, gap: 16 },
});
