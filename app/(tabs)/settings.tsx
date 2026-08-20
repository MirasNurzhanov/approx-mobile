import { useCallback, useEffect, useMemo, useState } from 'react';
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
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { runBusy } from '@/services/busy';
import { useAuth } from '@/context/AuthContext';
import { syncBackgroundLocation } from '@/services/backgroundLocation';
import { registerForPushNotifications } from '@/services/notifications';
import { hasSeenZoneTutorial, markZoneTutorialSeen } from '@/services/tutorial';
import {
  isAppleAvailable,
  isGoogleAvailable,
  linkAppleAccount,
  linkGoogleAccount,
  SocialSignInCancelled,
  SocialSignInError,
  type SocialProvider,
} from '@/services/socialAuth';
import { GoogleMark } from '@/components/SocialAuthButtons';
import { usePermissionPrimer } from '@/components/PermissionPrimer';
import { LocationSharingConsent } from '@/components/LocationSharingConsent';
import {
  LocationVisibilityCard,
  type SharingPrecision,
} from '@/components/LocationVisibilityCard';
import {
  refreshPrivacy,
  updatePrivacy,
  usePrivacySettings,
  type LocationSharing,
} from '@/services/privacy';
import { Speedometer } from '@/components/Speedometer';
import { ZoneTutorialOverlay } from '@/components/tutorial/ZoneTutorialOverlay';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  IconBell,
  IconBlocked,
  IconChevron,
  IconInfo,
  IconList,
  IconLocate,
  IconLock,
  IconLogout,
  IconMail,
  IconMoon,
  IconMusic,
  IconShield,
  IconSun,
  IconTrash,
  type IconComponent,
} from '@/components/ui/icons';
import { useScrollHandler } from '@/hooks/useScrollHandler';
import { fonts } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SelfZone {
  zone_active?: boolean;
  zone_radius?: number;
  zone_mode?: 'radius' | 'region';
  zone_region_detail?: { name: string } | null;
}

const FEEDBACK_EMAIL = 'support@aura-app.com';

// ─── Location visibility ──────────────────────────────────────────────────────
// The status readout, the precision choice and the check in / check out button
// all live in components/LocationVisibilityCard, shared with Privacy & safety.
// Two screens carrying their own copy of the most consequential wording in the
// app is how they end up describing it differently.

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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
  const { colors } = useTheme();
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

// ─── Sections ─────────────────────────────────────────────────────────────────
// One component per card on the screen. The screen below owns the state and the
// calls that change it; these only lay it out, which is what keeps the screen
// readable as a list of sections rather than 350 lines of nested JSX.

function LocationSharingSection({
  settings, failed, saving, onRetry, onCheckIn, onCheckOut, onPrecision,
}: {
  settings: ReturnType<typeof usePrivacySettings>['settings'];
  failed: boolean;
  saving: boolean;
  onRetry: () => void;
  onCheckIn: (mode: SharingPrecision) => void;
  onCheckOut: () => void;
  onPrecision: (mode: SharingPrecision) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>LOCATION VISIBILITY</Text>
      {!settings ? (
        <View style={styles.loadingWrap}>
          {failed ? (
            <Pressable onPress={onRetry} style={({ pressed }) => pressed && styles.pressed}>
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
          <LocationVisibilityCard
            settings={settings}
            saving={saving}
            onCheckIn={onCheckIn}
            onCheckOut={onCheckOut}
            onPrecision={onPrecision}
          />
          {settings.is_private && (
            <Text style={styles.modeNote}>
              Your account is private — this only controls where you appear on the map.
            </Text>
          )}
        </>
      )}
    </View>
  );
}

function ZoneSection({ zoneActive, zoneShape, zoneSaving, onToggleZone }: {
  zoneActive: boolean | null;
  zoneShape: string | null;
  zoneSaving: boolean;
  onToggleZone: (v: boolean) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>ZONE & LOCATION</Text>
      <Card style={styles.rowsCard}>
        {/* The zone is the circle that puts you on the map, not the music
            that plays in it — this switch adds and removes the zone
            itself. It was labelled "Sound zone", which made turning it off
            look like a way to mute a track.

            It used to *be* a way to mute a track: everything about the
            music zone was gated on this flag, so removing the circle also
            stopped friends hearing a song and stopped the alerts. The two
            are separate now, and each has its own switch — the music zone's
            is on Zone Music, and it removes that circle from the map the
            way this one removes yours. */}
        <SettingsRow
          icon={IconLocate}
          label="Zone on the map"
          right={
            zoneActive === null ? (
              <ActivityIndicator color={colors.t3} size="small" />
            ) : (
              <PrefSwitch value={zoneActive} onValueChange={onToggleZone} disabled={zoneSaving} />
            )
          }
        />
        {/* Switches first, then the rows that leave this screen — see the
            note above SettingsRow. "Auto-play zone audio" used to sit in
            this card too; nothing plays by itself any more, so the switch
            had nothing left to turn off. */}
        <SettingsRow
          icon={IconLocate}
          label="Zone size"
          onPress={() => router.push('/zone-area')}
          right={
            <View style={styles.rowTrailing}>
              {zoneShape ? <Text style={styles.rowTrailingText}>{zoneShape}</Text> : null}
              <IconChevron size={16} color={colors.t3} />
            </View>
          }
        />
        <SettingsRow
          icon={IconMusic}
          label="Zone music"
          last
          onPress={() => router.push('/zone')}
          right={<IconChevron size={16} color={colors.t3} />}
        />
      </Card>
    </View>
  );
}

function PreferencesSection({ notifAllowed, onToggleNotifications, darkMode, onToggleTheme }: {
  notifAllowed: boolean | null;
  onToggleNotifications: (v: boolean) => void;
  darkMode: boolean;
  onToggleTheme: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
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
              <PrefSwitch value={notifAllowed} onValueChange={onToggleNotifications} />
            )
          }
        />
        <SettingsRow
          icon={IconMoon}
          label="Dark mode"
          right={<PrefSwitch value={darkMode} onValueChange={onToggleTheme} />}
        />
        <SettingsRow
          icon={IconList}
          label="What to notify me about"
          onPress={() => router.push('/notification-settings')}
          right={<IconChevron size={16} color={colors.t3} />}
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
  );
}

