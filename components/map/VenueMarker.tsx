import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '@/constants/theme';
import type { Venue } from '@/services/venues';
import { isDrawable, type GeoPoint } from '@/services/markerLayout';

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

export function VenueMarker({ venue, parkedAt, onOpen }: {
  venue: Venue | null; parkedAt: GeoPoint; onOpen: (venue: Venue) => void;
}) {
  const key = venue ? `${venue.id}|${venue.name}` : 'parked';
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(key), 800);
    return () => clearTimeout(timer);
  }, [key]);
  return (
    <Marker coordinate={venue ? { latitude: venue.latitude, longitude: venue.longitude } : parkedAt} anchor={{ x: 0.5, y: 1 }} zIndex={3}
      opacity={venue ? 1 : 0} tappable={!!venue}
      tracksViewChanges={settledKey !== key} onPress={() => { if (venue) onOpen(venue); }}
      accessibilityLabel={venue ? `${venue.name}, ${venue.category}. View venue` : undefined}>
      {venue ? <View collapsable={false} style={styles.wrap}>
        <View style={styles.pin}>
          <Ionicons name="storefront-outline" size={20} color="#FFFFFF" />
          <Text style={styles.name} numberOfLines={1}>{venue.name}</Text>
        </View>
        <View style={styles.tip} />
      </View> : <View style={{ width: 1, height: 1 }} />}
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', padding: 3 },
  pin: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#6044B5',
    borderColor: '#FFFFFF', borderWidth: 2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 },
  name: { fontFamily: fonts.display, fontSize: 13, color: '#FFFFFF', maxWidth: 160 },
  tip: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 7,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#6044B5' },
});
