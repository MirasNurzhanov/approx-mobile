import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { Speedometer } from '@/components/Speedometer';
import { Card } from '@/components/ui/Card';
import { useScrollHandler } from '@/hooks/useScrollHandler';
import { colors, fonts, radius } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
type PrivacyMode = 'active' | 'ghost' | 'invisible';
type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface Profile {
  privacy_mode?: PrivacyMode;
  privacy?: PrivacyMode;
  status?: PrivacyMode;
}

// ─── Privacy mode definitions ─────────────────────────────────────────────────
const PRIVACY_MODES: {
  key: PrivacyMode;
  icon: IoniconsName;
  ghosted: boolean;
  label: string;
  desc: string;
}[] = [
  {
    key: 'active',
    icon: 'eye-outline',
    ghosted: false,
    label: 'Active',
    desc: 'Visible on the map. Others can find and connect with you.',
  },
  {
    key: 'ghost',
    icon: 'eye-off-outline',
    ghosted: true,
    label: 'Ghost',
    desc: 'Hidden on the map but still appear in nearby lists.',
  },
  {
    key: 'invisible',
    icon: 'eye-off-outline',
    ghosted: false,
    label: 'Invisible',
    desc: 'Completely hidden. You cannot be seen or found by anyone.',
  },
];

// ─── SettingsRow ──────────────────────────────────────────────────────────────
function SettingsRow({
  label,
  right,
  onPress,
  last = false,
}: {
  label: string;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const inner = (
    <View style={[styles.settingsRow, !last && styles.settingsRowBorder]}>
      <Text style={styles.settingsLabel}>{label}</Text>
      <View style={styles.settingsRight}>{right}</View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => pressed && styles.pressed}
      >
        {inner}
      </Pressable>
    );
  }
  return inner;
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const { logout } = useAuth();
  const { top, bottom } = useSafeAreaInsets();
  const scrollProps = useScrollHandler();

  const [privacy, setPrivacy] = useState<PrivacyMode>('active');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  useEffect(() => {
    api.get<Profile>('/api/users/profile/')
      .then((r) => {
        const mode = r.data.privacy_mode ?? r.data.privacy ?? r.data.status ?? 'active';
        setPrivacy(mode as PrivacyMode);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function selectPrivacy(mode: PrivacyMode) {
    if (mode === privacy || saving) return;
    const prev = privacy;
    setPrivacy(mode);
    setSaving(true);
    try {
      await api.patch('/api/users/privacy/', { privacy_mode: mode });
    } catch {
      setPrivacy(prev);
    } finally {
      setSaving(false);
    }
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This cannot be undone. All your data will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try { await api.delete('/api/users/delete/'); } catch {}
            await logout();
          },
        },
      ],
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: top + 20, paddingBottom: bottom + 110 }]}
        showsVerticalScrollIndicator={false}
        {...scrollProps}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
          {saving && <ActivityIndicator color={colors.teal} size="small" />}
        </View>

        {/* Privacy mode */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PRIVACY MODE</Text>
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.teal} />
            </View>
          ) : (
            <View style={styles.privacyList}>
              {PRIVACY_MODES.map((mode) => {
                const selected = privacy === mode.key;
                return (
                  <Card
                    key={mode.key}
                    onPress={() => selectPrivacy(mode.key)}
                    style={selected ? styles.privacyCardSelected : undefined}
                  >
                    <View style={styles.privacyCardInner}>
                      <Ionicons
                        name={mode.icon}
                        size={22}
                        color={selected ? colors.teal : colors.t3}
                        style={mode.ghosted && !selected ? styles.iconGhosted : undefined}
                      />
                      <View style={styles.privacyText}>
                        <Text style={[styles.privacyLabel, selected && styles.privacyLabelSelected]}>
                          {mode.label}
                        </Text>
                        <Text style={styles.privacyDesc}>{mode.desc}</Text>
                      </View>
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
        </View>

        {/* Other settings */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PREFERENCES</Text>
          <Card style={styles.rowsCard}>
            <SettingsRow
              label="Notifications"
              right={
                <Switch
                  value={notificationsEnabled}
                  onValueChange={setNotificationsEnabled}
                  trackColor={{ false: colors.surface2, true: colors.teal }}
                  thumbColor={colors.t1}
                  ios_backgroundColor={colors.surface2}
                />
              }
            />
            <SettingsRow
              label="Privacy Policy"
              last
              onPress={() => Linking.openURL('https://aura-app.com/privacy')}
              right={<Ionicons name="chevron-forward" size={16} color={colors.t3} />}
            />
          </Card>
        </View>

        {/* Danger zone */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>DANGER ZONE</Text>
          <Pressable
            style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
            onPress={confirmDeleteAccount}
          >
            <Ionicons name="trash-outline" size={17} color={colors.red} />
            <Text style={styles.deleteText}>Delete Account</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 26,
    color: colors.t1,
  },

  // Section
  section: { marginBottom: 28 },
  sectionLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  loadingWrap: { paddingVertical: 24, alignItems: 'center' },

  // Privacy cards
  privacyList: { gap: 8 },
  privacyCardSelected: {
    backgroundColor: colors.tealTint,
    borderColor: colors.tealLine,
  },
  privacyCardInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  iconGhosted: { opacity: 0.45 },
  privacyText: { flex: 1, gap: 4 },
  privacyLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: colors.t2,
  },
  privacyLabelSelected: { color: colors.t1 },
  privacyDesc: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
    lineHeight: 18,
  },

  // Settings rows card
  rowsCard: { padding: 0, overflow: 'hidden' },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  settingsRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  settingsLabel: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t1,
  },
  settingsRight: { flexDirection: 'row', alignItems: 'center' },

  // Delete button
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.m,
    backgroundColor: `${colors.red}18`,
    borderWidth: 1,
    borderColor: `${colors.red}35`,
  },
  deleteText: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.red,
  },

  pressed: { opacity: 0.6 },
});
