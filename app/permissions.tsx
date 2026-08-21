import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useScreenTopInset } from '@/hooks/useScreenTopInset';
import { usePermissionPrimer } from '@/components/PermissionPrimer';
import { Card } from '@/components/ui/Card';
import { IconChevron } from '@/components/ui/icons';
import { fonts, radius, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  ALL_PERMISSIONS,
  bindForegroundRefresh,
  openAppSettings,
  refreshPermissions,
  PERMISSION_COPY,
  usePermissionStore,
  type PermissionInfo,
  type PermissionKey,
  type PermissionState,
} from '@/services/permissions';
import { registerForPushNotifications } from '@/services/notifications';
import { refreshPrivacy, usePrivacySettings } from '@/services/privacy';

// Settings → Permissions. One row per OS permission: what it is for, what the
// OS currently says, and the way to change it.
//
// This screen never guesses — it re-reads on mount and on every return to the
// foreground, because the user may have just changed the setting in the OS and
// come straight back.

const STATE_TEXT: Record<PermissionState, string> = {
  granted: 'Allowed',
  denied: 'Not allowed',
  blocked: 'Blocked in system settings',
  undetermined: 'Not asked yet',
  unsupported: 'Unavailable on this device',
};

const makeStateColor = (colors: ColorPalette): Record<PermissionState, string> => ({
  granted: colors.teal,
  denied: colors.orange,
  blocked: colors.red,
  undetermined: colors.t2,
  unsupported: colors.t3,
});

/** Colour alone must not carry the status — pair it with a glyph. */
const STATE_GLYPH: Record<PermissionState, string> = {
  granted: '✓',
  denied: '!',
  blocked: '×',
  undetermined: '–',
  unsupported: '–',
};