/** One provider inside Connected Accounts — not SettingsRow, because its icon
 *  is a fixed-palette brand mark (GoogleMark) or a themed glyph (Apple's),
 *  neither of which fits the `(size, color) => JSX` shape every other row's
 *  icon follows. Same visual language regardless, borrowing SettingsRow's own
 *  row/border/label styles rather than duplicating them. */
function ConnectedProviderRow({
  icon,
  label,
  connected,
  busy,
  onPress,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  connected: boolean;
  busy: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const disabled = connected || busy;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.settingsRow,
        !last && styles.settingsRowBorder,
        pressed && !disabled && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={connected ? `${label}, connected` : `Connect ${label}`}
      accessibilityState={{ disabled }}
    >
      {icon}
      <Text style={styles.settingsLabel}>{label}</Text>
      <View style={styles.settingsRight}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.t3} />
        ) : connected ? (
          <View style={styles.connectedBadge}>
            <Ionicons name="checkmark-circle" size={15} color={colors.teal} />
            <Text style={styles.connectedText}>Connected</Text>
          </View>
        ) : (
          <IconChevron size={16} color={colors.t3} />
        )}
      </View>
    </Pressable>
  );
}

/**
 * Attach Google or Apple to the account already signed in.
 *
 * Distinct from the buttons on /register: those trade a provider token for a
 * *session*; these attach one to the session that already exists (see
 * services/socialAuth's "Linking" section). The backend already auto-links by
 * email when someone taps a social button for an account it recognises — this
 * is the explicit version, for someone who made a password account first and
 * wants Google/Apple to work too, without needing to know that tapping the
 * button anywhere would have quietly done it.
 *
 * Absent entirely when neither provider can run here — same rule the sign-in
 * buttons follow, a row that cannot work is not a row.
 */
function ConnectedAccountsSection({ connectedProviders, appleReady, linking, onConnect }: {
  connectedProviders: SocialProvider[];
  appleReady: boolean;
  linking: SocialProvider | null;
  onConnect: (provider: SocialProvider) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  if (!isGoogleAvailable && !appleReady) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>CONNECTED ACCOUNTS</Text>
      <Card style={styles.rowsCard}>
        {isGoogleAvailable && (
          <ConnectedProviderRow
            icon={<GoogleMark size={18} />}
            label="Google"
            connected={connectedProviders.includes('google')}
            busy={linking === 'google'}
            onPress={() => onConnect('google')}
            last={!appleReady}
          />
        )}
        {appleReady && (
          <ConnectedProviderRow
            icon={<Ionicons name="logo-apple" size={20} color={colors.t1} />}
            label="Apple"
            connected={connectedProviders.includes('apple')}
            busy={linking === 'apple'}
            onPress={() => onConnect('apple')}
            last
          />
        )}
      </Card>
    </View>
  );
}

