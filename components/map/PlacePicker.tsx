import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { fonts, radius, type ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { useMapVenues } from '@/hooks/useMapVenues';
import { venueAppearance } from '@/services/venueAppearance';
import { dismissSnap, FREE_CURSOR, nextSnap, type SnapState } from '@/services/venueSnap';
import type { Venue } from '@/services/venues';
import { VenueLayer } from './VenueMarker';
import { VenueSearchList } from './VenueSearchList';

/** How close a search result or a tapped marker frames its venue. */
const VENUE_DELTA = 0.004;
const FLY_MS = 350;
/** The cursor's venue form: the map marker's disc, grown so it reads as held. */
const HELD_DOT = 44;
const HELD_TAIL = 8;

/**
 * Where a meetup happens: a fixed cursor over a moving map.
 *
 * Venues are drawn on the map as they are on the Map tab. Move one under the
 * cursor and the cursor becomes that venue — its disc, its name, and a button
 * to meet there. Cancel, or keep dragging, and it is a plain cursor again that
 * drops an ordinary pin. There is no separate "pick a venue" mode to find: the
 * map is the picker for both. The search field at the top finds a venue by
 * name and flies the cursor onto it.
 */
export function PlacePicker({ initialRegion, top, bottom, busy, onRegionChange, onBack, onConfirmPoint, onConfirmVenue }: {
  initialRegion: Region;
  top: number;
  bottom: number;
  /** Naming a dropped pin (reverse geocoding) is in flight. */
  busy: boolean;
  /** Settled regions, so the form can reopen the picker where it was left. */
  onRegionChange: (region: Region) => void;
  onBack: () => void;
  /** Confirm the cursor as a plain point. */
  onConfirmPoint: () => void;
  onConfirmVenue: (venue: Venue) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { venues, error: venueError, retry } = useMapVenues();
  const mapRef = useRef<MapView | null>(null);
  const regionRef = useRef<Region>(initialRegion);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [snap, setSnapState] = useState<SnapState>(FREE_CURSOR);
  // Mirrored for the region callbacks, which fire every frame and must see the
  // latest snap rather than the one their render closed over.
  const snapRef = useRef<SnapState>(FREE_CURSOR);
  function setSnap(next: SnapState) {
    if (next.snappedId === snapRef.current.snappedId && next.dismissedId === snapRef.current.dismissedId) return;
    snapRef.current = next;
    setSnapState(next);
  }
  /** Set while the camera is flying to a venue we already chose, so the frames
   *  in between — which pass far from it — do not let go of it. */
  const flyingTo = useRef<number | null>(null);
  // A camera already where it is sent may never report the move finished, so
  // the flight also ends on a timer rather than holding the snap forever.
  const flyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flyTimer.current) clearTimeout(flyTimer.current); }, []);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const held = snap.snappedId === null ? null : venues.find(v => v.id === snap.snappedId) ?? null;
  const appearance = venueAppearance(held);

  function reSnap(region: Region) {
    if (flyingTo.current !== null) return;
    setSnap(nextSnap(venues, region, size, snapRef.current));
  }

  // Venues arrive after the map, and the map's size after its first layout;
  // either can put a venue under a cursor that has not moved — e.g. reopening
  // the picker on the venue the form already has.
  useEffect(() => { reSnap(regionRef.current); }, [venues, size]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Hold `venue` and bring it under the cursor: at `delta` when given (a
   *  search result, which may be across town), otherwise at the current zoom. */
  function flyTo(venue: Venue, delta?: number) {
    flyingTo.current = venue.id;
    if (flyTimer.current) clearTimeout(flyTimer.current);
    flyTimer.current = setTimeout(() => { flyingTo.current = null; }, FLY_MS + 400);
    setSnap({ snappedId: venue.id, dismissedId: null });
    const center = { latitude: venue.latitude, longitude: venue.longitude };
    if (delta === undefined) mapRef.current?.animateCamera({ center }, { duration: FLY_MS });
    else mapRef.current?.animateToRegion({ ...center, latitudeDelta: delta, longitudeDelta: delta }, FLY_MS);
  }

  function onChange(region: Region) {
    regionRef.current = region;
    reSnap(region);
  }

  function onChangeComplete(region: Region) {
    regionRef.current = region;
    onRegionChange(region);
    if (flyingTo.current !== null) {
      flyingTo.current = null;
      return;
    }
    const next = nextSnap(venues, region, size, snapRef.current);
    setSnap(next);
    // Magnet: once the cursor holds a venue, settle the map exactly onto it so
    // the pin the proposal ends up with is the venue's, not a near miss.
    const venue = next.snappedId === null ? undefined : venues.find(v => v.id === next.snappedId);
    if (venue && (Math.abs(venue.latitude - region.latitude) > 1e-6 || Math.abs(venue.longitude - region.longitude) > 1e-6)) {
      flyTo(venue);
    }
  }

  function chooseResult(venue: Venue) {
    Keyboard.dismiss();
    setSearching(false);
    setQuery('');
    flyTo(venue, VENUE_DELTA);
  }

  function closeSearch() {
    Keyboard.dismiss();
    setSearching(false);
    setQuery('');
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: top + 6 }]}>
        <Pressable onPress={searching ? closeSearch : onBack} hitSlop={12} style={styles.backBtn}
          accessibilityRole="button" accessibilityLabel={searching ? 'Close search' : 'Back to the proposal'}>
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </Pressable>
        <View style={[styles.searchPill, searching && { borderColor: colors.teal }]}>
          <Ionicons name="search-outline" size={16} color={colors.t3} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearching(true)}
            placeholder="Search places"
            placeholderTextColor={colors.t3}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search places"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={colors.t3} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.mapWrap} onLayout={e => {
        const { width, height } = e.nativeEvent.layout;
        setSize(s => (s.width === width && s.height === height ? s : { width, height }));
      }}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          initialRegion={initialRegion}
          onRegionChange={onChange}
          onRegionChangeComplete={onChangeComplete}
        >
          <VenueLayer venues={venues} parkedAt={initialRegion} onOpen={venue => flyTo(venue)} />
        </MapView>

        {/* The cursor. Its point is the map's centre in both forms. */}
        <View pointerEvents="none" style={styles.cursorAnchor}>
          {held ? (
            <View style={styles.heldCursor} testID="place-picker-held-cursor">
              <View style={[styles.heldDot, { backgroundColor: appearance.color, borderColor: colors.bg }]}>
                <Ionicons name={appearance.icon} size={21} color="#FFFFFF" />
              </View>
              <View style={[styles.heldTail, { borderTopColor: appearance.color }]} />
            </View>
          ) : (
            <View style={styles.freeCursor} testID="place-picker-free-cursor">
              <Ionicons name="location" size={36} color={colors.teal} />
              <View style={styles.freeCursorDot} />
            </View>
          )}
        </View>

        {searching && (
          <View style={styles.results}>
            <VenueSearchList venues={venues} query={query} error={venueError} onRetry={retry} onSelect={chooseResult} />
          </View>
        )}
      </View>

      {!searching && (
        <View style={[styles.bar, { paddingBottom: bottom + 16 }]}>
          {held ? (
            <>
              <View style={styles.heldCard} accessibilityLiveRegion="polite">
                <View style={[styles.cardDisc, { backgroundColor: appearance.color }]}>
                  <Ionicons name={appearance.icon} size={16} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName} numberOfLines={1}>{held.name}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>{held.category} · {held.address}</Text>
                </View>
                <Pressable onPress={() => setSnap(dismissSnap(snapRef.current))} hitSlop={10} accessibilityRole="button"
                  accessibilityLabel={`Not ${held.name}, drop a pin instead`}>
                  <Ionicons name="close-circle" size={24} color={colors.t3} />
                </Pressable>
              </View>
              <Pressable style={[styles.confirmBtn, { backgroundColor: appearance.color }]}
                onPress={() => onConfirmVenue(held)} accessibilityRole="button">
                <Text style={[styles.confirmText, { color: '#FFFFFF' }]} numberOfLines={1}>Meet at {held.name}</Text>
              </Pressable>
            </>
          ) : (
            <>
              {venues.length > 0 && (
                <Text style={styles.hint}>Move the map onto a place to choose it, or drop a pin anywhere.</Text>
              )}
              <Pressable style={[styles.confirmBtn, busy && { opacity: 0.6 }]} onPress={onConfirmPoint}
                disabled={busy} accessibilityRole="button">
                {busy
                  ? <ActivityIndicator color={colors.bg} size="small" />
                  : <Text style={styles.confirmText}>Confirm Location</Text>}
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  searchPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 100, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 9,
  },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.t1, padding: 0 },
  mapWrap: { flex: 1 },
  cursorAnchor: { position: 'absolute', top: '50%', left: '50%', width: 0, height: 0, alignItems: 'center' },
  // Both forms end exactly on the centre point: translate up by their height.
  freeCursor: { position: 'absolute', bottom: 0, alignItems: 'center', transform: [{ translateY: 4 }] },
  freeCursorDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal, marginTop: -2 },
  heldCursor: { position: 'absolute', bottom: 0, alignItems: 'center' },
  heldDot: {
    width: HELD_DOT, height: HELD_DOT, borderRadius: HELD_DOT / 2, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  heldTail: {
    width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: HELD_TAIL,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
  results: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg },
  bar: {
    paddingHorizontal: 20, paddingTop: 16, gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.t3, textAlign: 'center' },
  heldCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardDisc: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: colors.t1 },
  cardMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.t2, marginTop: 2 },
  confirmBtn: { backgroundColor: colors.teal, borderRadius: radius.l, paddingVertical: 14, alignItems: 'center' },
  confirmText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: colors.bg },
});
