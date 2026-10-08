import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { CAPTION_GAP, CAPTION_H, isDrawable, type GeoPoint } from '@/services/markerLayout';
import { makeStyles } from '@/components/map/mapStyles';
import { useTheme } from '@/context/ThemeContext';
import type { Venue } from '@/services/venues';
import { venueAppearance } from '@/services/venueAppearance';

/** Keep native marker slots mounted, matching the map's Fabric parking strategy. */
export function VenueLayer({ venues, parkedAt, onOpen }: {
  venues: Venue[]; parkedAt: GeoPoint; onOpen: (venue: Venue) => void;
}) {
  const drawable = venues.filter(isDrawable);
  const [slotCount, setSlotCount] = useState(0);
  if (drawable.length > slotCount) setSlotCount(drawable.length);
  return <>{Array.from({ length: slotCount }, (_, slot) => (
    <VenueMarker key={`venue-slot-${slot}`} venue={drawable[slot] ?? null} parkedAt={parkedAt} onOpen={onOpen} />
  ))}</>;
}

/** The coloured disc, and the point under it that marks the spot. */
const DOT = 30;
const TAIL = 6;

/**
 * One venue: a small disc with its category glyph, and its name in the same
 * caption plate every other marker on this map uses.
 *
 * It used to be a filled, name-inside pill — roughly 200pt wide and in the
 * venue's own colour, which made a handful of venues the loudest thing on
 * screen and hid the streets between them. The colour now lives in a 30pt disc
 * the size of a person's dot, and the name in a translucent plate that is at
 * most 108pt wide: the same amount of information, a fraction of the map.
 */
export function VenueMarker({ venue, parkedAt, onOpen }: {
  venue: Venue | null; parkedAt: GeoPoint; onOpen: (venue: Venue) => void;
}) {
  const { colors } = useTheme();
  const shared = useMemo(() => makeStyles(colors), [colors]);
  const appearance = venueAppearance(venue);
  const key = venue ? `${venue.id}|${venue.name}|${appearance.color}|${appearance.icon}` : 'parked';
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(key), 800);
    return () => clearTimeout(timer);
  }, [key]);

  // The disc's point marks the venue, not the middle of the box the caption
  // makes — so the anchor sits where the tail ends rather than at the centre.
  // Same reasoning as the avatar and dot markers next door.
  const totalH = DOT + TAIL + CAPTION_GAP + CAPTION_H;

  return (
    <Marker coordinate={venue ? { latitude: venue.latitude, longitude: venue.longitude } : parkedAt}
      anchor={{ x: 0.5, y: (DOT + TAIL) / totalH }} zIndex={3}
      opacity={venue ? 1 : 0} tappable={!!venue}
      tracksViewChanges={settledKey !== key} onPress={() => { if (venue) onOpen(venue); }}
      accessibilityLabel={venue ? `${venue.name}, ${venue.category}. View venue` : undefined}>
      {venue ? <View collapsable={false} style={styles.wrap}>
        <View style={[styles.dot, { backgroundColor: appearance.color, borderColor: colors.bg }]}>
          <Ionicons name={appearance.icon} size={15} color="#FFFFFF" />
        </View>
        <View style={[styles.tail, { borderTopColor: appearance.color }]} />
        <View style={shared.markerCaption}>
          <Text style={shared.markerCaptionText} numberOfLines={1}>{venue.name}</Text>
        </View>
      </View> : <View style={{ width: 1, height: 1 }} />}
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // The ring is the map's background colour, as on every other marker: it
    // separates the disc from whatever it sits on without adding a second
    // colour to the map.
    borderWidth: 2,
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: TAIL,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
