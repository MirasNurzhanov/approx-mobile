import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  LocationPickerSheet,
  type PickedLocation,
} from '@/components/swifts/compose/LocationPickerSheet';
import { IconGlobe, IconLock, IconPeople, IconPin } from '@/components/ui/icons';
import { GlassIconButton, GlassSurface } from '@/components/ui/GlassSurface';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { MAX_CAPTION, type SwiftDraft } from '@/services/swiftDraft';

/**
 * Caption, audience, and the location decision.
 *
 * ## Location is optional, and the UI has to make that obvious
 *
 * There is no switch here, and that is deliberate. A switch attaches a
 * position the instant it is flipped — the creator agrees to "a location"
 * without ever seeing *which* location, and the first time they find out is
 * when somebody reveals it. So instead: a button that opens a map, a pin they
 * place themselves, the coordinate and place name shown before they confirm,
 * and nothing written to the draft until they press *Use this location*.
 *
 * What the copy has to convey, without a paragraph of it, is what makes a
 * Swift's location different from the map's: **the map is session-scoped and
 * pauses itself, and a Swift is permanent.** Somebody who attaches a place to
 * three Swifts a week has published a durable movement history under their own
 * name, and no amount of pausing takes it back.
 *
 * The server is still the last word regardless of what is chosen here — it
 * runs the coordinate through the creator's own location-sharing mode, which
 * may snap it to a ~500m cell or drop it entirely.
 */

interface Props {
  draft: SwiftDraft;
  onChange: (patch: Partial<SwiftDraft>) => void;
}

const AUDIENCES = [
  { key: 'public' as const, label: 'Everyone', Glyph: IconGlobe, hint: 'Anyone on Aura can watch.' },
  { key: 'friends' as const, label: 'Friends', Glyph: IconPeople, hint: 'Only people you are friends with.' },
  { key: 'private' as const, label: 'Only me', Glyph: IconLock, hint: 'Saved to your profile, shown to nobody.' },
];

