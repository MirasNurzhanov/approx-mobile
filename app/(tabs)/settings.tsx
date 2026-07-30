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
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import {
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
  syncBackgroundLocationSharing,
} from '@/services/backgroundLocation';
import { registerForPushNotifications } from '@/services/notifications';
import { getPref, setPref } from '@/services/preferences';
import { usePermissionPrimer } from '@/components/PermissionPrimer';
import {
  refreshPrivacy,
  updatePrivacy,
  usePrivacySettings,
  type LocationSharing,
} from '@/services/privacy';
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
  IconLocate,
  IconLock,
  IconLogout,
  IconMail,
  IconMusic,
  IconPin,
  IconShield,
  IconTrash,
  type IconComponent,
} from '@/components/ui/icons';
import { useScrollHandler } from '@/hooks/useScrollHandler';
import { colors, fonts, radius } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SelfZone {
  zone_active?: boolean;
  zone_radius?: number;
}

const FEEDBACK_EMAIL = 'support@aura-app.com';

// ─── Location sharing ─────────────────────────────────────────────────────────
// This replaces the old Active/Ghost/Invisible selector. Ghost was labelled
// "Friends only" but actually hid coordinates from everyone including friends;
// it is now Approximate, which is what people assumed it did all along.
const LOCATION_MODES: {
  key: LocationSharing;
  Icon: IconComponent;
  label: string;
  sub: string;
}[] = [
  { key: 'live',        Icon: IconEye,    label: 'Live',        sub: 'Exact position' },
  { key: 'approximate', Icon: IconGhost,  label: 'Approximate', sub: 'Within ~500m' },
  { key: 'paused',      Icon: IconEyeOff, label: 'Paused',      sub: 'Off the map' },
];

// ─── SettingsRow ──────────────────────────────────────────────────────────────
/**
 * One row in a settings card.
 *
 * Ordering rule for every card on this screen: **switches first, links last.**
 * A switch is a decision you make here and see the result of immediately; a row
 * with a chevron takes you somewhere else and loses your place in the list.
 * Mixing them puts a trapdoor in the middle of a column of toggles, so each
 * card reads as toggles, then exits — never a link with switches under it.
 */
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
  const { logout, confirmLogout, isSigningOut } = useAuth();
  const { top, bottom } = useSafeAreaInsets();
  const scrollProps = useScrollHandler();

  const { settings } = usePrivacySettings();
  const [saving, setSaving] = useState(false);
  const [privacyFailed, setPrivacyFailed] = useState(false);
  const { ensure: ensurePermission, primer } = usePermissionPrimer();

  const [zoneActive, setZoneActive] = useState<boolean | null>(null);
  const [zoneSaving, setZoneSaving] = useState(false);
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
    refreshPrivacy().catch(() => setPrivacyFailed(true));
    getPref('backgroundLocation').then(setBgLocation);
  }, []);

  // Re-read on every focus, not once per mount. This is a tab, so it stays
  // mounted for the whole session — and it is the only place the zone can be
  // added or removed, so a switch showing a stale "on" is a user who believes
  // they are on the map when they are not.
  useFocusEffect(
    useCallback(() => {
      api.get<SelfZone>('/api/users/zone/')
        .then((r) => setZoneActive(!!r.data.zone_active))
        .catch(() => setZoneActive(false));
    }, []),
  );

  async function selectLocationSharing(mode: LocationSharing) {
    if (mode === settings?.location_sharing || saving) return;
    setSaving(true);
    try {
      await updatePrivacy({ location_sharing: mode });
      // Pausing must stop OS tracking now, not at the next app launch.
      await syncBackgroundLocationSharing();
    } catch {
      Alert.alert('Could not update', 'Your previous setting is still in effect.');
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
      // Primed rather than prompted cold, and the primer itself offers the
      // route to system settings when the ask is no longer possible.
      const granted = await ensurePermission('notifications');
      setNotifAllowed(granted);
      if (granted) registerForPushNotifications().catch(() => {});
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

        {/* Location sharing */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>LOCATION SHARING</Text>
          {!settings ? (
            <View style={styles.loadingWrap}>
              {privacyFailed ? (
                <Pressable
                  onPress={() => {
                    setPrivacyFailed(false);
                    refreshPrivacy().catch(() => setPrivacyFailed(true));
                  }}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={styles.modeNote}>
                    Couldn’t load your location setting. Tap to retry.
                  </Text>
                </Pressable>
              ) : (
                <ActivityIndicator color={colors.teal} />
              )}
            </View>
          ) : (
            <>
              <View style={styles.modeRow}>
                {LOCATION_MODES.map((mode) => {
                  const selected = settings.location_sharing === mode.key;
                  return (
                    <Pressable
                      key={mode.key}
                      onPress={() => selectLocationSharing(mode.key)}
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
              {settings.is_private && (
                <Text style={styles.modeNote}>
                  Your account is private — this only controls where you appear on the map.
                </Text>
              )}
            </>
          )}
        </View>

        {/* Zone & location */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ZONE & LOCATION</Text>
          <Card style={styles.rowsCard}>
            {/* The zone is the circle that puts you on the map, not the music
                that plays in it — this switch adds and removes the zone
                itself. It was labelled "Sound zone", which made turning it off
                look like a way to mute a track. */}
            <SettingsRow
              icon={IconLocate}
              label="Zone on the map"
              right={
                zoneActive === null ? (
                  <ActivityIndicator color={colors.t3} size="small" />
                ) : (
                  <PrefSwitch value={zoneActive} onValueChange={toggleZone} disabled={zoneSaving} />
                )
              }
            />
            <SettingsRow
              icon={IconPin}
              label="Background location"
              right={<PrefSwitch value={bgLocation} onValueChange={toggleBgLocation} />}
            />
            {/* Switches first, then the rows that leave this screen — see the
                note above SettingsRow. "Auto-play zone audio" used to sit in
                this card too; nothing plays by itself any more, so the switch
                had nothing left to turn off. */}
            <SettingsRow
              icon={IconMusic}
              label="Zone music"
              last
              onPress={() => router.push('/zone')}
              right={<IconChevron size={16} color={colors.t3} />}
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
              onPress={() => router.push('/privacy')}
              right={<IconChevron size={16} color={colors.t3} />}
            />
            <SettingsRow
              icon={IconLock}
              label="Permissions"
              onPress={() => router.push('/permissions')}
              right={<IconChevron size={16} color={colors.t3} />}
            />
            <SettingsRow
              icon={IconBlocked}
              label="Blocked users"
              last
              onPress={() => router.push('/blocked-users')}
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
            loading={isSigningOut}
            onPress={confirmLogout}
          />
        </View>

        {/* Delete account */}
        <Pressable
          style={({ pressed }) => [
            styles.deleteRow,
            (pressed || isSigningOut) && styles.pressed,
          ]}
          // Teardown has already cleared the tokens by the time it navigates,
          // so a delete fired mid-sign-out just 401s into the auth redirect.
          disabled={isSigningOut}
          onPress={confirmDeleteAccount}
        >
          <IconTrash size={16} color={colors.red} />
          <Text style={styles.deleteText}>Delete account</Text>
        </Pressable>
      </ScrollView>

      {primer}

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
    textAlign: 'center',
  },
  modeNote: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.t3,
    marginTop: 10,
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