function PermissionRow({
  info,
  onAsk,
  last,
}: {
  info: PermissionInfo;
  onAsk: (key: PermissionKey) => void;
  last: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const STATE_COLOR = makeStateColor(colors);
  const copy = PERMISSION_COPY[info.key];
  const askable = info.state === 'undetermined' || info.state === 'denied';
  const actionLabel = askable ? 'Allow' : 'Open Settings';

  return (
    <View
      style={[styles.row, !last && styles.rowBorder]}
      accessible
      accessibilityLabel={`${copy.title}. ${STATE_TEXT[info.state]}.${
        info.caveat ? ` ${info.caveat}.` : ''
      } ${copy.purpose}`}
    >
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle}>{copy.title}</Text>
          <Text
            style={[styles.status, { color: STATE_COLOR[info.state] }]}
            importantForAccessibility="no"
          >
            {STATE_GLYPH[info.state]} {STATE_TEXT[info.state]}
          </Text>
        </View>
        <Text style={styles.rowPurpose}>{copy.purpose}</Text>
        {info.caveat && <Text style={styles.caveat}>{info.caveat}</Text>}
      </View>

      {info.state !== 'granted' && info.state !== 'unsupported' && (
        <Pressable
          onPress={() => (askable ? onAsk(info.key) : openAppSettings())}
          hitSlop={8}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} ${copy.title.toLowerCase()}`}
          accessibilityHint={
            askable
              ? 'Explains what this unlocks, then asks the system for permission'
              : 'Opens the system settings app'
          }
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function PermissionsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();
  const top = useScreenTopInset();
  const store = usePermissionStore();
  const { settings } = usePrivacySettings();
  const { ensure, primer } = usePermissionPrimer();

  useEffect(() => {
    refreshPermissions().catch(() => {});
    refreshPrivacy().catch(() => {});
    // The user may leave for the OS settings screen and come straight back.
    return bindForegroundRefresh();
  }, []);

  async function ask(key: PermissionKey) {
    const granted = await ensure(key);
    await refreshPermissions([key]);
    // Login no longer prompts for notifications, so this is where the push
    // token first gets registered.
    if (granted && key === 'notifications') {
      registerForPushNotifications().catch(() => {});
    }
  }

  // `!== 'live' && !== 'approximate'` rather than `=== 'paused'`, so that a
  // settings object we have not loaded yet — or one that failed to load —
  // reads as hidden. The old form made `undefined` fall through to "you are on
  // the map right now", which is the one direction this screen must never be
  // wrong in: it would tell somebody they were visible when they were not, or
  // worse, reassure them the opposite way round after a failed fetch.
  const sharingKnown = settings?.location_sharing;
  const paused = sharingKnown !== 'live' && sharingKnown !== 'approximate';
  const approximate = sharingKnown === 'approximate';

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <ScreenHeader title="Permissions" subtitle="What Aura can access, and why" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* The distinction this screen is most likely to be misread on, said
            first and unconditionally. Letting Aura read your location is not
            the same as other people being able to see it — that takes choosing
            Live or Approximate in Privacy & safety. It is not implied by
            anything on this page, and none of these switches can turn it on. */}
        <Card style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>
            {paused ? 'Nobody can see your location' : 'You are on the map right now'}
          </Text>
          <Text style={styles.noticeBody}>
            {paused
              ? 'Location permission lets Aura show you who is nearby. You are only shown to other people once you choose Live or Approximate in Privacy & safety — never automatically, and never just because this permission is granted.'
              : 'People nearby can see you, including with Aura in the background, until you choose Paused in Privacy & safety or close Aura.'}
          </Text>
        </Card>

        {/* An OS permission being granted is not the same as Aura using it.
            Someone who paused sharing should see that here, not conclude the
            permission is broken. */}
        {(paused || approximate) && (
          <Card style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>
              {paused ? 'Location sharing is paused' : 'Location sharing is set to Approximate'}
            </Text>
            <Text style={styles.noticeBody}>
              {paused
                ? 'Aura has location permission but is not using it — you are off the map until you resume.'
                : 'Your position is rounded to about 500m before it leaves your phone.'}
            </Text>
            <Pressable
              onPress={() => router.push('/privacy')}
              style={({ pressed }) => [styles.noticeLink, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Open privacy and safety settings"
            >
              <Text style={styles.noticeLinkText}>Change in Privacy &amp; safety</Text>
              <IconChevron size={14} color={colors.teal} />
            </Pressable>
          </Card>
        )}

        <Card style={styles.rowsCard}>
          {ALL_PERMISSIONS.map((key, index) => {
            const info = store[key] ?? { key, state: 'undetermined' as const, caveat: null };
            return (
              <PermissionRow
                key={key}
                info={info}
                onAsk={ask}
                last={index === ALL_PERMISSIONS.length - 1}
              />
            );
          })}
        </Card>

        <Text style={styles.footnote}>
          Aura never asks for the photo library. Picking an existing photo uses the system picker,
          which hands over only the image you choose.
        </Text>

        <Pressable
          onPress={openAppSettings}
          style={({ pressed }) => [styles.settingsBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Open Aura in system settings"
        >
          <Text style={styles.settingsBtnText}>Open system settings</Text>
        </Pressable>
      </ScrollView>

      {primer}
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerText: { flex: 1, gap: 2 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.title,
    color: colors.t1,
  },
  subtitle: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3 },

  noticeCard: { marginBottom: 16, gap: 6 },
  noticeTitle: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.t1,
  },
  noticeBody: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: typography.caption * 1.5,
    color: colors.t2,
  },
  noticeLink: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, minHeight: 44 },
  noticeLinkText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.teal,
  },

  rowsCard: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowText: { flex: 1, gap: 3 },
  rowTitleLine: { gap: 2 },
  rowTitle: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  status: { fontFamily: fonts.body, fontSize: typography.caption, fontWeight: '600' },
  rowPurpose: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: typography.caption * 1.45,
    color: colors.t2,
  },
  caveat: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.orange },

  action: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.teal,
  },

  footnote: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: typography.caption * 1.5,
    color: colors.t3,
    marginTop: 16,
  },

  settingsBtn: {
    marginTop: 20,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  settingsBtnText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },

  pressed: { opacity: 0.6 },
});
