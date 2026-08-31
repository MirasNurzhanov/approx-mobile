import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import * as Location from 'expo-location';

import { usePermissionPrimer } from '@/components/PermissionPrimer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconClose, IconLocate, IconPin, IconTrash } from '@/components/ui/icons';
import { mapStyleFor } from '@/constants/mapStyle';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { isInMainlandChina, MAINLAND_CHINA_NOTICE } from '@/services/gcj02';

/**
 * Choosing where a Swift was made.
 *
 * ## Why a fixed crosshair rather than a draggable marker
 *
 * The pin here is a plain `View` centred over the map, not a `<Marker>`. Two
 * reasons, and the second is the real one:
 *
 * 1. It is the pattern people already know from every ride-hailing and
 *    delivery app — move the map, the pin stays put, what is under it is what
 *    you get.
 * 2. `react-native-maps` under the New Architecture cannot reliably remove a
 *    marker once mounted — the app has hit this before (see the map's
 *    `parkedMarker` workaround, which exists precisely because unmounting a
 *    marker leaves a ghost). A picker whose pin moves on every pan would be
 *    mounting and remounting one constantly. An overlay `View` has no marker
 *    lifecycle at all, so there is nothing to ghost.
 *
 * Tapping the map still works and moves the camera to the tapped point, so
 * "place the pin there" is available as well as "drag the map under it".
 *
 * ## What it hands back
 *
 * A coordinate and a best-effort place name, and nothing is attached until
 * *Use this location* is pressed. Opening this sheet and closing it leaves the
 * draft exactly as it was — see `DetailsStep`, where the switch that used to
 * do this silently attached a position the moment it was flipped.
 */

export interface PickedLocation {
  latitude: number;
  longitude: number;
  placeName: string;
}

interface Props {
  visible: boolean;
  /** The position already attached, so reopening starts where it left off. */
  initial: PickedLocation | null;
  onCancel: () => void;
  onConfirm: (picked: PickedLocation) => void;
  onRemove: () => void;
}

/** Tight enough that the pin means a place rather than a district. */
const DEFAULT_DELTA = 0.004;

export function LocationPickerSheet({
  visible, initial, onCancel, onConfirm, onRemove,
}: Props) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      {/* Mounted only while open, so every opening starts from `initial`
          rather than from whatever the last one was left on. That is also why
          there is no effect seeding state here: the state is *initialised*
          from props, which is the difference between "reset it afterwards" and
          "never had the wrong value". */}
      {visible ? (
        <PickerBody
          initial={initial}
          onCancel={onCancel}
          onConfirm={onConfirm}
          onRemove={onRemove}
        />
      ) : null}
    </Modal>
  );
}

