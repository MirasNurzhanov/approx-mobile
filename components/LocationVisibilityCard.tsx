import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconEye, IconGhost, IconPin } from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import type { PrivacySettings } from '@/services/privacy';
import { openAppSettings, refreshPermissions, usePermissionStore } from '@/services/permissions';

// The one place the app states, in words, whether other people can see you.
//
// One axis now, where there were two. It used to carry a check in / check out
// button *and* a Live / Approximate picker, because precision was a setting;
// precision follows the relationship now — friends see the precise point,
// everybody else a ~500m cell, decided per viewer on the server — so there is
// nothing left to pick and the card is a single switch with a status line
// above it.
//
// Being on a map is a state rather than a preference, which is why the status
// line is the loudest thing here and the control sits under it. The three
// states it can report are genuinely different answers to "why can nobody see
// me", and only one of them has a fix inside this app:
//
//   Visible        sharing, and on the map as soon as a position lands
//   Ghost Mode     you turned yourself off — mutual, and the switch undoes it
//   Location off   the OS permission is denied, and Settings is the only route
//
// That last one takes over the card rather than sitting beside the switch. A
// toggle that cannot work is worse than no toggle: leaving Ghost Mode cannot
// publish a position the OS will not hand over, so the card says what is
// actually wrong and offers the one button that helps.

interface Props {
  settings: PrivacySettings;
  saving: boolean;
  /** Ghost Mode on or off. Both directions are immediate and unconfirmed —
   *  a dialog between somebody and hiding would be the wrong way round, and
   *  the disclosure they have already read is what covers the other way. */
  onGhostChange: (ghost: boolean) => void;
}

export function LocationVisibilityCard({ settings, saving, onGhostChange }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const ghost = settings.ghost_mode;

  // Read rather than ask: this card must never trigger a permission dialog by
  // rendering. `bindForegroundRefresh` keeps the store current after a trip to
  // Settings, and the mount refresh covers the first paint.
  const location = usePermissionStore().location;
  useEffect(() => { refreshPermissions(['location']).catch(() => {}); }, []);
  // `undefined` is "not read yet", which is not the same as off — an unknown
  // permission renders the ordinary card rather than accusing the user of
  // having denied something.
  const locationOff = location
    ? location.state === 'denied'
      || location.state === 'blocked'
      || location.state === 'restricted'
    : false;

  if (locationOff) {
    return (
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: colors.orange }]} />
          <View style={styles.statusText}>
            <Text style={styles.statusLabel}>Status</Text>
            <Text
              style={[styles.statusValue, { color: colors.orange }]}
              accessibilityLiveRegion="polite"
            >
              Location off
            </Text>
          </View>
          <IconPin size={22} color={colors.orange} />
        </View>

        <Text style={styles.explainer}>
          Nobody can see you, and the map has nothing to show you, because Approx
          has no access to your location. Turn it on in Settings — either “While
          Using the App” or “Always” — and you will be back on the map.
        </Text>

        <Pressable
          onPress={openAppSettings}
          accessibilityRole="button"
          accessibilityLabel="Open system settings"
          accessibilityHint="Opens the system settings app so you can turn location access on"
          style={({ pressed }) => [styles.action, styles.actionPrimary, pressed && { opacity: 0.85 }]}
        >
          <Text style={[styles.actionText, styles.actionTextPrimary]}>Open Settings</Text>
        </Pressable>

        <Text style={styles.footnote}>
          Ghost Mode is separate, and still {ghost ? 'on' : 'off'}. Turning
          location back on will {ghost ? 'not' : ''} put you back on the map
          {ghost ? ' until you leave Ghost Mode too.' : '.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {/* ── Status ── */}
      <View style={styles.statusRow}>
        <View
          style={[styles.dot, { backgroundColor: ghost ? colors.t3 : colors.green }]}
        />
        <View style={styles.statusText}>
          <Text style={styles.statusLabel}>Status</Text>
          <Text
            style={[styles.statusValue, { color: ghost ? colors.t1 : colors.green }]}
            accessibilityLiveRegion="polite"
          >
            {ghost ? 'Ghost Mode' : 'Visible'}
          </Text>
        </View>
        {ghost ? (
          <IconGhost size={22} color={colors.t3} />
        ) : (
          <IconEye size={22} color={colors.green} />
        )}
      </View>

      <Text style={styles.explainer}>
        {ghost
          ? 'Nobody can see you on the map, and you cannot see anyone either — Ghost Mode works both ways. Everything else keeps working: your clubs, your messages, and the places you can join.'
          : 'People nearby can see you on the map. Friends see exactly where you are; everyone else sees a rough area of about 500m, and you do not have to choose between them.'}
      </Text>

      {/* ── The one action ── */}
      <Pressable
        disabled={saving}
        onPress={() => onGhostChange(!ghost)}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving }}
        accessibilityLabel={
          ghost
            ? 'Turn off Ghost Mode and go back on the map'
            : 'Turn on Ghost Mode and hide from everyone'
        }
        style={({ pressed }) => [
          styles.action,
          ghost ? styles.actionPrimary : styles.actionSecondary,
          pressed && { opacity: 0.85 },
          saving && { opacity: 0.5 },
        ]}
      >
        {saving ? (
          <ActivityIndicator size="small" color={ghost ? colors.bg : colors.t1} />
        ) : (
          <Text
            style={[
              styles.actionText,
              ghost ? styles.actionTextPrimary : styles.actionTextSecondary,
            ]}
          >
            {ghost ? 'Turn Off Ghost Mode' : 'Turn On Ghost Mode'}
          </Text>
        )}
      </Pressable>

      <Text style={styles.footnote}>
        {ghost
          ? 'Nothing turns this off on its own — not opening Approx, not granting a permission.'
          : 'This lasts until you turn on Ghost Mode. Closing Approx does not change it, and if you allowed location while closed, your place on the map stays current.'}
      </Text>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14,
  },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { flex: 1, gap: 1 },
  statusLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
  },
  statusValue: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '600',
  },

  explainer: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.t2,
  },

  action: {
    minHeight: 52,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: { backgroundColor: colors.teal },
  actionSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: { fontFamily: fonts.body, fontWeight: '700', fontSize: 15 },
  actionTextPrimary: { color: colors.bg },
  actionTextSecondary: { color: colors.t1 },

  footnote: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.t3,
  },
});