function SupportSection({ version, onSendFeedback }: {
  version: string;
  onSendFeedback: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>SUPPORT</Text>
      <Card style={styles.rowsCard}>
        <SettingsRow
          icon={IconMail}
          label="Send feedback"
          onPress={onSendFeedback}
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
  );
}

function AccountActions({ isSigningOut, onSignOut, onDeleteAccount }: {
  isSigningOut: boolean;
  onSignOut: () => void;
  onDeleteAccount: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <>
      <View style={styles.signOutWrap}>
        <Button
          label="Sign out"
          icon={IconLogout}
          variant="dangerTint"
          size="lg"
          fullWidth
          loading={isSigningOut}
          onPress={onSignOut}
        />
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.deleteRow,
          (pressed || isSigningOut) && styles.pressed,
        ]}
        // Teardown has already cleared the tokens by the time it navigates,
        // so a delete fired mid-sign-out just 401s into the auth redirect.
        disabled={isSigningOut}
        onPress={onDeleteAccount}
      >
        <IconTrash size={16} color={colors.red} />
        <Text style={styles.deleteText}>Delete account</Text>
      </Pressable>
    </>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
/** The one-line summary on the Zone size row, so the current shape is legible
 *  without opening the screen. */
function describeZone(zone: SelfZone): string {
  if (zone.zone_mode === 'region' && zone.zone_region_detail?.name) {
    return zone.zone_region_detail.name;
  }
  const m = zone.zone_radius && zone.zone_radius > 0 ? zone.zone_radius : 500;
  return m < 1000 ? `${m} m` : `${(m / 1000) % 1 === 0 ? m / 1000 : (m / 1000).toFixed(1)} km`;
}

