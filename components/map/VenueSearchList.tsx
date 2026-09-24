import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { venueAppearance } from '@/services/venueAppearance';
import { searchVenues } from '@/services/venueSearch';
import type { Venue } from '@/services/venues';

/**
 * Venue results, shared by the meetup place picker and the Places tab of search.
 *
 * Only the list: each screen owns its own text field, because one is a pill in
 * a map header and the other is the search screen's bar (or iOS 26's native
 * one). Rows wear the same disc as the venue's marker so a result and its pin
 * are recognisably the same thing.
 */
export function VenueSearchList({ venues, query, loading, error, onRetry, onSelect }: {
  venues: Venue[];
  query: string;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onSelect: (venue: Venue) => void;
}) {
  const { colors } = useTheme();
  const results = searchVenues(venues, query);

  if (loading && venues.length === 0) {
    return <View style={styles.center}><ActivityIndicator color={colors.teal} accessibilityLabel="Loading places" /></View>;
  }
  if (error && venues.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={[styles.empty, { color: colors.t2 }]}>Places could not be loaded.</Text>
        {onRetry && (
          <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.retry, { color: colors.teal }]}>Try again</Text>
          </Pressable>
        )}
      </View>
    );
  }
  if (results.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={[styles.empty, { color: colors.t2 }]}>
          {query.trim() ? `No places match "${query.trim()}"` : 'No places yet'}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={results}
      keyExtractor={venue => String(venue.id)}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        const appearance = venueAppearance(item);
        return (
          <Pressable
            onPress={() => onSelect(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.category}, ${item.address}`}
            style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && { opacity: 0.6 }]}
          >
            <View style={[styles.disc, { backgroundColor: appearance.color }]}>
              <Ionicons name={appearance.icon} size={16} color="#FFFFFF" />
            </View>
            <View style={styles.info}>
              <Text style={[styles.name, { color: colors.t1 }]} numberOfLines={1}>{item.name}</Text>
              <Text style={[styles.meta, { color: colors.t2 }]} numberOfLines={1}>
                {item.category} · {item.address}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.t3} />
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  empty: { fontFamily: fonts.body, fontSize: 14, textAlign: 'center' },
  retry: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  disc: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600' },
  meta: { fontFamily: fonts.body, fontSize: 12 },
});
