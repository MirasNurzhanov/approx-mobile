import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import {
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
} from '@/services/backgroundLocation';
import { getPref, setPref } from '@/services/preferences';
import { Speedometer } from '@/components/Speedometer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  IconBell,
  IconBlocked,
  IconChevron,
  IconEye,
  IconEyeOff,
  IconGhost,
  IconInfo,
  IconLogout,
  IconMail,
  IconMusic,
  IconPin,
  IconShield,
  IconSound,
  IconTrash,
  type IconComponent,
} from '@/components/ui/icons';
import { useScrollHandler } from '@/hooks/useScrollHandler';
import { colors, fonts, radius } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
type PrivacyMode = 'active' | 'ghost' | 'invisible';

interface Profile {
  privacy_mode?: PrivacyMode;
  privacy?: PrivacyMode;
  status?: PrivacyMode;
}

interface SelfZone {
  zone_active?: boolean;
  zone_radius?: number;
}

const FEEDBACK_EMAIL = 'support@aura-app.com';

// ─── Privacy mode definitions ─────────────────────────────────────────────────
const PRIVACY_MODES: {
  key: PrivacyMode;
  Icon: IconComponent;
  label: string;
  sub: string;
}[] = [
  { key: 'active',    Icon: IconEye,    label: 'Active',    sub: 'Visible to all' },
  { key: 'ghost',     Icon: IconGhost,  label: 'Ghost',     sub: 'Friends only' },
  { key: 'invisible', Icon: IconEyeOff, label: 'Invisible', sub: 'Hidden' },
];

