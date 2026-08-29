import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useScreenTopInset } from '@/hooks/useScreenTopInset';
import { syncBackgroundLocation } from '@/services/backgroundLocation';
import { Card } from '@/components/ui/Card';
import { BackgroundLocationRow } from '@/components/BackgroundLocationRow';
import { LocationSharingConsent } from '@/components/LocationSharingConsent';
import {
  LocationVisibilityCard,
  type SharingPrecision,
} from '@/components/LocationVisibilityCard';
import {
  IconBlocked,
  IconChevron,
  IconLock,
  IconPeople,
  type IconComponent,
} from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  AUDIENCES,
  AUDIENCE_LABEL,
  refreshPrivacy,
  updatePrivacy,
  usePrivacySettings,
  type Audience,
  type LocationSharing,
  type PrivacySettings,
} from '@/services/privacy';

// Settings → Privacy & safety. Everything here is a mirror of server state:
// the API omits fields a viewer may not see, so these controls change what the
// server sends, not what this app chooses to draw.

// Location visibility is one card now — status, precision, and a single check
// in / check out button — and it lives in components/LocationVisibilityCard so
// this screen and the Settings tab cannot drift apart on the wording of
// something this consequential. The mode list and its explainer copy moved
// there with it.

const AUDIENCE_FIELDS: {
  key: keyof PrivacySettings;
  label: string;
  hint: string;
  /** Restricts the picker's choices. Omitted means all of AUDIENCES. */
  options?: Audience[];
}[] = [
  { key: 'visibility_presence',    label: 'Online status',  hint: 'Who can see when you’re active, and when you were last online' },
  // No "Everyone": a story is for the people you chose, whatever this says —
  // "Friends" is the widest audience the server will hand one to, and it does
  // not reach connections either. See users.visibility.can_view.
  { key: 'visibility_stories',     label: 'Stories',        hint: 'Your friends only — never strangers or connections', options: ['friends', 'nobody'] },
  { key: 'visibility_interests',   label: 'Interests',      hint: 'Hiding these makes you harder to match with' },
  { key: 'visibility_stats',       label: 'Stats',          hint: 'Your connection and friend counts' },
  // No "Everyone": a music zone is never for strangers, whatever this says —
  // "Friends" here always reaches connections too. See app/zone.tsx.
  { key: 'visibility_zone_audio',  label: 'Zone audio',     hint: 'Your connections and friends only — strangers never see or hear it', options: ['friends', 'nobody'] },
  { key: 'visibility_connections', label: 'Connections',    hint: 'Who can see who you’re connected to' },
  { key: 'visibility_links',       label: 'Links',          hint: 'Instagram, Spotify and other links on your profile' },
];