function PickerBody({
  initial, onCancel, onConfirm, onRemove,
}: Omit<Props, 'visible'>) {
  const { colors, themeMode } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  const mapRef = useRef<MapView | null>(null);
  /** The map's current centre — which is what the crosshair is pointing at. */
  const centreRef = useRef<{ latitude: number; longitude: number } | null>(
    initial ? { latitude: initial.latitude, longitude: initial.longitude } : null,
  );

  const [region, setRegion] = useState<Region | null>(() =>
    initial
      ? {
          latitude: initial.latitude,
          longitude: initial.longitude,
          latitudeDelta: DEFAULT_DELTA,
          longitudeDelta: DEFAULT_DELTA,
        }
      : null,
  );
  const [centre, setCentre] = useState<{ latitude: number; longitude: number } | null>(
    () => (initial ? { latitude: initial.latitude, longitude: initial.longitude } : null),
  );
  const [placeName, setPlaceName] = useState(initial?.placeName ?? '');
  const [locating, setLocating] = useState(false);
  const { ensure: ensurePermission, primer } = usePermissionPrimer();
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  // No stored position to open on, so ask the OS for one — once, on mount, and
  // only because the creator opened a location picker. The composer never
  // holds a fix speculatively.
  useEffect(() => {
    // Silent on mount, and that is the point. This used to call
    // `requestForegroundPermissionsAsync()` here, so merely *opening* the
    // location picker fired iOS's dialog cold — a permission request the user
    // had not asked for, which is the shape of the 5.1.1(iv) rejection.
    //
    // Now the sheet opens on a pannable map either way, and the position is
    // only fetched for somebody who has already granted access. Asking is what
    // the "Use my current location" button below is for.
    if (!initial) void goToCurrentPosition({ prompt: false });
    // Mount only: `initial` is the opening value by construction, and this
    // component is remounted for each opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Centre the map on the user.
   *
   * `prompt` decides whether this may ask for permission. False on mount — see
   * above — and true from the button, which is an explicit request for exactly
   * this and therefore the right moment to ask. `ensurePermission` shows the
   * explanation sheet and then the OS dialog with nothing in between.
   */
  async function goToCurrentPosition({ prompt = true }: { prompt?: boolean } = {}) {
    setLocating(true);
    setError(null);
    try {
      const existing = await Location.getForegroundPermissionsAsync();
      const granted = existing.granted
        ? true
        : (prompt ? await ensurePermission('location') : false);
      if (!granted) {
        setError(
          prompt
            ? 'Approx needs location access to find where you are. You can still pan the map.'
            : null,
        );
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setCentre(next);
      centreRef.current = next;
      setRegion({ ...next, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA });
      mapRef.current?.animateToRegion(
        { ...next, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA }, 350,
      );
      void describe(next);
    } catch {
      setError('Couldn’t find your position. Pan the map to choose a spot.');
    } finally {
      setLocating(false);
    }
  }

  /** Best-effort name for a coordinate. A failure is not an error — an unnamed
   *  point is still a perfectly good place to attach. */
  async function describe(at: { latitude: number; longitude: number }) {
    try {
      const [place] = await Location.reverseGeocodeAsync(at);
      setPlaceName(
        [place?.name, place?.city].filter(Boolean).join(', ').slice(0, 200),
      );
    } catch {
      setPlaceName('');
    }
  }

  function handleRegionChangeComplete(next: Region) {
    const at = { latitude: next.latitude, longitude: next.longitude };
    centreRef.current = at;
    setCentre(at);
    setMoving(false);
    void describe(at);
  }

  const chinaNotice = centre
    ? isInMainlandChina(centre.latitude, centre.longitude)
    : false;

  return (
    <View style={styles.root}>
        {primer}
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <Pressable
            onPress={onCancel}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <IconClose size={20} color={colors.t2} />
          </Pressable>
          <Text style={styles.title} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
            Where was this?
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.mapWrap}>
          {region ? (
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              provider={PROVIDER_GOOGLE}
              // The same basemap the map tab and the zone preview use, so the
              // picker does not look like a different app.
              customMapStyle={mapStyleFor(themeMode)}
              initialRegion={region}
              onPanDrag={() => setMoving(true)}
              onRegionChangeComplete={handleRegionChangeComplete}
              onPress={(e) => {
                // Tap to place: move the camera, and the crosshair — which is
                // always dead centre — ends up over the tapped point.
                const at = e.nativeEvent.coordinate;
                mapRef.current?.animateToRegion(
                  { ...at, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA },
                  250,
                );
              }}
              showsUserLocation
              showsMyLocationButton={false}
              toolbarEnabled={false}
            />
          ) : (
            <View style={styles.mapPlaceholder}>
              <ActivityIndicator color={colors.teal} />
            </View>
          )}

          {/* The pin. An overlay View, not a Marker — see the component note. */}
          <View style={styles.crosshair} pointerEvents="none">
            <View style={[styles.pinLift, moving && styles.pinLifted]}>
              <IconPin size={36} color={colors.teal} />
            </View>
            <View style={styles.pinDot} />
          </View>

          <Pressable
            style={[styles.locateBtn, { bottom: 16 }]}
            onPress={() => goToCurrentPosition()}
            disabled={locating}
            accessibilityRole="button"
            accessibilityLabel="Use my current location"
          >
            {locating
              ? <ActivityIndicator color={colors.t1} size="small" />
              : <IconLocate size={20} color={colors.t1} />}
          </Pressable>
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          {/* What will actually be attached, stated plainly. The coordinate is
              shown as well as the name because the name can be wrong or
              missing, and the creator is agreeing to the point, not the label. */}
          <Text style={styles.readoutLabel} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
            This will be attached
          </Text>
          <Text style={styles.readoutPlace} numberOfLines={1}>
            {placeName || 'Unnamed place'}
          </Text>
          <Text style={styles.readoutCoord} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
            {centre
              ? `${centre.latitude.toFixed(5)}, ${centre.longitude.toFixed(5)}`
              : '—'}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {chinaNotice ? <Text style={styles.notice}>{MAINLAND_CHINA_NOTICE}</Text> : null}

          <View style={styles.actions}>
            {initial ? (
              <Pressable
                style={styles.removeBtn}
                onPress={onRemove}
                accessibilityRole="button"
                accessibilityLabel="Remove location"
              >
                <IconTrash size={18} color={colors.red} />
                <Text style={styles.removeLabel}>Remove</Text>
              </Pressable>
            ) : null}

            <Pressable
              style={[styles.confirmBtn, !centre && styles.confirmOff]}
              disabled={!centre}
              onPress={() => {
                if (!centre) return;
                onConfirm({ ...centre, placeName });
              }}
              accessibilityRole="button"
              accessibilityLabel="Use this location"
            >
              <Text style={styles.confirmLabel}>Use this location</Text>
            </Pressable>
        </View>
      </View>
    </View>
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
  headerSpacer: { width: 20 },

  mapWrap: { flex: 1, backgroundColor: colors.surface2 },
  mapPlaceholder: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  crosshair: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The pin sits above the point it marks, so its tip lands on the dot. */
  pinLift: { marginBottom: 30 },
  pinLifted: { marginBottom: 38 },
  pinDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.teal,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },

  locateBtn: {
    position: 'absolute',
    right: 14,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  footer: {
    padding: 18,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  readoutLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.micro,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.t3,
  },
  readoutPlace: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  readoutCoord: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    color: colors.t3,
    fontVariant: ['tabular-nums'],
  },
  error: {
    marginTop: 6,
    fontFamily: fonts.body,
    fontSize: typography.small,
    color: colors.red,
  },
  notice: {
    marginTop: 6,
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.t3,
  },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    height: 48,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  removeLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.red,
  },
  confirmBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.teal,
  },
  confirmOff: { opacity: 0.4 },
  confirmLabel: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: typography.body,
    color: colors.bg,
  },
});
