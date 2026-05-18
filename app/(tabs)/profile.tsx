import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { Speedometer } from '@/components/Speedometer';
import { useScrollHandler } from '@/hooks/useScrollHandler';

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#be185d', '#0284c7'];

function avatarColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + (hash << 5) - hash;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'long' });
  } catch {
    return '—';
  }
}

// ─── ActionCard ───────────────────────────────────────────────────────────────
function ActionCard({
  icon,
  label,
  sub,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.actionCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.actionIconWrap}>
        <Ionicons name={icon} size={20} color="#00b4a6" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionLabel}>{label}</Text>
        <Text style={styles.actionSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#2e2e2e" />
    </TouchableOpacity>
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
  const [auraPoints, setAuraPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [editVisible, setEditVisible] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function fetchAll() {
    const [profileRes, friendsRes, questsRes] = await Promise.allSettled([
      api.get<Profile>('/api/users/profile/'),
      api.get<FriendList>('/api/friends/list/'),
      api.get<unknown>('/api/quests/'),
    ]);

    if (profileRes.status === 'fulfilled') {
      setProfile(profileRes.value.data);
    }

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
      } else if (data && typeof data === 'object') {
        if ('completed' in data) setQuestCount(Number(data.completed) || 0);
        if (typeof data.total_points === 'number') setAuraPoints(data.total_points);
      }
    }
  }

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, []);

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
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await uploadProfilePicture(result.assets[0].uri);
    }
  }

  async function uploadProfilePicture(uri: string) {
    setUploading(true);
    try {
      const filename = uri.split('/').pop() ?? 'photo.jpg';
      const ext = /\.(\w+)$/.exec(filename)?.[1]?.toLowerCase() ?? 'jpeg';
      const type = ext === 'png' ? 'image/png' : 'image/jpeg';

      const form = new FormData();
      form.append('profile_picture', {
        uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
        name: filename,
        type,
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
      const msg =
        e?.response?.data?.username?.[0] ??
        e?.response?.data?.detail ??
        'Could not save changes.';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color="#00b4a6" size="large" />
        <Speedometer />
      </View>
    );
  }

  const initial = profile?.username?.charAt(0).toUpperCase() ?? '?';
  const bgColor = profile ? avatarColor(profile.username) : '#7c3aed';
  const interests = profile?.interests ?? [];

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: top + 20, paddingBottom: bottom + 110 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00b4a6" />
        }
        {...scrollProps}
      >
        {/* ── Hero ── */}
        <View style={styles.hero}>
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={pickImage}
            activeOpacity={0.85}
            disabled={uploading}
          >
            <View style={[styles.avatarRing, { borderColor: bgColor + '55' }]}>
              <View style={[styles.avatar, { backgroundColor: bgColor }]}>
                {profile?.profile_picture ? (
                  <Image
                    source={{ uri: profile.profile_picture }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Text style={styles.avatarInitial}>{initial}</Text>
                )}
                {uploading && (
                  <View style={styles.avatarUploadOverlay}>
                    <ActivityIndicator color="#fff" size="small" />
                  </View>
                )}
              </View>
            </View>
            {/* Camera badge */}
            <View style={styles.cameraBadge}>
              <Ionicons name="camera" size={12} color="#fff" />
            </View>
          </TouchableOpacity>

          <Text style={styles.username}>{profile?.username ?? '—'}</Text>

          {profile?.bio ? (
            <Text style={styles.bio}>{profile.bio}</Text>
          ) : (
            <Text style={styles.bioEmpty}>No bio yet · tap Edit to add one</Text>
          )}

          {/* Aura Points */}
          <View style={styles.auraRow}>
            <Text style={styles.auraIcon}>◉</Text>
            <Text style={styles.auraValue}>{(auraPoints || profile?.aura_points || 0).toLocaleString()}</Text>
            <Text style={styles.auraLabel}>Aura Points</Text>
          </View>

          <Text style={styles.joinDate}>Member since {fmtDate(profile?.date_joined)}</Text>
        </View>

        {/* ── Stats ── */}
        <View style={styles.statsCard}>
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
        </View>

        {/* ── Interests ── */}
        {interests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interests</Text>
            <View style={styles.chipWrap}>
              {interests.map((tag, i) => (
                <View key={i} style={styles.chip}>
                  <Text style={styles.chipText}>{tag.icon} {tag.name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Quick actions ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionList}>
            <ActionCard
              icon="trophy-outline"
              label="Leaderboard"
              sub="See where you rank in Aura Points"
              onPress={() => router.push('/leaderboard')}
            />
            <ActionCard
              icon="location-outline"
              label="Zone Setup"
              sub="Configure your activity zones"
              onPress={() => router.push('/zone')}
            />
            <ActionCard
              icon="heart-outline"
              label="Edit Interests"
              sub="Update what you care about"
              onPress={() => router.push('/edit-profile')}
            />
            <ActionCard
              icon="settings-outline"
              label="Settings"
              sub="Privacy, notifications & more"
              onPress={() => router.push('/(tabs)/settings')}
            />
          </View>
        </View>

        {/* ── Edit profile ── */}
        <TouchableOpacity style={styles.editBtn} onPress={openEdit} activeOpacity={0.8}>
          <Ionicons name="create-outline" size={18} color="#00b4a6" />
          <Text style={styles.editBtnText}>Edit Profile</Text>
        </TouchableOpacity>

        {/* ── Logout ── */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => { console.log('[Profile] Sign Out pressed'); logout(); }}
          activeOpacity={0.8}
        >
          <Ionicons name="log-out-outline" size={18} color="#ff4d4d" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Edit modal ── */}
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
            <TouchableOpacity onPress={() => setEditVisible(false)} hitSlop={14}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <TouchableOpacity onPress={saveEdit} disabled={saving} hitSlop={14}>
              {saving ? (
                <ActivityIndicator color="#00b4a6" size="small" />
              ) : (
                <Text style={styles.modalSave}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.fieldLabel}>Username</Text>
            <TextInput
              style={styles.fieldInput}
              value={editUsername}
              onChangeText={setEditUsername}
              placeholder="Username"
              placeholderTextColor="#333"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
            />

            <Text style={styles.fieldLabel}>Bio</Text>
            <TextInput
              style={[styles.fieldInput, styles.fieldTextarea]}
              value={editBio}
              onChangeText={setEditBio}
              placeholder="Tell people about yourself…"
              placeholderTextColor="#333"
              multiline
              maxLength={200}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{editBio.length} / 200</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20 },

  // ── Hero ──
  hero: { alignItems: 'center', marginBottom: 24 },

  avatarWrap: { marginBottom: 16 },
  avatarRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontSize: 32, fontWeight: '700' },
  avatarImage: { width: 80, height: 80, borderRadius: 40 },
  avatarUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#00b4a6',
    borderWidth: 2,
    borderColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },

  username: { color: '#ffffff', fontSize: 22, fontWeight: '700', marginBottom: 6 },
  bio: { color: '#888', fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 280, marginBottom: 14 },
  bioEmpty: { color: '#2e2e2e', fontSize: 13, marginBottom: 14, fontStyle: 'italic' },

  auraRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  auraIcon: { color: '#8b5cf6', fontSize: 16 },
  auraValue: { color: '#8b5cf6', fontSize: 16, fontWeight: '700' },
  auraLabel: { color: '#555', fontSize: 13 },

  joinDate: { color: '#333', fontSize: 12 },

  // ── Stats ──
  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    paddingVertical: 18,
    marginBottom: 24,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  statLabel: { color: '#444', fontSize: 11, marginTop: 3 },
  statDivider: { width: 1, backgroundColor: '#1e1e1e', marginVertical: 4 },

  // ── Section ──
  section: { marginBottom: 24 },
  sectionTitle: {
    color: '#444',
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

  // ── Actions ──
  actionList: { gap: 10 },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
  },
  actionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#0d1f1e',
    borderWidth: 1,
    borderColor: '#00b4a620',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { color: '#ddd', fontSize: 14, fontWeight: '600' },
  actionSub: { color: '#444', fontSize: 12, marginTop: 2 },

  // ── Edit button ──
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#00b4a6',
    marginBottom: 12,
  },
  editBtnText: { color: '#00b4a6', fontSize: 15, fontWeight: '600' },

  // ── Logout ──
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#1a0a0a',
    borderWidth: 1,
    borderColor: '#ff4d4d22',
  },
  logoutText: { color: '#ff4d4d', fontSize: 15, fontWeight: '600' },

  // ── Edit modal ──
  modalRoot: { flex: 1, backgroundColor: '#0a0a0a' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#141414',
  },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalCancel: { color: '#555', fontSize: 15 },
  modalSave: { color: '#00b4a6', fontSize: 15, fontWeight: '600' },

  modalScroll: { flex: 1 },
  modalContent: { padding: 20, gap: 8 },

  fieldLabel: {
    color: '#444',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 6,
  },
  fieldInput: {
    backgroundColor: '#111111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
  },
  fieldTextarea: { minHeight: 100, paddingTop: 12 },
  charCount: { color: '#2e2e2e', fontSize: 11, alignSelf: 'flex-end' },
});
