import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DirectionsSheet } from '@/components/DirectionsSheet';
import { PinNoteEditor } from '@/components/PinNoteEditor';
import { Card } from '@/components/ui/Card';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { IconBack, IconBookmark, IconCalendar, IconPencil, IconPin } from '@/components/ui/icons';
import { fonts, radius, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { useScreenTopInset } from '@/hooks/useScreenTopInset';
import {
  setPinnedNote, unpinPlace, usePinnedPlaces, type PinnedPlace,
} from '@/services/pinnedPlaces';

/**
 * The places this account pinned, as a list.
 *
 * The map draws the same pins, and for anything within a few blocks the map is
 * the better answer. This screen exists for the other case, which is most of
 * them: a meetup two cities away, or a place off a Swift that is nowhere near
 * where the camera opens. A marker you cannot find is not a saved place.
 *
 * ## Two things it deliberately does not do
 *
 * **It does not carry a coordinate into navigation.** Tapping a row opens the
 * phone's maps app — an explicit hand-off — rather than pushing the map with a
 * position in the route. Route params are serialized into navigation state,
 * which outlives the screen; see `SwiftLocation` in services/swifts for why a
 * revealed position in particular must never end up there.
 *
 * **It does not sync.** These live on this phone and go with the account at
 * sign-out. Nothing here is visible to the creator of a Swift or to a club —
 * the notes least of all, which is why each row says so where it is written
 * rather than once at the top where it would be read and forgotten.
 */
export default function PinnedPlacesScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();
  const top = useScreenTopInset();
  const places = usePinnedPlaces();

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <ScreenHeader title="Pinned places" subtitle="Saved on this phone">
        <View style={styles.header}>
          <Pressable
            style={({ pressed }) => [pressed && styles.pressed]}
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <IconBack size={22} color={colors.t1} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Pinned places</Text>
            <Text style={styles.subtitle}>Saved on this phone</Text>
          </View>
        </View>
      </ScreenHeader>

      <FlatList
        data={places}
        keyExtractor={(item) => item.id}
        windowSize={5}
        initialNumToRender={10}
        contentContainerStyle={[styles.list, { paddingBottom: bottom + 32 }]}
        renderItem={({ item }) => (
          <PinnedRow place={item} colors={colors} styles={styles} />
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <IconBookmark size={28} color={colors.t3} />
            <Text style={styles.emptyTitle}>Nothing pinned yet</Text>
            <Text style={styles.emptyMessage}>
              Reveal where a Swift was made and tap “Pin to my map”, or say
              you’re going to a club meetup. Both land here and on your map,
              and you can add a private note to either.
            </Text>
          </View>
        }
      />
    </View>
  );
}

function PinnedRow({ place, colors, styles }: {
  place: PinnedPlace;
  colors: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
}) {
  const meetup = place.kind === 'meetup';
  const tint = meetup ? colors.purple : colors.teal;
  const [noteOpen, setNoteOpen] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);

  // The second line: what it is, then when. A meetup without its time is just
  // a name, and the time is the whole reason it was pinned.
  const meta = [
    place.subtitle,
    place.event_datetime ? fmtWhen(place.event_datetime) : null,
    place.place_name && place.place_name !== place.title ? place.place_name : null,
  ].filter(Boolean).join(' · ');

  return (
    <Card style={styles.card}>
      <View style={styles.cardRow}>
        <View style={[styles.glyph, { borderColor: tint }]}>
          {meetup
            ? <IconCalendar size={18} color={tint} />
            : <IconBookmark size={18} color={tint} filled />}
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardName} numberOfLines={2}>{place.title}</Text>
          {meta ? <Text style={styles.cardSub} numberOfLines={2}>{meta}</Text> : null}
          {place.precision === 'approximate' ? (
            <Text style={styles.cardNote}>Approximate area, not an exact spot</Text>
          ) : null}
        </View>
      </View>

      {/* The note, or the offer of one. A row rather than a third button:
          writing about a place is the part of this card with something to
          read, and it should look like text you can touch. */}
      <Pressable
        style={({ pressed }) => [
          styles.noteRow,
          !place.note && styles.noteRowEmpty,
          pressed && styles.pressed,
        ]}
        onPress={() => setNoteOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={
          place.note
            ? `Your note: ${place.note}. Tap to edit or remove it.`
            : `Add a note about ${place.title}`
        }
      >
        <IconPencil size={14} color={place.note ? colors.t3 : colors.teal} />
        <Text
          style={[styles.noteText, !place.note && styles.noteAddText]}
          numberOfLines={4}
        >
          {place.note || 'Add a note'}
        </Text>
      </Pressable>

      <View style={styles.cardActions}>
        <Pressable
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          onPress={() => setDirectionsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Directions to ${place.title}. Travel times by car, on foot, by bike and on transit.`}
        >
          <IconPin size={15} color={colors.t1} />
          <Text style={styles.actionLabel}>Directions</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          onPress={() => { void unpinPlace(place.id); }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${place.title} from your map`}
        >
          <Text style={[styles.actionLabel, styles.actionRemove]}>Remove</Text>
        </Pressable>
      </View>

      <DirectionsSheet
        visible={directionsOpen}
        target={{
          latitude: place.latitude,
          longitude: place.longitude,
          title: place.title,
          placeName: place.place_name,
          approximate: place.precision === 'approximate',
        }}
        onClose={() => setDirectionsOpen(false)}
      />

      <PinNoteEditor
        visible={noteOpen}
        placeTitle={place.title}
        note={place.note}
        onClose={() => setNoteOpen(false)}
        onSave={(text) => { void setPinnedNote(place.id, text); }}
      />
    </Card>
  );
}

/** Date and time, or the raw string if the device cannot parse it — a pin is
 *  worth showing with a bad date more than it is worth hiding. */
function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.6 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingBottom: 14 },
  headerText: { flex: 1 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: typography.title,
    color: colors.t1,
  },
  subtitle: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3, marginTop: 2 },

  list: { paddingHorizontal: 20, paddingTop: 6, gap: 10 },
  card: { padding: 14, gap: 12 },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  glyph: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 3 },
  cardName: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  cardSub: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t2, lineHeight: 17 },
  cardNote: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3 },

  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 11,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  /** Nothing written yet: an invitation, in the app's "you can act here"
   *  accent and dashed so it does not read as an empty quote. */
  noteRowEmpty: {
    borderStyle: 'dashed',
    borderColor: colors.tealLine,
    backgroundColor: 'transparent',
  },
  noteText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.t1,
  },
  noteAddText: { color: colors.teal, fontWeight: '600' },

  cardActions: { flexDirection: 'row', gap: 10 },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  actionLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.t1,
  },
  actionRemove: { color: colors.red },

  emptyWrap: { alignItems: 'center', gap: 10, paddingHorizontal: 28, paddingTop: 80 },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  emptyMessage: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    lineHeight: 20,
    color: colors.t3,
    textAlign: 'center',
  },
});
