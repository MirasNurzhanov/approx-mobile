import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { Speedometer } from '@/components/Speedometer';

// ─── Types ────────────────────────────────────────────────────────────────────
type PrivacyMode = 'active' | 'ghost' | 'invisible';

interface Profile {
  privacy_mode?: PrivacyMode;
  privacy?: PrivacyMode;
  status?: PrivacyMode;
}

// ─── Privacy mode definitions ─────────────────────────────────────────────────
const PRIVACY_MODES: {
  key: PrivacyMode;
  emoji: string;
  label: string;
  desc: string;
  dot: string;
}[] = [
  {
    key: 'active',
    emoji: '🟢',
    label: 'Active',
    desc: 'Visible on the map. Others can find and connect with you.',
    dot: '#22c55e',
  },
  {
    key: 'ghost',
    emoji: '👻',
    label: 'Ghost',
    desc: 'Hidden on the map but still appear in nearby lists. You can see others.',
    dot: '#f59e0b',
  },
  {
    key: 'invisible',
    emoji: '🔴',
    label: 'Invisible',
    desc: 'Completely hidden. You cannot be seen or found by anyone.',
    dot: '#ef4444',
  },
];

// ─── NavCard ──────────────────────────────────────────────────────────────────
function NavCard({
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
    <TouchableOpacity style={styles.navCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.navIconWrap}>
        <Ionicons name={icon} size={20} color="#00b4a6" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.navLabel}>{label}</Text>
        <Text style={styles.navSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#2e2e2e" />
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const router = useRouter();
  const { logout } = useAuth();
  const { top, bottom } = useSafeAreaInsets();

  const [privacy, setPrivacy] = useState<PrivacyMode>('active');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<Profile>('/api/users/profile/')
      .then((r) => {
        const mode = r.data.privacy_mode ?? r.data.privacy ?? r.data.status ?? 'active';
        setPrivacy(mode as PrivacyMode);
      })
      .catch((e) => console.log('[Settings] profile fetch error:', e?.response?.status))
      .finally(() => setLoading(false));
  }, []);

  async function selectPrivacy(mode: PrivacyMode) {
    if (mode === privacy || saving) return;
    const prev = privacy;
    setPrivacy(mode);
    setSaving(true);
    try {
      await api.patch('/api/users/privacy/', { privacy_mode: mode });
    } catch (e: any) {
      console.log('[Settings] privacy PATCH error:', e?.response?.status, JSON.stringify(e?.response?.data));
      setPrivacy(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: top + 20, paddingBottom: bottom + 110 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Settings</Text>
          {saving && <ActivityIndicator color="#00b4a6" size="small" />}
        </View>

        {/* ── Privacy Mode ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy Mode</Text>
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color="#00b4a6" />
            </View>
          ) : (
            <View style={styles.privacyList}>
              {PRIVACY_MODES.map((mode) => {
                const selected = privacy === mode.key;
                return (
                  <TouchableOpacity
                    key={mode.key}
                    style={[styles.privacyCard, selected && styles.privacyCardSelected]}
                    onPress={() => selectPrivacy(mode.key)}
                    activeOpacity={0.75}
                    disabled={saving}
                  >
                    <View style={styles.privacyCardTop}>
                      <Text style={styles.privacyEmoji}>{mode.emoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.privacyLabel, selected && styles.privacyLabelSelected]}>
                          {mode.label}
                        </Text>
                      </View>
                      {selected && (
                        <View style={styles.selectedCheck}>
                          <Ionicons name="checkmark" size={14} color="#0a0a0a" />
                        </View>
                      )}
                    </View>
                    <Text style={[styles.privacyDesc, selected && styles.privacyDescSelected]}>
                      {mode.desc}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Account ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.navList}>
            <NavCard
              icon="create-outline"
              label="Edit Profile"
              sub="Update your username, bio and photo"
              onPress={() => router.push('/edit-profile')}
            />
            <NavCard
              icon="location-outline"
              label="Zone Setup"
              sub="Configure your activity zones"
              onPress={() => router.push('/zone')}
            />
          </View>
        </View>

        {/* ── App ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App</Text>
          <View style={styles.navList}>
            <NavCard
              icon="notifications-outline"
              label="Notifications"
              sub="Manage push notification preferences"
              onPress={() => router.push('/(tabs)/notifications')}
            />
            <NavCard
              icon="shield-outline"
              label="Privacy & Safety"
              sub="Blocked users and data settings"
              onPress={() => router.push('/(tabs)/notifications')}
            />
          </View>
        </View>

        {/* ── Logout ── */}
        <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={18} color="#ff4d4d" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { paddingHorizontal: 20 },

  // ── Header ──
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  pageTitle: { color: '#ffffff', fontSize: 26, fontWeight: '700' },

  // ── Section ──
  section: { marginBottom: 28 },
  sectionTitle: {
    color: '#444',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  loadingWrap: { paddingVertical: 24, alignItems: 'center' },

  // ── Privacy cards ──
  privacyList: { gap: 10 },
  privacyCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 16,
    gap: 8,
  },
  privacyCardSelected: {
    borderColor: '#00b4a6',
    backgroundColor: '#0d1f1e',
    shadowColor: '#00b4a6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  privacyCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  privacyEmoji: { fontSize: 22 },
  privacyLabel: { color: '#888', fontSize: 15, fontWeight: '600' },
  privacyLabelSelected: { color: '#ffffff' },
  privacyDesc: { color: '#333', fontSize: 13, lineHeight: 18 },
  privacyDescSelected: { color: '#555' },
  selectedCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#00b4a6',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Nav cards ──
  navList: { gap: 10 },
  navCard: {
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
  navIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#0d1f1e',
    borderWidth: 1,
    borderColor: '#00b4a620',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLabel: { color: '#ddd', fontSize: 14, fontWeight: '600' },
  navSub: { color: '#444', fontSize: 12, marginTop: 2 },

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
});