// ─── SettingsRow ──────────────────────────────────────────────────────────────
function SettingsRow({
  icon: Icon,
  label,
  right,
  onPress,
  last = false,
}: {
  icon?: IconComponent;
  label: string;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const inner = (
    <View style={[styles.settingsRow, !last && styles.settingsRowBorder]}>
      {Icon && <Icon size={20} color={colors.t2} />}
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

function PrefSwitch({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors.surface2, true: colors.teal }}
      thumbColor={colors.t1}
      ios_backgroundColor={colors.surface2}
    />
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const { logout } = useAuth();
  const { top, bottom } = useSafeAreaInsets();
  const scrollProps = useScrollHandler();

  const [privacy, setPrivacy] = useState<PrivacyMode>('active');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [zoneActive, setZoneActive] = useState<boolean | null>(null);
  const [zoneSaving, setZoneSaving] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [bgLocation, setBgLocation] = useState(true);
  const [notifAllowed, setNotifAllowed] = useState<boolean | null>(null);

  const refreshNotifPermission = useCallback(async () => {
    try {
      const p = await Notifications.getPermissionsAsync();
      setNotifAllowed(p.granted);
    } catch {
      setNotifAllowed(false);
    }
  }, []);

  // The OS owns this permission — re-check it whenever the app returns to the
  // foreground so the switch reflects changes made in system settings.
  useEffect(() => {
    refreshNotifPermission();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshNotifPermission();
    });
    return () => sub.remove();
  }, [refreshNotifPermission]);

  useEffect(() => {
    api.get<Profile>('/api/users/profile/')
      .then((r) => {
        const mode = r.data.privacy_mode ?? r.data.privacy ?? r.data.status ?? 'active';
        setPrivacy(mode as PrivacyMode);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    api.get<SelfZone>('/api/users/zone/')
      .then((r) => setZoneActive(!!r.data.zone_active))
      .catch(() => setZoneActive(false));

    getPref('zoneAutoplay').then(setAutoplay);
    getPref('backgroundLocation').then(setBgLocation);
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

  async function toggleZone(value: boolean) {
    if (zoneSaving) return;
    const prev = zoneActive;
    setZoneActive(value);
    setZoneSaving(true);
    try {
      await api.patch('/api/users/zone/', { zone_active: value });
    } catch {
      setZoneActive(prev);
      Alert.alert('Could not update zone', 'Please try again.');
    } finally {
      setZoneSaving(false);
    }
  }

  function toggleAutoplay(value: boolean) {
    setAutoplay(value);
    setPref('zoneAutoplay', value);
  }

  async function toggleBgLocation(value: boolean) {
    setBgLocation(value);
    await setPref('backgroundLocation', value);

    if (!value) {
      await stopBackgroundLocationUpdates();
      return;
    }

    let granted = false;
    try {
      const { status } = await Location.requestBackgroundPermissionsAsync();
      granted = status === 'granted';
    } catch {
      granted = false;
    }
    if (!granted) {
      setBgLocation(false);
      await setPref('backgroundLocation', false);
      Alert.alert(
        'Permission needed',
        'Allow background location access ("Always") in system settings so Aura can update your location while the app is closed.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }
    await startBackgroundLocationUpdates();
  }

  async function toggleNotifications(value: boolean) {
    if (!value) {
      // Permission can't be revoked programmatically — point to system settings.
      Alert.alert(
        'Turn off notifications',
        'Notifications are managed by the system. Turn them off for Aura in system settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }
    try {
      const current = await Notifications.getPermissionsAsync();
      if (current.granted) {
        setNotifAllowed(true);
        return;
      }
      if (current.canAskAgain) {
        const r = await Notifications.requestPermissionsAsync();
        setNotifAllowed(r.granted);
      } else {
        Alert.alert(
          'Permission needed',
          'Enable notifications for Aura in system settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
    } catch {
      setNotifAllowed(false);
    }
  }

  async function sendFeedback() {
    const url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Aura feedback')}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('No mail app', `Write to us at ${FEEDBACK_EMAIL}`);
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

  const version = Constants.expoConfig?.version ?? '1.0.0';

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

        {/* Visibility */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>VISIBILITY</Text>
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.teal} />
            </View>
          ) : (
            <View style={styles.modeRow}>
              {PRIVACY_MODES.map((mode) => {
                const selected = privacy === mode.key;
                return (
                  <Pressable
                    key={mode.key}
                    onPress={() => selectPrivacy(mode.key)}
                    style={({ pressed }) => [
                      styles.modeCard,
                      selected && styles.modeCardSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <mode.Icon size={22} color={selected ? colors.teal : colors.t3} />
                    <Text style={[styles.modeLabel, selected && styles.modeLabelSelected]}>
                      {mode.label}
                    </Text>
                    <Text style={styles.modeSub}>{mode.sub}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {/* Zone & location */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ZONE & LOCATION</Text>
          <Card style={styles.rowsCard}>
            <SettingsRow
              icon={IconSound}
              label="Sound zone"
              right={
                zoneActive === null ? (
                  <ActivityIndicator color={colors.t3} size="small" />
                ) : (
                  <PrefSwitch value={zoneActive} onValueChange={toggleZone} disabled={zoneSaving} />
                )
              }
            />
            <SettingsRow
              icon={IconMusic}
              label="Auto-play zone audio"
              right={<PrefSwitch value={autoplay} onValueChange={toggleAutoplay} />}
            />
            <SettingsRow
              icon={IconPin}
              label="Background location"
              last
              right={<PrefSwitch value={bgLocation} onValueChange={toggleBgLocation} />}
            />
          </Card>
        </View>

        {/* Preferences */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PREFERENCES</Text>
          <Card style={styles.rowsCard}>
            <SettingsRow
              icon={IconBell}
              label="Notifications"
              right={
                notifAllowed === null ? (
                  <ActivityIndicator color={colors.t3} size="small" />
                ) : (
                  <PrefSwitch value={notifAllowed} onValueChange={toggleNotifications} />
                )
              }
            />
            <SettingsRow
              icon={IconShield}
              label="Privacy & safety"
              onPress={() => Linking.openURL('https://aura-app.com/privacy')}
              right={<IconChevron size={16} color={colors.t3} />}
            />
            <SettingsRow
              icon={IconBlocked}
              label="Blocked users"
              last
              onPress={() => Alert.alert('Blocked users', 'Coming soon.')}
              right={<IconChevron size={16} color={colors.t3} />}
            />
          </Card>
        </View>

        {/* Support */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SUPPORT</Text>
          <Card style={styles.rowsCard}>
            <SettingsRow
              icon={IconMail}
              label="Send feedback"
              onPress={sendFeedback}
              right={<IconChevron size={16} color={colors.t3} />}
            />
            <SettingsRow
              icon={IconInfo}
              label="Version"
              last
              right={<Text style={styles.rowValue}>{version}</Text>}
            />
          </Card>
        </View>

        {/* Sign out */}
        <View style={styles.signOutWrap}>
          <Button
            label="Sign out"
            icon={IconLogout}
            variant="dangerTint"
            size="lg"
            fullWidth
            onPress={() => logout()}
          />
        </View>

        {/* Delete account */}
        <Pressable
          style={({ pressed }) => [styles.deleteRow, pressed && styles.pressed]}
          onPress={confirmDeleteAccount}
        >
          <IconTrash size={16} color={colors.red} />
          <Text style={styles.deleteText}>Delete account</Text>
        </Pressable>
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

  // Visibility mode cards (3-up row)
  modeRow: { flexDirection: 'row', gap: 8 },
  modeCard: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeCardSelected: {
    backgroundColor: colors.tealTint,
    borderColor: colors.tealLine,
  },
  modeLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.t1,
  },
  modeLabelSelected: { color: colors.teal },
  modeSub: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.t3,
  },

  // Settings rows card
  rowsCard: { padding: 0, overflow: 'hidden' },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  settingsRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  settingsLabel: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t1,
  },
  settingsRight: { flexDirection: 'row', alignItems: 'center' },
  rowValue: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t3,
  },

  // Sign out + delete
  signOutWrap: { marginBottom: 18 },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  deleteText: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.red,
  },

  pressed: { opacity: 0.6 },
});
