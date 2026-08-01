import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Circle, Polygon, PROVIDER_GOOGLE } from 'react-native-maps';

import { api } from '@/services/api';
import { RadiusSlider } from '@/components/RadiusSlider';
import { Card } from '@/components/ui/Card';
import { colors, fonts, radius as themeRadius, type } from '@/constants/theme';
import {
  formatRadius,
  getRegion,
  kindLabel,
  regionForPoint,
  regionViewport,
  searchRegions,
  toLatLng,
  RADIUS_MAX_M,
  RADIUS_MIN_M,
  type Region,
  type RegionSummary,
  type ZoneMode,
} from '@/services/zoneArea';

// How far your zone reaches.
//
// Two shapes, because "how big" stops being a useful question somewhere around
// a kilometre. Under that a circle is exactly right and the only thing you want
// is a dial. Past it, what people actually mean is a *place* — "my city" — and a
// circle drawn over a city is wrong in both directions at once: it spills into
// the next town on one side and stops short of the suburbs on the other. So the
// big end is a real boundary, not a bigger circle.
//
// Radius and region are stored side by side on the server, so switching back
// and forth never loses the one you are not using.

// ─── Types ────────────────────────────────────────────────────────────────────
interface ZoneState {
  zone_mode?: ZoneMode;
  zone_radius?: number;
  zone_region?: number | null;
  zone_region_detail?: RegionSummary | null;
  zone_active?: boolean;
}

// ─── Position ─────────────────────────────────────────────────────────────────
/** The device's position, or null when location is off.
 *
 * Never *asks* for permission: this screen is reachable from Settings, and a
 * permission prompt fired by opening a settings page is exactly the ambush the
 * priming layer exists to avoid. Without a fix the preview simply says so. */
async function currentCoords(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
  } catch {
    return null;
  }
}

