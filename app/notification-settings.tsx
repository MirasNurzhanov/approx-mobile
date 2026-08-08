import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

import { Card } from '@/components/ui/Card';
import {
  IconBack,
  IconBell,
  IconCalendar,
  IconHeart,
  IconHi,
  IconMail,
  IconMusic,
  IconPeople,
  type IconComponent,
} from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  refreshNotificationPrefs,
  updateNotificationPrefs,
  useNotificationPrefs,
  type NotificationPrefs,
} from '@/services/notificationPrefs';

// Settings → Notifications. What the server is allowed to send.
//
// Deliberately not the same thing as the OS permission, and the banner at the
// top says so when that permission is missing: every switch below is
// unreachable in that state, and a screen full of enabled-looking toggles that
// produce silence is worse than no screen. The permission itself is asked for
// behind an explanation in Settings → Permissions, never from here.

interface Field {
  key: keyof NotificationPrefs;
  Icon: IconComponent;
  label: string;
  hint: string;
}

const CONVERSATION_FIELDS: Field[] = [
  {
    key: 'notify_messages',
    Icon: IconMail,
    label: 'Direct messages',
    hint: 'When someone you are connected to sends you a message',
  },
  {
    key: 'notify_club_messages',
    Icon: IconPeople,
    label: 'Club chat',
    hint: 'New messages in clubs you have joined',
  },
];

const ACTIVITY_FIELDS: Field[] = [
  {
    key: 'notify_club_events',
    Icon: IconCalendar,
    label: 'Meetups',
    hint: 'Meetups proposed, confirmed or declined in your clubs',
  },
  {
    key: 'notify_social',
    Icon: IconHi,
    label: 'Requests & connections',
    hint: 'Hi requests, friend requests, and when someone accepts yours',
  },
  {
    key: 'notify_story_activity',
    Icon: IconHeart,
    label: 'Story reactions & replies',
    hint: 'When someone reacts or replies to a story you posted',
  },
  {
    key: 'music_zone_alerts',
    Icon: IconMusic,
    label: 'Music zones',
    hint: 'When a friend steps into earshot of your track, or you into theirs',
  },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function ToggleRow({
  icon: Icon,
  label,
  hint,
  value,
  onValueChange,
  disabled,
  last = false,
}: {
  icon: IconComponent;
  label: string;
  hint: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Icon size={20} color={colors.t2} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        // The label alone reads as "Direct messages, switch, on" without
        // saying what the switch governs. See the a11y pass in app/permissions.
        accessibilityLabel={label}
        accessibilityHint={hint}
        trackColor={{ false: colors.surface2, true: colors.teal }}
        thumbColor={colors.t1}
        ios_backgroundColor={colors.surface2}
      />
    </View>
  );
}

export default function NotificationSettingsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { top, bottom } = useSafeAreaInsets();
  const prefs = useNotificationPrefs();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemAllowed, setSystemAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    refreshNotificationPrefs().catch(() =>
      setError('Could not load your notification settings. Go back and try again.'),
    );
  }, []);

  // Re-checked on focus, not once on mount: the banner offers a trip to system
  // settings, and coming back with the permission granted has to clear it.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      Notifications.getPermissionsAsync()
        .then((p) => { if (active) setSystemAllowed(p.granted); })
        .catch(() => { if (active) setSystemAllowed(null); });
      return () => { active = false; };
    }, []),
  );

  async function save(patch: Partial<NotificationPrefs>) {
    setSaving(true);
    setError(null);
    try {
      await updateNotificationPrefs(patch);
    } catch {
      setError('That change didn’t save. Your previous setting is still in effect.');
    }
    // Reached on both paths — the `catch` records the message and stops there.
    // Not a `finally`: React Compiler bails on any component containing one.
    setSaving(false);
  }

  if (!prefs) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: top }]}>
        {error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <ActivityIndicator color={colors.teal} size="large" />
        )}
      </View>
    );
  }

  const rows = (fields: Field[]) =>
    fields.map((field, i) => (
      <ToggleRow
        key={field.key}
        icon={field.Icon}
        label={field.label}
        hint={field.hint}
        value={prefs[field.key]}
        onValueChange={(v) => save({ [field.key]: v } as Partial<NotificationPrefs>)}
        disabled={saving}
        last={i === fields.length - 1}
      />
    ));

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => pressed && styles.pressed}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
        >
          <IconBack size={22} color={colors.t1} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>Choose what is worth interrupting you</Text>
        </View>
        {saving && <ActivityIndicator color={colors.teal} size="small" />}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {error && <Text style={styles.errorBanner}>{error}</Text>}

        {systemAllowed === false && (
          <Pressable
            style={styles.banner}
            onPress={() => Linking.openSettings()}
            accessibilityRole="button"
            accessibilityLabel="Open system settings to turn on notifications for Aura"
          >
            <IconBell size={18} color={colors.orange} />
            <Text style={styles.bannerText}>
              Notifications are turned off for Aura on this device, so nothing below can
              reach you. Tap to open system settings.
            </Text>
          </Pressable>
        )}

        <View style={styles.section}>
          <SectionLabel>CONVERSATIONS</SectionLabel>
          <Card style={styles.rowsCard}>{rows(CONVERSATION_FIELDS)}</Card>
        </View>

        <View style={styles.section}>
          <SectionLabel>ACTIVITY</SectionLabel>
          <Card style={styles.rowsCard}>{rows(ACTIVITY_FIELDS)}</Card>
          <Text style={styles.note}>
            Turning a category off stops the notification, not the thing itself —
            messages still arrive in Chat, and meetups still appear in your alerts.
          </Text>
        </View>

        {Platform.OS === 'android' && (
          <Text style={styles.note}>
            Each category also has its own sound and importance in your device’s
            notification settings, if you would rather turn one down than off.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },
  pressed: { opacity: 0.6 },

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
    fontSize: 22,
    color: colors.t1,
  },
  subtitle: { fontFamily: fonts.body, fontSize: 12, color: colors.t3 },

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
  note: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.t3,
    marginTop: 10,
  },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    marginBottom: 20,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.orange,
  },
  bannerText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.t2,
  },

  rowsCard: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fonts.body, fontSize: 15, color: colors.t1 },
  rowHint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.t3 },

  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.t2,
    textAlign: 'center',
  },
  errorBanner: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.orange,
    marginBottom: 16,
  },
});
