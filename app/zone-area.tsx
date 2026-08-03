import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { reportLocation } from '@/services/location';
import { RadiusSlider } from '@/components/RadiusSlider';
import { Card } from '@/components/ui/Card';
import { mapStyleFor } from '@/constants/mapStyle';
import { fonts, radius as themeRadius, type } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { shiftForDisplay, wgs84ToGcj02 } from '@/services/gcj02';
import {
  formatRadius,
  getRegion,
  kindLabel,
  regionBoxContains,
  regionForPoint,
  regionViewport,
  ringsForDisplay,
  searchRegions,
  RADIUS_MAX_M,
  RADIUS_MIN_M,
  type Region,
  type RegionCandidate,
  type RegionSummary,
  type ZoneMode,
} from '@/services/zoneArea';

/** How long to sit on a keystroke before asking the server.
 *
 *  Long enough that typing a city name is one request rather than eight, short
 *  enough that it still feels like it is keeping up. */
const SEARCH_DEBOUNCE_MS = 350;
/** Matches MIN_QUERY_LEN on the server, which answers shorter queries with an
 *  empty list rather than searching. */
const MIN_QUERY_LEN = 2;

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
    const coords = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
    // Tell the server where we are before anyone asks it to check.
    //
    // This screen traces from the device's live fix, but the save is validated
    // against the position the *server* holds — written only when the map ticks
    // or the background task runs. Opening the app straight into Settings →
    // Zone Size, or walking a few streets first, left those two disagreeing,
    // and the disagreement surfaced as "you are not in Бостандық Ауданы" to
    // somebody standing in Бостандық Ауданы.
    //
    // Best effort: a failure here is not a reason to refuse to look up a place.
    // The server's own tolerance covers the rest — see position_tolerance_m.
    reportLocation(coords).catch(() => {});
    return coords;
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const { colors, themeMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();

  const [mode, setMode] = useState<ZoneMode>('radius');
  const [radiusM, setRadiusM] = useState(500);
  const [region, setRegion] = useState<RegionSummary | null>(null);
  const [outline, setOutline] = useState<Region | null>(null);

  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [lookupError, setLookupError] = useState<string | null>(null);
  /** Which of the two lookup buttons is in flight, so only that one spins. */
  const [locating, setLocating] = useState<'city' | 'district' | null>(null);

  /** Ranked alternatives, when the server would not choose for us.
   *
   * Kept separate from search results even though they render alike: these are
   * places that provably contain you and were declined only for lack of
   * confidence, so they carry reasons and never need the "not where you are"
   * check that a typed search does. */
  const [choices, setChoices] = useState<RegionCandidate[]>([]);
  const [choicesFor, setChoicesFor] = useState<'city' | 'district' | null>(null);

  // Search — the way out when tracing finds nothing. `results === null` is the
  // idle state, an empty array is a search that genuinely found nothing, and
  // the two need to look different on screen.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RegionSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

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

  /** The one way a region is adopted, whether it was traced or searched for.
   *
   * Both routes land here so the save, the mode switch, the revert-on-failure
   * and the cleared error state cannot drift apart between them. */
  const commitRegion = useCallback((next: RegionSummary) => {
    const previous = region;
    setRegion(next);
    setMode('region');
    setLookupError(null);
    setQuery('');
    setResults(null);
    setSearchError(null);
    setChoices([]);
    setChoicesFor(null);
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

  // ── Lookup ───────────────────────────────────────────────────────────────
  /** Trace the place the user is standing in, at one of the two sizes.
   *
   * A district lookup that finds nothing offers the city by name rather than
   * quietly using it — the two are orders of magnitude apart, and picking the
   * larger one on someone's behalf is not a rounding error. */
  async function traceMyPlace(level: 'city' | 'district') {
    setLocating(level);
    setLookupError(null);
    setChoices([]);
    setChoicesFor(null);
    try {
      const position = coords ?? (await currentCoords());
      if (!position) {
        setLookupError('Location is off, so there is nothing to trace. Find your place by name below instead.');
        return;
      }
      setCoords(position);
      const lookup = await regionForPoint(position.latitude, position.longitude, level);
      if (lookup.region) {
        commitRegion(lookup.region);
        return;
      }

      // The server found places that fit but would not choose between them,
      // or found nothing it trusted. Either way it hands back what it saw
      // rather than guessing — a wrong region here is not wrong once, it gets
      // stored and answers for everyone who stands here afterwards.
      if (lookup.candidates.length) {
        setChoices(lookup.candidates);
        setChoicesFor(level);
        setLookupError(
          lookup.outcome === 'ambiguous'
            ? `More than one ${level} fits where you are. Pick the one you mean.`
            : `Nothing here is clearly your ${level}. These are the closest — pick one, or find it by name below.`,
        );
        return;
      }

      if (level === 'district' && lookup.cityName) {
        setLookupError(
          `No district is mapped inside ${lookup.cityName}. Tap “Use my city” to cover all of it, or find it by name below.`,
        );
      } else {
        setLookupError(
          level === 'district'
            ? 'No district is mapped where you are. Try your city, or find it by name below.'
            : 'Nothing mapped covers where you are. Try finding it by name below.',
        );
      }
    } catch (e: any) {
      setLookupError(
        e?.response?.status === 503
          ? 'Place lookups are busy right now. Try again in a moment.'
          : 'Could not find your area right now.',
      );
    } finally {
      setLocating(null);
    }
  }

  // ── Search ─────────────────────────────────────────────────────────────────
  // The fallback for when tracing comes back empty — usually because OSM's
  // address hierarchy did not name the area in a way the lookup could resolve,
  // even though the region itself is already cached and findable by name.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      setResults(null);
      setSearchError(null);
      setSearching(false);
      return;
    }

    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchRegions(trimmed);
        if (!alive) return;
        setResults(found);
        setSearchError(null);
      } catch (e: any) {
        if (!alive) return;
        setResults(null);
        setSearchError(
          e?.response?.status === 503
            ? 'Place search is busy right now. Try again in a moment.'
            : 'Could not search places. Check your connection and try again.',
        );
      } finally {
        if (alive) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => { alive = false; clearTimeout(timer); };
  }, [query]);

  // ── Preview geometry ───────────────────────────────────────────────────────
  // This preview is a static map: it draws one shape, nothing on it can be
  // touched, and no code reads a coordinate back off it. That makes it the one
  // surface where the mainland-China display shift can be applied *completely*
  // — circle, outline and camera all move together, so they stay consistent
  // with each other and with the tiles underneath. The main map deliberately
  // does not do this; see services/gcj02 for why.
  const previewCoords = useMemo(
    () => (coords ? wgs84ToGcj02(coords.latitude, coords.longitude) : null),
    [coords],
  );
  /** The outline, split at the antimeridian and shifted for the basemap. */
  const previewRings = useMemo(
    () => (outline ? ringsForDisplay(outline, shiftForDisplay) : []),
    [outline],
  );
  const previewViewport = useCallback((target: RegionSummary) => {
    const box = regionViewport(target);
    return { ...box, ...wgs84ToGcj02(box.latitude, box.longitude) };
  }, []);

  // ── Preview framing ────────────────────────────────────────────────────────
  // The preview is only useful if it is showing the thing being changed, so it
  // re-frames whenever the shape does.
  useEffect(() => {
    if (!mapRef.current) return;
    if (mode === 'region' && region) {
      mapRef.current.animateToRegion(previewViewport(region), 400);
    } else if (previewCoords) {
      // Roughly four radii across, so the circle fills about half the frame at
      // every size instead of vanishing at 50m and overflowing at 5km.
      const delta = Math.max((radiusM * 4) / 111_000, 0.004);
      mapRef.current.animateToRegion({
        ...previewCoords, latitudeDelta: delta, longitudeDelta: delta,
      }, 300);
    }
  }, [mode, region, radiusM, previewCoords, previewViewport]);

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
              // Same basemap rules as the map itself. This preview is a few
              // hundred pixels tall and exists to show one shape; Google's
              // default business badges filled it with everything except the
              // thing it is for.
              customMapStyle={mapStyleFor(themeMode)}
              style={StyleSheet.absoluteFill}
              initialRegion={
                mode === 'region' && region
                  ? previewViewport(region)
                  : { ...(previewCoords ?? { latitude: 0, longitude: 0 }), latitudeDelta: 0.02, longitudeDelta: 0.02 }
              }
              pointerEvents="none"
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
            >
              {mode === 'radius' && previewCoords && (
                <Circle
                  center={previewCoords}
                  radius={radiusM}
                  fillColor="rgba(139,92,246,0.12)"
                  strokeColor="rgba(139,92,246,0.55)"
                  strokeWidth={2}
                />
              )}
              {/* One polygon per piece, not per ring: a region straddling the
                  dateline is cut in two at ±180 so it draws as an island group
                  rather than as a band around the planet. */}
              {mode === 'region' && previewRings.map((piece, i) => (
                <Polygon
                  key={i}
                  coordinates={piece}
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

            {lookupError ? <Text style={styles.error}>{lookupError}</Text> : null}

            {/* ── Ranked choices ──
                What the server hands back instead of guessing. Every one of
                these provably contains you; what it could not establish is
                which of them you mean. The reasons come along because a list
                of names with nothing to separate them just moves the problem
                rather than solving it. */}
            {choices.length ? (
              <View style={styles.choices}>
                <Text style={styles.choicesLabel}>
                  {choicesFor === 'district' ? 'Areas around you' : 'Places around you'}
                </Text>
                {choices.map((choice) => (
                  <Pressable
                    key={choice.region.id}
                    style={styles.resultRow}
                    onPress={() => commitRegion(choice.region)}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${choice.region.name}. ${choice.reasons.join('. ')}`}
                    accessibilityState={{ disabled: saving }}
                  >
                    <Ionicons name="location" size={16} color={colors.purple} />
                    <View style={styles.resultText}>
                      <View style={styles.chosenTitleRow}>
                        <Text style={styles.resultName} numberOfLines={1}>
                          {choice.region.name}
                        </Text>
                        <View style={styles.kindTag}>
                          <Text style={styles.kindTagText}>
                            {kindLabel(choice.region.kind)}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.resultWhere} numberOfLines={2}>
                        {choice.reasons.length
                          ? choice.reasons.join(' · ')
                          : choice.region.display_name}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* ── Search ──
                The way through when tracing finds nothing. OSM's coverage of
                sub-city areas is patchy and its address hierarchy does not name
                every district in a way the lookup can resolve, so a place can be
                perfectly well mapped and still be unreachable from the buttons
                above. Typing its name finds it. */}
            <View style={styles.searchWrap}>
              <View style={styles.searchField}>
                <Ionicons name="search" size={16} color={colors.t3} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Or find your city or district by name"
                  placeholderTextColor={colors.t3}
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel="Search for a city or district by name"
                />
                {searching ? <ActivityIndicator color={colors.t3} size="small" /> : null}
                {!searching && query.length > 0 ? (
                  <Pressable
                    onPress={() => setQuery('')}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                  >
                    <Ionicons name="close-circle" size={17} color={colors.t3} />
                  </Pressable>
                ) : null}
              </View>

              {searchError ? <Text style={styles.error}>{searchError}</Text> : null}

              {!searchError && results?.length === 0 ? (
                <Text style={styles.searchEmpty}>
                  Nothing found for “{query.trim()}”. Only places with a real mapped
                  border can be a zone, so try the city it is in.
                </Text>
              ) : null}

              {results?.map((found) => {
                // A zone has to cover somewhere you actually are, and the server
                // enforces that on save. The box test is cheap, needs no
                // geometry, and can only ever produce a *definite* no — so it
                // greys out the results that would be refused without pretending
                // to be the real containment check.
                const unreachable =
                  !!coords && !regionBoxContains(found, coords.latitude, coords.longitude);
                return (
                  <Pressable
                    key={found.id}
                    style={[styles.resultRow, unreachable && styles.resultRowOff]}
                    onPress={() => commitRegion(found)}
                    disabled={unreachable || saving}
                    accessibilityRole="button"
                    accessibilityLabel={
                      unreachable
                        ? `${found.name}, not where you are`
                        : `Use ${found.name}`
                    }
                    accessibilityState={{ disabled: unreachable || saving }}
                  >
                    <Ionicons
                      name={unreachable ? 'location-outline' : 'location'}
                      size={16}
                      color={unreachable ? colors.t3 : colors.purple}
                    />
                    <View style={styles.resultText}>
                      <View style={styles.chosenTitleRow}>
                        <Text style={styles.resultName} numberOfLines={1}>{found.name}</Text>
                        <View style={styles.kindTag}>
                          <Text style={styles.kindTagText}>{kindLabel(found.kind)}</Text>
                        </View>
                      </View>
                      <Text style={styles.resultWhere} numberOfLines={1}>
                        {unreachable ? 'Not where you are' : found.display_name}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.hint}>
              Your zone follows the real border of the place, however big it is. It can
              only be somewhere you actually are — whether you trace it or find it by
              name, Aura checks that you are inside it before it takes effect.
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
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
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

  choices: { gap: 8 },
  choicesLabel: {
    fontFamily: fonts.body,
    fontSize: type.micro,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.t3,
  },

  searchWrap: { gap: 8 },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: themeRadius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    fontFamily: fonts.body,
    fontSize: type.small,
    color: colors.t1,
  },
  searchEmpty: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 17, color: colors.t3 },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: themeRadius.m,
    backgroundColor: colors.surface2,
  },
  resultRowOff: { opacity: 0.5 },
  resultText: { flex: 1 },
  resultName: { fontFamily: fonts.body, fontSize: type.small, fontWeight: '600', color: colors.t1 },
  resultWhere: { fontFamily: fonts.body, fontSize: type.caption, color: colors.t3, marginTop: 1 },

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



  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  noticeText: { flex: 1, fontFamily: fonts.body, fontSize: type.caption, color: colors.t2 },
});