// ─── Mode switch ──────────────────────────────────────────────────────────────
function ModeTabs({ mode, onChange, disabled }: {
  mode: ZoneMode;
  onChange: (mode: ZoneMode) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {(['radius', 'region'] as const).map((key) => {
        const active = mode === key;
        return (
          <Pressable
            key={key}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onChange(key)}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: !!disabled }}
            accessibilityLabel={key === 'radius' ? 'Set a radius' : 'Cover a place'}
          >
            <Ionicons
              name={key === 'radius' ? 'radio-button-on-outline' : 'map-outline'}
              size={15}
              color={active ? colors.bg : colors.t2}
            />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
              {key === 'radius' ? 'Radius' : 'Place'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ZoneAreaScreen() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();

  const [mode, setMode] = useState<ZoneMode>('radius');
  const [radiusM, setRadiusM] = useState(500);
  const [region, setRegion] = useState<RegionSummary | null>(null);
  const [outline, setOutline] = useState<Region | null>(null);

  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RegionSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** Which of the two lookup buttons is in flight, so only that one spins. */
  const [locating, setLocating] = useState<'city' | 'district' | null>(null);

  const mapRef = useRef<MapView | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const [zoneRes, position] = await Promise.allSettled([
        api.get<ZoneState>('/api/users/zone/'),
        currentCoords(),
      ]);
      if (!alive) return;

      if (zoneRes.status === 'fulfilled') {
        const z = zoneRes.value.data;
        setMode(z.zone_mode === 'region' && z.zone_region ? 'region' : 'radius');
        setRadiusM(z.zone_radius && z.zone_radius > 0 ? z.zone_radius : 500);
        if (z.zone_region_detail) setRegion(z.zone_region_detail);
      }
      if (position.status === 'fulfilled' && position.value) setCoords(position.value);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  // The outline is only needed to draw the preview, so it is fetched after the
  // region is known rather than as part of the settings load.
  useEffect(() => {
    let alive = true;
    if (!region) { setOutline(null); return; }
    getRegion(region.id).then((r) => { if (alive) setOutline(r); });
    return () => { alive = false; };
  }, [region]);

  // ── Save ───────────────────────────────────────────────────────────────────
  // Everything saves as you touch it, matching the zone-music screen next door.
  const save = useCallback(async (patch: Partial<ZoneState>, revert: () => void) => {
    setSaving(true);
    try {
      await api.patch('/api/users/zone/', patch);
    } catch (e: any) {
      revert();
      Alert.alert(
        'Could not save',
        e?.response?.data?.zone_radius?.[0] ??
        e?.response?.data?.zone_region?.[0] ??
        e?.response?.data?.detail ??
        'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }, []);

  const commitRadius = useCallback((next: number) => {
    const previous = radiusM;
    setRadiusM(next);
    save({ zone_radius: next }, () => setRadiusM(previous));
  }, [radiusM, save]);

  const commitMode = useCallback((next: ZoneMode) => {
    if (next === mode) return;
    // Switching to region without one picked would be rejected by the server,
    // so the tab moves the UI but only persists once a place exists.
    if (next === 'region' && !region) {
      setMode('region');
      return;
    }
    const previous = mode;
    setMode(next);
    save(
      next === 'region' ? { zone_mode: next, zone_region: region!.id } : { zone_mode: next },
      () => setMode(previous),
    );
  }, [mode, region, save]);

  const commitRegion = useCallback((next: RegionSummary) => {
    const previous = region;
    setRegion(next);
    setMode('region');
    setResults([]);
    setQuery('');
    Keyboard.dismiss();
    save({ zone_mode: 'region', zone_region: next.id }, () => {
      setRegion(previous);
      if (!previous) setMode('radius');
    });
  }, [region, save]);

  const clearRegion = useCallback(() => {
    const previous = region;
    if (!previous) return;
    setRegion(null);
    setOutline(null);
    // Dropping the place has to drop the mode with it. Leaving the server in
    // region mode pointed at the region just cleared would keep the old city
    // on everyone's map while this screen showed nothing chosen.
    setMode('radius');
    save({ zone_mode: 'radius' }, () => {
      setRegion(previous);
      setMode('region');
    });
  }, [region, save]);

  // ── Lookup ─────────────────────────────────────────────────────────────────
  // Debounced: every miss costs an upstream call that is rate-limited to one a
  // second globally, so firing per keystroke would queue behind itself.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearchError(null); return; }

    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchRegions(q);
        if (!alive) return;
        setResults(found);
        setSearchError(found.length === 0 ? 'No places found with a mapped border.' : null);
      } catch {
        if (alive) setSearchError('Could not search right now.');
      } finally {
        if (alive) setSearching(false);
      }
    }, 450);

    return () => { alive = false; clearTimeout(timer); };
  }, [query]);

  /** Trace the place the user is standing in, at one of the two sizes.
   *
   * A district lookup that finds nothing offers the city by name rather than
   * quietly using it — the two are orders of magnitude apart, and picking the
   * larger one on someone's behalf is not a rounding error. */
  async function traceMyPlace(level: 'city' | 'district') {
    setLocating(level);
    setSearchError(null);
    try {
      const position = coords ?? (await currentCoords());
      if (!position) {
        setSearchError('Location is off, so there is nothing to trace. Search for a place instead.');
        return;
      }
      setCoords(position);
      const { region: found, cityName } = await regionForPoint(
        position.latitude, position.longitude, level,
      );
      if (found) {
        commitRegion(found);
      } else if (level === 'district' && cityName) {
        setSearchError(
          `No district is mapped inside ${cityName}. Tap “Use my city” to cover all of it.`,
        );
      } else {
        setSearchError(
          level === 'district'
            ? 'No district is mapped where you are. Try your city, or search.'
            : 'Nothing mapped covers where you are. Try searching.',
        );
      }
    } catch {
      setSearchError('Could not find your area right now.');
    } finally {
      setLocating(null);
    }
  }

  // ── Preview framing ────────────────────────────────────────────────────────
  // The preview is only useful if it is showing the thing being changed, so it
  // re-frames whenever the shape does.
  useEffect(() => {
    if (!mapRef.current) return;
    if (mode === 'region' && region) {
      mapRef.current.animateToRegion(regionViewport(region), 400);
    } else if (coords) {
      // Roughly four radii across, so the circle fills about half the frame at
      // every size instead of vanishing at 50m and overflowing at 5km.
      const delta = Math.max((radiusM * 4) / 111_000, 0.004);
      mapRef.current.animateToRegion({
        ...coords, latitudeDelta: delta, longitudeDelta: delta,
      }, 300);
    }
  }, [mode, region, radiusM, coords]);

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  const regionMissing = mode === 'region' && !region;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </Pressable>
        <Text style={styles.headerTitle}>Zone Size</Text>
        <View style={styles.headerSpacer}>
          {saving ? <ActivityIndicator color={colors.t3} size="small" /> : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ModeTabs mode={mode} onChange={commitMode} disabled={saving} />

        {/* ── Preview ── */}
        <View style={styles.preview}>
          {coords || region ? (
            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={StyleSheet.absoluteFill}
              initialRegion={
                mode === 'region' && region
                  ? regionViewport(region)
                  : { ...(coords ?? { latitude: 0, longitude: 0 }), latitudeDelta: 0.02, longitudeDelta: 0.02 }
              }
              pointerEvents="none"
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
            >
              {mode === 'radius' && coords && (
                <Circle
                  center={coords}
                  radius={radiusM}
                  fillColor="rgba(139,92,246,0.12)"
                  strokeColor="rgba(139,92,246,0.55)"
                  strokeWidth={2}
                />
              )}
              {mode === 'region' && outline?.rings.map((ring, i) => (
                <Polygon
                  key={i}
                  coordinates={toLatLng(ring)}
                  fillColor="rgba(139,92,246,0.12)"
                  strokeColor="rgba(139,92,246,0.55)"
                  strokeWidth={2}
                />
              ))}
            </MapView>
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <Text style={styles.previewEmpty}>
                {mode === 'region' ? 'Pick a place to see it here' : 'Turn on location to preview'}
              </Text>
            </View>
          )}
          {mode === 'region' && region && !outline && (
            <View style={styles.previewLoading}>
              <ActivityIndicator color={colors.t2} size="small" />
            </View>
          )}
        </View>

        {/* ── Radius ── */}
        {mode === 'radius' ? (
          <Card style={styles.card}>
            <View style={styles.readoutRow}>
              <Text style={styles.readoutLabel}>Reach</Text>
              <Text style={styles.readout}>{formatRadius(radiusM)}</Text>
            </View>
            <RadiusSlider
              value={radiusM}
              min={RADIUS_MIN_M}
              max={RADIUS_MAX_M}
              onChange={setRadiusM}
              onCommit={commitRadius}
              format={formatRadius}
              disabled={saving}
            />
            <Text style={styles.hint}>
              Anyone inside the circle is in your zone. To cover a whole city, switch to
              Place — a circle that big spills into the next town on one side and stops
              short of the suburbs on the other.
            </Text>
          </Card>
        ) : (
          /* ── Place ── */
          <Card style={styles.card}>
            {region ? (
              <View style={styles.chosen}>
                <Ionicons name="location" size={18} color={colors.purple} />
                <View style={styles.chosenText}>
                  <View style={styles.chosenTitleRow}>
                    <Text style={styles.chosenName} numberOfLines={1}>{region.name}</Text>
                    <View style={styles.kindTag}>
                      <Text style={styles.kindTagText}>{kindLabel(region.kind)}</Text>
                    </View>
                  </View>
                  <Text style={styles.chosenWhere} numberOfLines={1}>
                    {region.display_name}
                  </Text>
                </View>
                <Pressable
                  onPress={clearRegion}
                  hitSlop={10}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={`Clear ${region.name}`}
                >
                  <Ionicons name="close-circle" size={20} color={colors.t3} />
                </Pressable>
              </View>
            ) : null}

            {/* Two sizes, traced from where you are standing. Side by side
                rather than one button with a size picker: they are the two
                answers to the same question, and neither is the default. */}
            <View style={styles.traceRow}>
              <Pressable
                style={[styles.traceBtn, locating === 'city' && styles.traceBtnBusy]}
                onPress={() => traceMyPlace('city')}
                disabled={locating !== null || saving}
                accessibilityRole="button"
                accessibilityLabel="Use my whole city"
                accessibilityState={{ disabled: locating !== null || saving }}
              >
                {locating === 'city'
                  ? <ActivityIndicator color={colors.teal} size="small" />
                  : <Ionicons name="business-outline" size={17} color={colors.teal} />}
                <Text style={styles.traceLabel}>Use my city</Text>
                <Text style={styles.traceHint}>The whole city</Text>
              </Pressable>

              <Pressable
                style={[styles.traceBtn, locating === 'district' && styles.traceBtnBusy]}
                onPress={() => traceMyPlace('district')}
                disabled={locating !== null || saving}
                accessibilityRole="button"
                accessibilityLabel="Use my district, the area inside my city"
                accessibilityState={{ disabled: locating !== null || saving }}
              >
                {locating === 'district'
                  ? <ActivityIndicator color={colors.teal} size="small" />
                  : <Ionicons name="navigate-outline" size={17} color={colors.teal} />}
                <Text style={styles.traceLabel}>Use my district</Text>
                <Text style={styles.traceHint}>Just my area of it</Text>
              </Pressable>
            </View>

            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.t3} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search a city or region"
                placeholderTextColor={colors.t3}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Search for a city or region"
              />
              {searching ? <ActivityIndicator color={colors.t3} size="small" /> : null}
            </View>

            {searchError ? <Text style={styles.error}>{searchError}</Text> : null}

            {results.map((r) => (
              <Pressable
                key={r.id}
                style={styles.result}
                onPress={() => commitRegion(r)}
                accessibilityRole="button"
              >
                <Ionicons name="map-outline" size={16} color={colors.t2} />
                <View style={styles.resultText}>
                  <View style={styles.chosenTitleRow}>
                    <Text style={styles.resultName} numberOfLines={1}>{r.name}</Text>
                    <View style={styles.kindTag}>
                      <Text style={styles.kindTagText}>{kindLabel(r.kind)}</Text>
                    </View>
                  </View>
                  <Text style={styles.resultWhere} numberOfLines={1}>{r.display_name}</Text>
                </View>
              </Pressable>
            ))}

            <Text style={styles.hint}>
              Your zone follows the real border of the place you pick, however big it is.
              Only places with a mapped boundary can be chosen.
            </Text>
          </Card>
        )}

        {regionMissing && (
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={16} color={colors.t2} />
            <Text style={styles.noticeText}>
              Pick a place to switch. Until then your zone stays a {formatRadius(radiusM)} circle.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.display, fontSize: type.body, fontWeight: '600', color: colors.t1 },
  headerSpacer: { width: 40, alignItems: 'center' },

  scroll: { paddingHorizontal: 20, gap: 16 },

  tabs: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 999,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 999,
  },
  tabActive: { backgroundColor: colors.teal },
  tabLabel: { fontFamily: fonts.body, fontSize: type.small, fontWeight: '600', color: colors.t2 },
  tabLabelActive: { color: colors.bg },

  preview: {
    height: 200,
    borderRadius: themeRadius.l,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewEmpty: { fontFamily: fonts.body, fontSize: type.small, color: colors.t3 },
  previewLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,11,0.4)',
  },

  card: { padding: 16, gap: 10 },

  readoutRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  readoutLabel: {
    fontFamily: fonts.body,
    fontSize: type.micro,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.t3,
  },
  readout: { fontFamily: fonts.display, fontSize: type.title, fontWeight: '700', color: colors.t1 },

  hint: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 17, color: colors.t3 },
  error: { fontFamily: fonts.body, fontSize: type.caption, color: colors.orange },

  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface2,
    borderRadius: themeRadius.m,
    padding: 12,
  },
  chosenText: { flex: 1 },
  chosenName: { fontFamily: fonts.body, fontSize: type.body, fontWeight: '600', color: colors.t1 },
  chosenWhere: { fontFamily: fonts.body, fontSize: type.caption, color: colors.t3, marginTop: 1 },

  traceRow: { flexDirection: 'row', gap: 10 },
  traceBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: themeRadius.m,
    borderWidth: 1,
    borderColor: colors.tealLine,
    backgroundColor: colors.tealTint,
  },
  traceBtnBusy: { opacity: 0.7 },
  traceLabel: { fontFamily: fonts.body, fontSize: type.small, fontWeight: '600', color: colors.teal },
  traceHint: { fontFamily: fonts.body, fontSize: type.micro, color: colors.t2, textAlign: 'center' },

  chosenTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kindTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: themeRadius.s,
    backgroundColor: colors.surface,
  },
  kindTagText: {
    fontFamily: fonts.body,
    fontSize: type.micro,
    fontWeight: '600',
    color: colors.t2,
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface2,
    borderRadius: themeRadius.m,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.t1,
  },

  result: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  resultText: { flex: 1 },
  resultName: { fontFamily: fonts.body, fontSize: type.small, fontWeight: '600', color: colors.t1 },
  resultWhere: { fontFamily: fonts.body, fontSize: type.micro, color: colors.t3, marginTop: 1 },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  noticeText: { flex: 1, fontFamily: fonts.body, fontSize: type.caption, color: colors.t2 },
});