export function DetailsStep({ draft, onChange }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [picking, setPicking] = useState(false);

  const attached =
    draft.shareLocation && draft.latitude !== null && draft.longitude !== null;

  const picked: PickedLocation | null = attached
    ? {
        latitude: draft.latitude as number,
        longitude: draft.longitude as number,
        placeName: draft.placeName,
      }
    : null;

  function confirmLocation(next: PickedLocation) {
    onChange({
      shareLocation: true,
      latitude: next.latitude,
      longitude: next.longitude,
      placeName: next.placeName,
    });
    setPicking(false);
  }

  function removeLocation() {
    onChange({
      shareLocation: false, latitude: null, longitude: null, placeName: '',
    });
    setPicking(false);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
      {/* Caption */}
      <View style={styles.block}>
        <Text style={styles.blockLabel}>Caption</Text>
        <TextInput
          style={styles.caption}
          value={draft.caption}
          onChangeText={(t) => onChange({ caption: t.slice(0, MAX_CAPTION) })}
          placeholder="Say something about this Swift"
          placeholderTextColor={colors.t3}
          multiline
          maxLength={MAX_CAPTION}
          accessibilityLabel="Caption"
        />
        <Text style={styles.counter} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
          {draft.caption.length}/{MAX_CAPTION}
        </Text>
      </View>

      {/* Audience */}
      <View style={styles.block}>
        <Text style={styles.blockLabel}>Who can watch</Text>
        {AUDIENCES.map(({ key, label, Glyph, hint }) => {
          const active = draft.visibility === key;
          return (
            <GlassIconButton
              key={key}
              onPress={() => onChange({ visibility: key })}
              style={[styles.option, active && styles.optionActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}. ${hint}`}
            >
              <Glyph size={20} color={active ? colors.teal : colors.t3} />
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                  {label}
                </Text>
                <Text style={styles.optionHint}>{hint}</Text>
              </View>
            </GlassIconButton>
          );
        })}
      </View>

      {/* Location */}
      <View style={styles.block}>
        <View style={styles.blockHead}>
          <Text style={styles.blockLabel}>Location</Text>
          <Text style={styles.optionalTag}>Optional</Text>
        </View>

        {attached ? (
          <View style={styles.attached}>
            <IconPin size={20} color={colors.teal} />
            <View style={styles.optionText}>
              <Text style={styles.attachedPlace} numberOfLines={1}>
                {draft.placeName || 'Unnamed place'}
              </Text>
              <Text style={styles.attachedCoord}>
                {(draft.latitude as number).toFixed(5)},{' '}
                {(draft.longitude as number).toFixed(5)}
              </Text>
            </View>
            <Pressable
              onPress={() => setPicking(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Change location"
            >
              <Text style={styles.attachedAction}>Change</Text>
            </Pressable>
            <Pressable
              onPress={removeLocation}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Remove location"
            >
              <Text style={styles.attachedRemove}>Remove</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setPicking(true)}
            style={styles.addLocation}
            accessibilityRole="button"
            accessibilityLabel="Add location"
          >
            <IconPin size={18} color={colors.teal} />
            <Text style={styles.addLocationLabel}>Add location</Text>
          </Pressable>
        )}

        <Text style={styles.footnote}>
          {attached
            ? 'Nobody sees this in the feed. Viewers get a button, and you can see who pressed it.'
            : 'Your Swift publishes without a location unless you add one here.'}
        </Text>
        <Text style={styles.footnote}>
          A Swift stays up until you delete it, so a place attached here lasts
          too — unlike the map, which pauses when you close Aura.
        </Text>
      </View>

      {/* Interaction */}
      <View style={styles.block}>
        <Text style={styles.blockLabel}>Interaction</Text>
        <GlassSurface style={styles.switchRow}>
          <View style={styles.optionText}>
            <Text style={styles.optionLabel}>Allow comments</Text>
          </View>
          <Switch
            value={draft.allowComments}
            onValueChange={(v) => onChange({ allowComments: v })}
            trackColor={{ true: colors.teal, false: colors.border }}
            accessibilityLabel="Allow comments"
          />
        </GlassSurface>
        <GlassSurface style={styles.switchRow}>
          <View style={styles.optionText}>
            <Text style={styles.optionLabel}>Allow reposts</Text>
          </View>
          <Switch
            value={draft.allowReposts}
            onValueChange={(v) => onChange({ allowReposts: v })}
            trackColor={{ true: colors.teal, false: colors.border }}
            accessibilityLabel="Allow reposts"
          />
        </GlassSurface>
      </View>
      <LocationPickerSheet
        visible={picking}
        initial={picked}
        onCancel={() => setPicking(false)}
        onConfirm={confirmLocation}
        onRemove={removeLocation}
      />
    </ScrollView>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: 18, gap: 24, paddingBottom: 48 },

  block: { gap: 10 },
  blockLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.t3,
  },

  caption: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    padding: 14,
    fontFamily: fonts.body,
    fontSize: typography.body,
    lineHeight: 21,
    color: colors.t1,
    textAlignVertical: 'top',
  },
  counter: {
    alignSelf: 'flex-end',
    fontFamily: fonts.body,
    fontSize: typography.micro,
    color: colors.t3,
    fontVariant: ['tabular-nums'],
  },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionActive: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  optionText: { flex: 1, gap: 2 },
  optionLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  optionLabelActive: { color: colors.teal },
  optionHint: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.t3,
  },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionalTag: {
    fontFamily: fonts.body,
    fontSize: typography.micro,
    color: colors.t3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },

  addLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: radius.m,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.tealLine,
    backgroundColor: colors.tealTint,
  },
  addLocationLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.teal,
  },
  attached: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.tealLine,
    backgroundColor: colors.tealTint,
  },
  attachedPlace: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  attachedCoord: {
    fontFamily: fonts.body,
    fontSize: typography.micro,
    color: colors.t3,
    fontVariant: ['tabular-nums'],
  },
  attachedAction: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    color: colors.teal,
  },
  attachedRemove: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    color: colors.red,
  },
  footnote: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.t3,
  },
});
