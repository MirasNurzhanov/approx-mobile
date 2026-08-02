import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
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
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Profile {
  id: number;
  username: string;
  bio?: string;
  profile_picture?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#be185d', '#0284c7'];

function avatarColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + (hash << 5) - hash;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function EditProfileScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { top, bottom } = useSafeAreaInsets();

  const [profile,   setProfile]   = useState<Profile | null>(null);
  const [username,  setUsername]  = useState('');
  const [bio,       setBio]       = useState('');
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    api.get<Profile>('/api/users/profile/')
      .then((r) => {
        setProfile(r.data);
        setUsername(r.data.username);
        setBio(r.data.bio ?? '');
      })
      .catch((e) => console.log('[EditProfile] fetch error:', e?.response?.status))
      .finally(() => setLoading(false));
  }, []);

  async function pickImage() {
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
      form.append('profile_picture', { uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri, name: filename, type } as any);
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

  async function save() {
    if (!username.trim() || saving) return;
    setSaving(true);
    try {
      await api.patch<Profile>('/api/users/profile/', { username: username.trim(), bio: bio.trim() });
      router.back();
    } catch (e: any) {
      const msg = e?.response?.data?.username?.[0] ?? e?.response?.data?.detail ?? 'Could not save changes.';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  }

  const initial = (username || profile?.username || '?').charAt(0).toUpperCase();
  const bgColor = avatarColor(username || profile?.username || '?');

  return (
    <View style={styles.root}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.teal} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={save} disabled={saving || !username.trim()} hitSlop={12} style={styles.saveBtn}>
          {saving
            ? <ActivityIndicator color={colors.teal} size="small" />
            : <Text style={[styles.saveText, !username.trim() && { opacity: 0.4 }]}>Save</Text>
          }
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 40 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Avatar ── */}
            <TouchableOpacity style={styles.avatarWrap} onPress={pickImage} activeOpacity={0.85} disabled={uploading}>
              <View style={[styles.avatarRing, { borderColor: bgColor + '55' }]}>
                <View style={[styles.avatar, { backgroundColor: bgColor }]}>
                  {profile?.profile_picture
                    ? <Image source={{ uri: profile.profile_picture }} style={styles.avatarImage} />
                    : <Text style={styles.avatarInitial}>{initial}</Text>
                  }
                  {uploading && (
                    <View style={styles.avatarUploadOverlay}>
                      <ActivityIndicator color="#fff" size="small" />
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.cameraBadge}>
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            </TouchableOpacity>
            <Text style={styles.avatarHint}>Tap to change photo</Text>

            {/* ── Fields ── */}
            <Text style={styles.fieldLabel}>Username</Text>
            <TextInput
              style={styles.fieldInput}
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              placeholderTextColor={colors.t3}
              selectionColor={colors.teal}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
            />

            <Text style={styles.fieldLabel}>Bio</Text>
            <TextInput
              style={[styles.fieldInput, styles.fieldTextarea]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell people about yourself…"
              placeholderTextColor={colors.t3}
              selectionColor={colors.teal}
              multiline
              maxLength={200}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{bio.length} / 200</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

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
  backBtn: { padding: 4 },
  headerTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 17,
    color: colors.t1,
  },
  saveBtn: { padding: 4, minWidth: 42, alignItems: 'flex-end' },
  saveText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: colors.teal,
  },

  scroll: { paddingHorizontal: 20, paddingTop: 28 },

  avatarWrap: { alignSelf: 'center' },
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
    backgroundColor: colors.teal,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.t3,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },

  fieldLabel: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.t3,
    marginTop: 16,
    marginBottom: 6,
  },
  fieldInput: {
    fontFamily: fonts.body,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.t1,
    fontSize: 15,
  },
  fieldTextarea: { minHeight: 100, paddingTop: 12 },
  charCount: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.t3,
    alignSelf: 'flex-end',
    marginTop: 6,
  },
});
