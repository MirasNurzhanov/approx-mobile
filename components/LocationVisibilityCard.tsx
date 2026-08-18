import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconEye, IconEyeOff, IconGhost, type IconComponent } from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import type { LocationSharing, PrivacySettings } from '@/services/privacy';

// The one place the app states, in words, whether other people can see you.
//
// It replaces three equally-weighted mode cards (Live / Approximate / Paused).
// Those cards were the whole control, and they worked, but they made the answer
// to "am I visible right now" something you had to infer from which of three
// tiles was lit. Being on a map is not a preference to be read off a segmented
// control; it is a state, and a state gets a status line.
//
// Two axes, deliberately separated, because they are two different questions:
//
//   visible or not   the check in / check out button. One action, one field.
//   how precisely    Live or Approximate, which only means anything once you
//                    are checked in.
//
// Paused is no longer a third option competing with the other two — it *is*
// checked out, and the button is the only way to get there. Two controls that
// both write `location_sharing` would put the screen in the position of having
// to explain which one wins.
//
// Nothing here restores visibility on its own. There is no auto check-in, no
// remembered "share my location" switch, and no timer: the server mints a
// session token when you check in, the client holds it in memory only, and a
// launch that cannot present one is checked out on the spot. See
// services/sharingSession.ts and users.models.User.sharing_session.

/** The two modes that mean "visible". `paused` is the absence of both. */
export type SharingPrecision = 'live' | 'approximate';

const PRECISION: { key: SharingPrecision; Icon: IconComponent; label: string; sub: string }[] = [
  { key: 'live',        Icon: IconEye,   label: 'Live',        sub: 'Exact position' },
  { key: 'approximate', Icon: IconGhost, label: 'Approximate', sub: 'Within ~500m' },
];

/** What each state means, written as the state the reader is in. */
const EXPLAINER: Record<LocationSharing, string> = {
  live: 'Nearby people can see where you actually are, and it keeps updating as you move — including while Aura is in the background.',
  approximate:
    'Nearby people see a rough area instead of a point. Your position is rounded to about 500m before it leaves your phone, and your exact location is never stored.',
  paused:
    'Nobody can see you on the map. The location we were holding for you is deleted, and we stop storing one. You can still browse and see people who are sharing — your position answers your own searches and is never saved or shown to anyone.',
};

interface Props {
  settings: PrivacySettings;
  saving: boolean;
  /** Checking in publishes a position, so the parent shows the consent sheet
   *  and only then writes the field. Never called while already visible. */
  onCheckIn: (mode: SharingPrecision) => void;
  /** Immediate, and deliberately unconfirmed — a dialog between somebody and
   *  hiding would be the wrong way round. */
  onCheckOut: () => void;
  /** Switching precision while already visible. Consent has been given. */
  onPrecision: (mode: SharingPrecision) => void;
}

export function LocationVisibilityCard({
  settings,
  saving,
  onCheckIn,
  onCheckOut,
  onPrecision,
}: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const mode = settings.location_sharing;
  const visible = mode !== 'paused';

  // Which precision a checked-out user will check in *as*. Held here rather
  // than derived, because there is nothing on the server to derive it from —
  // checking out clears the field to `paused`. Defaulting to Approximate is
  // the safer of the two to be wrong about, and picking it before checking in
  // is what keeps a privacy-minded user from having to go Live for a moment
  // first and downgrade afterwards.
  const [pending, setPending] = useState<SharingPrecision>('approximate');
  const selected: SharingPrecision = visible ? (mode as SharingPrecision) : pending;

  function choose(next: SharingPrecision) {
    if (saving) return;
    if (visible) {
      if (next !== mode) onPrecision(next);
      return;
    }
    setPending(next);
  }

  return (
    <View style={styles.card}>
      {/* ── Status ── */}
      <View style={styles.statusRow}>
        <View
          style={[styles.dot, { backgroundColor: visible ? colors.green : colors.t3 }]}
        />
        <View style={styles.statusText}>
          <Text style={styles.statusLabel}>Status</Text>
          <Text
            style={[styles.statusValue, { color: visible ? colors.green : colors.t1 }]}
            accessibilityLiveRegion="polite"
          >
            {visible ? 'Visible' : 'Hidden'}
            {visible && (
              <Text style={styles.statusQualifier}>
                {' · '}
                {mode === 'live' ? 'Live' : 'Approximate'}
              </Text>
            )}
          </Text>
        </View>
        {visible ? (
          <IconEye size={22} color={colors.green} />
        ) : (
          <IconEyeOff size={22} color={colors.t3} />
        )}
      </View>

      <Text style={styles.explainer}>{EXPLAINER[mode]}</Text>

      {/* ── Precision ── */}
      <Text style={styles.groupLabel}>
        {visible ? 'PRECISION' : 'CHECK IN AS'}
      </Text>
      <View style={styles.precisionRow}>
        {PRECISION.map((option) => {
          const on = option.key === selected;
          return (
            <Pressable
              key={option.key}
              disabled={saving}
              onPress={() => choose(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: saving }}
              accessibilityLabel={`${option.label}. ${option.sub}`}
              style={({ pressed }) => [
                styles.precisionCard,
                on && styles.precisionCardOn,
                pressed && styles.pressed,
              ]}
            >
              <option.Icon size={20} color={on ? colors.teal : colors.t3} />
              <Text style={[styles.precisionLabel, on && styles.precisionLabelOn]}>
                {option.label}
              </Text>
              <Text style={styles.precisionSub}>{option.sub}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── The one action ── */}
      <Pressable
        disabled={saving}
        onPress={() => (visible ? onCheckOut() : onCheckIn(selected))}
        accessibilityRole="button"
        accessibilityLabel={
          visible
            ? 'Check out and hide your location from everyone'
            : `Check in and share your ${selected === 'live' ? 'exact position' : 'rough area'} with nearby people`
        }
        style={({ pressed }) => [
          styles.action,
          visible ? styles.actionOut : styles.actionIn,
          pressed && { opacity: 0.85 },
          saving && { opacity: 0.5 },
        ]}
      >
        {saving ? (
          <ActivityIndicator size="small" color={visible ? colors.t1 : colors.bg} />
        ) : (
          <Text style={[styles.actionText, visible ? styles.actionTextOut : styles.actionTextIn]}>
            {visible ? 'Check Out' : 'Check In'}
          </Text>
        )}
      </Pressable>

      {/* The part a status line alone would leave out: this ends by itself, and
          it is the only thing on the screen that does. */}
      <Text style={styles.footnote}>
        {visible
          ? 'Checking in lasts for this visit. Closing Aura checks you out, and you choose again next time.'
          : 'Aura never checks you in on its own — not on launch, not when you grant location access.'}
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
  statusQualifier: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: '500',
    color: colors.t2,
  },

  explainer: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.t2,
  },

  groupLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
    marginBottom: -6,
  },

  precisionRow: { flexDirection: 'row', gap: 8 },
  precisionCard: {
    flex: 1,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: radius.m,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  precisionCardOn: { backgroundColor: colors.tealTint, borderColor: colors.tealLine },
  precisionLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.t1 },
  precisionLabelOn: { color: colors.teal },
  precisionSub: { fontFamily: fonts.body, fontSize: 10, color: colors.t3, textAlign: 'center' },

  action: {
    minHeight: 52,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIn: { backgroundColor: colors.teal },
  actionOut: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: { fontFamily: fonts.body, fontWeight: '700', fontSize: 15 },
  actionTextIn: { color: colors.bg },
  actionTextOut: { color: colors.t1 },

  footnote: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.t3,
  },

  pressed: { opacity: 0.6 },
});
