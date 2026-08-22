import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconClose, IconGlobe, IconPin } from '@/components/ui/icons';
import { mapStyleFor } from '@/constants/mapStyle';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { isInMainlandChina, MAINLAND_CHINA_NOTICE } from '@/services/gcj02';
import type { SwiftLocation } from '@/services/swifts';

/**
 * Where a Swift was made, after the viewer asked.
 *
 * ## Lifetime
 *
 * The `location` prop is held by whoever opened this sheet and is dropped when
 * it closes. It is never written back into the feed list, never persisted, and
 * never passed as a navigation parameter — a route param is serialized into
 * navigation state, which outlives the screen and is printed verbatim by every
 * debugging tool that touches it. "Open in map" therefore navigates to the map
 * *tab*, carrying nothing; see `handleOpenMap`.
 *
 * ## Precision
 *
 * A creator who shares their location approximately has their position snapped
 * to a ~500m cell before it is ever stored (`users.visibility.snap_coordinates`).
 * Drawing a pin on that would state a precision nobody granted, so an
 * approximate reveal draws a circle the size of the cell and says so in words.
 */

const APPROX_RADIUS_M = 500;
/** Tight for a pin, wide enough that a 500m circle fits with margin. */
const EXACT_DELTA = 0.006;
const APPROX_DELTA = 0.02;

interface Props {
  visible: boolean;
  /** Null while the reveal is still in flight. */
  location: SwiftLocation | null;
  loading: boolean;
  error: string | null;
  authorName: string;
  onClose: () => void;
  onRetry: () => void;
}

export function SwiftLocationSheet({
  visible, location, loading, error, authorName, onClose, onRetry,
}: Props) {
  const { colors, themeMode } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const approximate = location?.precision === 'approximate';
  const hasPoint =
    location?.latitude !== null
    && location?.latitude !== undefined
    && location?.longitude !== null
    && location?.longitude !== undefined;

  const point = hasPoint
    ? { latitude: location!.latitude as number, longitude: location!.longitude as number }
    : null;

  function handleOpenMap() {
    // The map tab, and nothing else. Deliberately no coordinate in the route:
    // navigation params are serialized into a state tree that outlives this
    // sheet, and putting a revealed position there would leak it into exactly
    // the places this whole design keeps it out of.
    onClose();
    router.push('/(tabs)/map');
  }

  const capturedOn = location?.captured_at
    ? new Date(location.captured_at).toLocaleDateString(undefined, {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : '';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <Text style={styles.title} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
            Where this was made
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <IconClose size={20} color={colors.t2} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.teal} size="large" />
            <Text style={styles.centreText}>Getting the location…</Text>
          </View>
        ) : error ? (
          <View style={styles.centre}>
            <IconPin size={30} color={colors.t3} />
            <Text style={styles.errorTitle}>{error}</Text>
            <Pressable onPress={onRetry} hitSlop={10} accessibilityRole="button">
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          </View>
        ) : point ? (
          <>
            <View style={styles.mapWrap}>
              <MapView
                style={StyleSheet.absoluteFill}
                provider={PROVIDER_GOOGLE}
                customMapStyle={mapStyleFor(themeMode)}
                initialRegion={{
                  ...point,
                  latitudeDelta: approximate ? APPROX_DELTA : EXACT_DELTA,
                  longitudeDelta: approximate ? APPROX_DELTA : EXACT_DELTA,
                }}
                toolbarEnabled={false}
                showsUserLocation={false}
                showsMyLocationButton={false}
              >
                {approximate ? (
                  <Circle
                    center={point}
                    radius={APPROX_RADIUS_M}
                    fillColor="rgba(31,199,182,0.16)"
                    strokeColor="rgba(31,199,182,0.6)"
                    strokeWidth={2}
                  />
                ) : (
                  <Marker coordinate={point} tracksViewChanges={false}>
                    <View style={styles.pin}>
                      <IconPin size={30} color={colors.teal} />
                    </View>
                  </Marker>
                )}
              </MapView>
            </View>

            <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
              <Text style={styles.place} numberOfLines={2}>
                {location?.place_name || 'Unnamed place'}
              </Text>
              {/* "Where" without "when" invites the reader to assume "now",
                  and a Swift can be watched months after it was made. */}
              {capturedOn ? (
                <Text style={styles.meta}>
                  {authorName ? `@${authorName} · ` : ''}{capturedOn}
                </Text>
              ) : null}

              {approximate ? (
                <Text style={styles.approxNote}>
                  This creator shares their location approximately, so this is
                  the area rather than an exact spot.
                </Text>
              ) : null}

              {isInMainlandChina(point.latitude, point.longitude) ? (
                <Text style={styles.approxNote}>{MAINLAND_CHINA_NOTICE}</Text>
              ) : null}

              <Text style={styles.seenNote}>
                {authorName ? `@${authorName}` : 'The creator'} can see that you
                looked this up.
              </Text>

              <Pressable
                style={styles.mapBtn}
                onPress={handleOpenMap}
                accessibilityRole="button"
                accessibilityLabel="Open the Aura map"
              >
                <IconGlobe size={18} color={colors.t1} />
                <Text style={styles.mapBtnLabel}>Open the map</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.centre}>
            <Text style={styles.errorTitle}>This location isn’t available.</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.title,
    color: colors.t1,
  },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centreText: { fontFamily: fonts.body, fontSize: typography.small, color: colors.t3 },
  errorTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
    textAlign: 'center',
  },
  retry: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.teal,
  },

  mapWrap: { flex: 1, backgroundColor: colors.surface2 },
  pin: { alignItems: 'center', justifyContent: 'center' },

  footer: {
    padding: 18,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  place: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  meta: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3 },
  approxNote: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.t3,
  },
  seenNote: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.teal,
  },
  mapBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  mapBtnLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
});