// ─── Pieces ───────────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function AudiencePicker({
  value,
  onChange,
  disabled,
  options = AUDIENCES,
}: {
  value: Audience;
  onChange: (next: Audience) => void;
  disabled?: boolean;
  options?: Audience[];
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.segment}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            disabled={disabled}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.segmentItem,
              selected && styles.segmentItemSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {AUDIENCE_LABEL[option]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
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
  icon?: IconComponent;
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      {Icon && <Icon size={20} color={colors.t2} />}
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.surface2, true: colors.teal }}
        thumbColor={colors.t1}
        ios_backgroundColor={colors.surface2}
      />
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function PrivacyScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();
  const top = useScreenTopInset();
  const { settings } = usePrivacySettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refreshPrivacy().catch(() =>
      setError('Could not load your privacy settings. Pull back and try again.'),
    );
  }, []);

  // The precision somebody has asked to check in as but not yet agreed to.
  // Checking *in* publishes your position, so it goes through the consent sheet
  // first; checking out and changing precision while already visible both apply
  // at once — see LocationVisibilityCard for why the asymmetry is deliberate.
  const [pendingMode, setPendingMode] = useState<SharingPrecision | null>(null);

  async function confirmMode(mode: LocationSharing) {
    await save({ location_sharing: mode });
    setPendingMode(null);
  }

  async function save(patch: Partial<PrivacySettings>) {
    setSaving(true);
    setError(null);
    try {
      await updatePrivacy(patch);
      if (patch.location_sharing) {
        // Pausing must stop OS tracking now, not at the next app launch.
        await syncBackgroundLocation();
      }
    } catch {
      setError('That change didn’t save. Your previous setting is still in effect.');
    }
    // Reached on both paths: the `catch` records the message and stops there.
    // Not a `finally` — React Compiler bails on any component containing one.
    setSaving(false);
  }

  function togglePrivate(next: boolean) {
    if (!next) {
      save({ is_private: false });
      return;
    }
    Alert.alert(
      'Make account private?',
      'People you haven’t approved will only see your username and photo. Everyone you’re already connected to keeps full access — you can review them below.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Make private', onPress: () => save({ is_private: true }) },
      ],
    );
  }

  if (!settings) {
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

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <ScreenHeader
        title="Privacy & safety"
        subtitle="Control who sees what"
        accessory={saving ? <ActivityIndicator color={colors.teal} size="small" /> : null}
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {error && <Text style={styles.errorBanner}>{error}</Text>}

        {/* ── Private account ── */}
        <View style={styles.section}>
          <SectionLabel>ACCOUNT</SectionLabel>
          <Card style={styles.rowsCard}>
            <ToggleRow
              icon={IconLock}
              label="Private account"
              hint="Non-approved people see only your username and photo"
              value={settings.is_private}
              onValueChange={togglePrivate}
              disabled={saving}
            />
            <Pressable
              onPress={() => router.push('/connections')}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View style={[styles.row, styles.rowBorder]}>
                <IconPeople size={20} color={colors.t2} />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Review connections</Text>
                  <Text style={styles.rowHint}>
                    People already connected keep access — remove anyone here
                  </Text>
                </View>
                <IconChevron size={16} color={colors.t3} />
              </View>
            </Pressable>
            <Pressable
              onPress={() => router.push('/blocked-users')}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View style={styles.row}>
                <IconBlocked size={20} color={colors.t2} />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Blocked users</Text>
                </View>
                <IconChevron size={16} color={colors.t3} />
              </View>
            </Pressable>
          </Card>
          {settings.is_private && (
            <Text style={styles.note}>
              Requests to connect land in your Hi requests, where you can accept or decline them.
            </Text>
          )}
        </View>

        {/* ── Location ── */}
        <View style={styles.section}>
          <SectionLabel>LOCATION VISIBILITY</SectionLabel>
          <LocationVisibilityCard
            settings={settings}
            saving={saving}
            onCheckIn={setPendingMode}
            onCheckOut={() => save({ location_sharing: 'paused' })}
            onPrecision={(mode) => save({ location_sharing: mode })}
          />
          {/* The only place in the app that asks for Always. Explicit, opt-in,
              and attached to the feature that needs it — see the header note in
              components/BackgroundLocationRow for why it is not on the map. */}
          <BackgroundLocationRow
            sharing={settings.location_sharing !== 'paused'}
          />
          <LocationSharingConsent
            mode={pendingMode}
            busy={saving}
            onCancel={() => setPendingMode(null)}
            onConfirm={confirmMode}
          />
        </View>

        {/* ── Per-field visibility ── */}
        <View style={styles.section}>
          <SectionLabel>WHO CAN SEE</SectionLabel>
          <Card style={styles.fieldsCard}>
            {AUDIENCE_FIELDS.map((field, index) => (
              <View
                key={field.key}
                style={[
                  styles.fieldBlock,
                  index < AUDIENCE_FIELDS.length - 1 && styles.rowBorder,
                ]}
              >
                <Text style={styles.rowLabel}>{field.label}</Text>
                <Text style={styles.rowHint}>{field.hint}</Text>
                <AudiencePicker
                  value={settings[field.key] as Audience}
                  onChange={(next) => save({ [field.key]: next } as Partial<PrivacySettings>)}
                  disabled={saving}
                  options={field.options}
                />
              </View>
            ))}
          </Card>
        </View>

        {/* ── Discoverability ── */}
        <View style={styles.section}>
          <SectionLabel>DISCOVERABILITY</SectionLabel>
          <Card style={styles.rowsCard}>
            <ToggleRow
              label="Findable by username"
              hint="Let people search for your exact @username"
              value={settings.discoverable_by_username}
              onValueChange={(v) => save({ discoverable_by_username: v })}
              disabled={saving}
            />
            <ToggleRow
              label="Findable by interest"
              hint="Also keeps you off strangers’ maps, which match on shared interests"
              value={settings.discoverable_by_interest}
              onValueChange={(v) => save({ discoverable_by_interest: v })}
              disabled={saving}
              last
            />
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
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

  rowsCard: { padding: 0, overflow: 'hidden' },
  fieldsCard: { padding: 0, overflow: 'hidden' },
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

  fieldBlock: { paddingHorizontal: 16, paddingVertical: 14, gap: 4 },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface2,
    borderRadius: radius.m,
    padding: 3,
    marginTop: 10,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: radius.s,
  },
  segmentItemSelected: { backgroundColor: colors.tealTint },
  segmentText: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: colors.t2,
  },
  segmentTextSelected: { color: colors.teal, fontWeight: '600' },

  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.t2, textAlign: 'center', paddingHorizontal: 40 },
  errorBanner: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.red,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 20,
  },

  pressed: { opacity: 0.6 },
});