export default function SettingsScreen() {
  const { colors, themeMode, toggleTheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { logout, confirmLogout, isSigningOut } = useAuth();
  const { top, bottom } = useSafeAreaInsets();
  const scrollProps = useScrollHandler();

  const { settings } = usePrivacySettings();
  const [saving, setSaving] = useState(false);
  const [privacyFailed, setPrivacyFailed] = useState(false);
  const { ensure: ensurePermission, primer } = usePermissionPrimer();

  const [zoneActive, setZoneActive] = useState<boolean | null>(null);
  const [zoneShape, setZoneShape] = useState<string | null>(null);
  const [zoneSaving, setZoneSaving] = useState(false);
  const [notifAllowed, setNotifAllowed] = useState<boolean | null>(null);

  // First-run tutorial, step 2: where the zone lives. The flag is namespaced
  // by account (see services/tutorial.ts), so this needs the account's id —
  // this screen has no other reason to fetch it, unlike the map, which
  // already has one for /nearby/'s self exclusion. `connected_providers`
  // rides the same response for Connected Accounts below, rather than a
  // second request for what is already the full profile payload.
  const [tutorialUserId, setTutorialUserId] = useState<number | null>(null);
  const [connectedProviders, setConnectedProviders] = useState<SocialProvider[]>([]);
  useEffect(() => {
    api.get<{ id: number; connected_providers?: SocialProvider[] }>('/api/users/me/')
      .then((r) => {
        setTutorialUserId(r.data.id);
        setConnectedProviders(r.data.connected_providers ?? []);
      })
      .catch(() => {});
  }, []);
  const [showZoneTutorial, setShowZoneTutorial] = useState(false);
  useEffect(() => {
    if (tutorialUserId === null) return;
    hasSeenZoneTutorial(tutorialUserId).then((seen) => { if (!seen) setShowZoneTutorial(true); });
  }, [tutorialUserId]);
  function dismissZoneTutorial() {
    setShowZoneTutorial(false);
    if (tutorialUserId !== null) markZoneTutorialSeen(tutorialUserId).catch(() => {});
  }
  function takeMeToZone() {
    dismissZoneTutorial();
    router.push('/zone-area');
  }

  // Connected accounts: Apple's availability is async and iOS-only, same
  // check the sign-in buttons use, so the row waits on it rather than
  // guessing. `linking` gates both buttons at once — nothing about the flow
  // is per-provider once a request is in flight.
  const [appleReady, setAppleReady] = useState(false);
  useEffect(() => {
    let alive = true;
    isAppleAvailable().then((ok) => { if (alive) setAppleReady(ok); });
    return () => { alive = false; };
  }, []);
  const [linking, setLinking] = useState<SocialProvider | null>(null);
  async function connectProvider(provider: SocialProvider) {
    if (linking) return;
    setLinking(provider);
    await runBusy(
      async () => {
        const providers = provider === 'google'
          ? await linkGoogleAccount()
          : await linkAppleAccount();
        setConnectedProviders(providers);
      },
      () => setLinking(null),
    ).catch((err) => {
      // Same rule as the sign-in buttons: backing out of the provider's own
      // sheet is not a failure worth an alert.
      if (err instanceof SocialSignInCancelled) return;
      Alert.alert(
        'Could not connect',
        err instanceof SocialSignInError ? err.message : 'Please try again.',
      );
    });
  }

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
  }, []);

  // Re-read on every focus, not once per mount. This is a tab, so it stays
  // mounted for the whole session — and it is the only place the zone can be
  // added or removed, so a switch showing a stale "on" is a user who believes
  // they are on the map when they are not.
  useFocusEffect(
    useCallback(() => {
      api.get<SelfZone>('/api/users/zone/')
        .then((r) => {
          setZoneActive(!!r.data.zone_active);
          setZoneShape(describeZone(r.data));
        })
        .catch(() => setZoneActive(false));
    }, []),
  );

  // The precision asked for but not yet agreed to. Checking *in* publishes your
  // position, so it goes through the consent sheet first; checking out applies
  // at once, because a confirmation on the way out would stand between a user
  // and hiding.
  const [pendingMode, setPendingMode] = useState<SharingPrecision | null>(null);

  async function applyLocationSharing(mode: LocationSharing) {
    setSaving(true);
    await runBusy(async () => {
      await updatePrivacy({ location_sharing: mode });
      // Pausing must stop OS tracking now, not at the next app launch — and
      // resuming must start it, or the position would go stale the moment the
      // app was backgrounded.
      await syncBackgroundLocation();
      setPendingMode(null);
    }, () => setSaving(false))
      .catch(() => Alert.alert('Could not update', 'Your previous setting is still in effect.'));
  }

  async function toggleZone(value: boolean) {
    if (zoneSaving) return;
    const prev = zoneActive;
    setZoneActive(value);
    setZoneSaving(true);
    await runBusy(
      () => api.patch('/api/users/zone/', { zone_active: value }),
      () => setZoneSaving(false),
    ).catch(() => {
      setZoneActive(prev);
      Alert.alert('Could not update zone', 'Please try again.');
    });
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

        <LocationSharingSection
          settings={settings}
          failed={privacyFailed}
          onRetry={() => {
            setPrivacyFailed(false);
            refreshPrivacy().catch(() => setPrivacyFailed(true));
          }}
          saving={saving}
          onCheckIn={setPendingMode}
          onCheckOut={() => applyLocationSharing('paused')}
          onPrecision={applyLocationSharing}
        />

        <LocationSharingConsent
          mode={pendingMode}
          busy={saving}
          onCancel={() => setPendingMode(null)}
          onConfirm={applyLocationSharing}
        />

        <ZoneSection
          zoneActive={zoneActive}
          zoneShape={zoneShape}
          zoneSaving={zoneSaving}
          onToggleZone={toggleZone}
        />

        <PreferencesSection
          notifAllowed={notifAllowed}
          onToggleNotifications={toggleNotifications}
          darkMode={themeMode === 'dark'}
          onToggleTheme={toggleTheme}
        />

        <ConnectedAccountsSection
          connectedProviders={connectedProviders}
          appleReady={appleReady}
          linking={linking}
          onConnect={connectProvider}
        />

        <SupportSection version={version} onSendFeedback={sendFeedback} />

        <AccountActions
          isSigningOut={isSigningOut}
          onSignOut={confirmLogout}
          onDeleteAccount={confirmDeleteAccount}
        />
      </ScrollView>

      {primer}

      {showZoneTutorial && (
        <ZoneTutorialOverlay onDismiss={dismissZoneTutorial} onTakeMeThere={takeMeToZone} />
      )}

      <Speedometer highlightSection={showZoneTutorial ? 'settings' : undefined} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
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

  // Notes under the location card, and the retry line that replaces it while
  // the setting is still loading.
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
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTrailingText: { fontFamily: fonts.body, fontSize: 13, color: colors.t3 },
  rowValue: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t3,
  },
  connectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  connectedText: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.teal,
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
