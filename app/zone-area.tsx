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
import { runBusy } from '@/services/busy';
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
  const styles = makeStyles(colors);
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

// ─── Sections ─────────────────────────────────────────────────────────────────
// The screen owns the zone state and every save; these draw it.

/** A map viewport. Named apart from this file's own `Region`, which is a place
 *  with a border rather than a rectangle on screen. */
type Viewport = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

/** The shape being edited, drawn on a map that cannot be touched. */
function ZonePreview({ mapRef, themeMode, mode, region, coords, previewCoords, previewViewport, previewRings, radiusM, outline }: {
  mapRef: React.RefObject<MapView | null>;
  themeMode: 'dark' | 'light';
  mode: ZoneMode;
  region: RegionSummary | null;
  coords: { latitude: number; longitude: number } | null;
  previewCoords: { latitude: number; longitude: number } | null;
  previewViewport: (target: RegionSummary) => Viewport;
  previewRings: { latitude: number; longitude: number }[][];
  radiusM: number;
  outline: Region | null;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
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
          {mode === 'region' && previewRings.map((piece) => (
            <Polygon
              // Keyed on where the piece starts: the split is deterministic, so
              // a piece keeps its identity until the region itself changes.
              key={`${piece[0].latitude},${piece[0].longitude}`}
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
  );
}

function RadiusCard({ radiusM, saving, onChange, onCommit }: {
  radiusM: number;
  saving: boolean;
  onChange: (next: number) => void;
  onCommit: (next: number) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Card style={styles.card}>
      <View style={styles.readoutRow}>
        <Text style={styles.readoutLabel}>Reach</Text>
        <Text style={styles.readout}>{formatRadius(radiusM)}</Text>
      </View>
      <RadiusSlider
        value={radiusM}
        min={RADIUS_MIN_M}
        max={RADIUS_MAX_M}
        onChange={onChange}
        onCommit={onCommit}
        format={formatRadius}
        disabled={saving}
      />
      <Text style={styles.hint}>
        Anyone inside the circle is in your zone. To cover a whole city, switch to
        Place — a circle that big spills into the next town on one side and stops
        short of the suburbs on the other.
      </Text>
    </Card>
  );
}

/**
 * What the server hands back instead of guessing.
 *
 * Every one of these provably contains you; what it could not establish is
 * which of them you mean. The reasons come along because a list of names with
 * nothing to separate them just moves the problem rather than solving it.
 */
function RankedChoices({ choices, choicesFor, saving, onPick }: {
  choices: RegionCandidate[];
  choicesFor: 'city' | 'district' | null;
  saving: boolean;
  onPick: (region: RegionSummary) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  if (!choices.length) return null;
  return (
    <View style={styles.choices}>
      <Text style={styles.choicesLabel}>
        {choicesFor === 'district' ? 'Areas around you' : 'Places around you'}
      </Text>
      {choices.map((choice) => (
        <Pressable
          key={choice.region.id}
          style={styles.resultRow}
          onPress={() => onPick(choice.region)}
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
  );
}

/**
 * The way through when tracing finds nothing.
 *
 * OSM's coverage of sub-city areas is patchy and its address hierarchy does not
 * name every district in a way the lookup can resolve, so a place can be
 * perfectly well mapped and still be unreachable from the trace buttons.
 * Typing its name finds it.
 */
function RegionSearch({ query, results, searching, searchError, coords, saving, onQueryChange, onPick }: {
  query: string;
  results: RegionSummary[] | null;
  searching: boolean;
  searchError: string | null;
  coords: { latitude: number; longitude: number } | null;
  saving: boolean;
  onQueryChange: (q: string) => void;
  onPick: (region: RegionSummary) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.searchWrap}>
      <View style={styles.searchField}>
        <Ionicons name="search" size={16} color={colors.t3} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={onQueryChange}
          placeholder="Or find your city or district by name"
          placeholderTextColor={colors.t3}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search for a city or district by name"
        />
        {searching ? <ActivityIndicator color={colors.t3} size="small" /> : null}
        {!searching && query.length > 0 ? (
          <Pressable
            onPress={() => onQueryChange('')}
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
            onPress={() => onPick(found)}
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
  );
}

function PlaceCard({ region, locating, saving, lookupError, choices, choicesFor, query, results, searching, searchError, coords, onClearRegion, onTrace, onPickRegion, onQueryChange }: {
  region: RegionSummary | null;
  locating: 'city' | 'district' | null;
  saving: boolean;
  lookupError: string | null;
  choices: RegionCandidate[];
  choicesFor: 'city' | 'district' | null;
  query: string;
  results: RegionSummary[] | null;
  searching: boolean;
  searchError: string | null;
  coords: { latitude: number; longitude: number } | null;
  onClearRegion: () => void;
  onTrace: (size: 'city' | 'district') => void;
  onPickRegion: (region: RegionSummary) => void;
  onQueryChange: (q: string) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const busy = locating !== null || saving;
  return (
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
            onPress={onClearRegion}
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
          onPress={() => onTrace('city')}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Use my whole city"
          accessibilityState={{ disabled: busy }}
        >
          {locating === 'city'
            ? <ActivityIndicator color={colors.teal} size="small" />
            : <Ionicons name="business-outline" size={17} color={colors.teal} />}
          <Text style={styles.traceLabel}>Use my city</Text>
          <Text style={styles.traceHint}>The whole city</Text>
        </Pressable>

        <Pressable
          style={[styles.traceBtn, locating === 'district' && styles.traceBtnBusy]}
          onPress={() => onTrace('district')}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Use my district, the area inside my city"
          accessibilityState={{ disabled: busy }}
        >
          {locating === 'district'
            ? <ActivityIndicator color={colors.teal} size="small" />
            : <Ionicons name="navigate-outline" size={17} color={colors.teal} />}
          <Text style={styles.traceLabel}>Use my district</Text>
          <Text style={styles.traceHint}>Just my area of it</Text>
        </Pressable>
      </View>

      {lookupError ? <Text style={styles.error}>{lookupError}</Text> : null}

      <RankedChoices
        choices={choices}
        choicesFor={choicesFor}
        saving={saving}
        onPick={onPickRegion}
      />

      <RegionSearch
        query={query}
        results={results}
        searching={searching}
        searchError={searchError}
        coords={coords}
        saving={saving}
        onQueryChange={onQueryChange}
        onPick={onPickRegion}
      />

      <Text style={styles.hint}>
        Your zone follows the real border of the place, however big it is. It can
        only be somewhere you actually are — whether you trace it or find it by
        name, Aura checks that you are inside it before it takes effect.
      </Text>
    </Card>
  );
}

/**
 * The little map above the controls: what to draw on it, and where to point it.
 *
 * This preview is a static map — it draws one shape, nothing on it can be
 * touched, and no code reads a coordinate back off it. That makes it the one
 * surface where the mainland-China display shift can be applied *completely*:
 * circle, outline and camera all move together, so they stay consistent with
 * each other and with the tiles underneath. The main map deliberately does not
 * do this; see services/gcj02 for why.
 */
function useZonePreview({ mapRef, coords, outline, mode, region, radiusM }: {
  mapRef: React.RefObject<MapView | null>;
  coords: { latitude: number; longitude: number } | null;
  outline: Region | null;
  mode: ZoneMode;
  region: RegionSummary | null;
  radiusM: number;
}) {
  // Memoized by hand rather than left to the compiler: both of these are read
  // from the dependency array of the re-framing effect below, so their identity
  // is what decides whether the map animates. That guarantee has to hold even
  // if the compiler ever bails on this hook.
  const previewCoords = useMemo(
    () => (coords ? wgs84ToGcj02(coords.latitude, coords.longitude) : null),
    [coords],
  );
  /** The outline, split at the antimeridian and shifted for the basemap. */
  const previewRings = outline ? ringsForDisplay(outline, shiftForDisplay) : [];
  const previewViewport = useCallback((target: RegionSummary) => {
    const box = regionViewport(target);
    return { ...box, ...wgs84ToGcj02(box.latitude, box.longitude) };
  }, []);

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
  }, [mapRef, mode, region, radiusM, previewCoords, previewViewport]);

  return { previewCoords, previewRings, previewViewport };
}

/**
 * Find-a-place-by-name, in one piece.
 *
 * The fallback for when tracing comes back empty — usually because OSM's
 * address hierarchy did not name the area in a way the lookup could resolve,
 * even though the region itself is already cached and findable by name.
 *
 * Everything it reports is derived from the box and the last answer received,
 * so clearing the field empties the list in the same render and a set of
 * results can never be shown against a query it does not answer.
 */
function useRegionSearch(query: string) {
  const [answer, setAnswer] = useState<{
    term: string;
    results: RegionSummary[] | null;
    error: string | null;
  } | null>(null);

  const trimmed = query.trim();
  const tooShort = trimmed.length < MIN_QUERY_LEN;
  const answered = !tooShort && answer?.term === trimmed;

  useEffect(() => {
    if (tooShort) return;

    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const found = await searchRegions(trimmed);
        if (alive) setAnswer({ term: trimmed, results: found, error: null });
      } catch (e: any) {
        if (!alive) return;
        setAnswer({
          term: trimmed,
          results: null,
          error:
            e?.response?.status === 503
              ? 'Place search is busy right now. Try again in a moment.'
              : 'Could not search places. Check your connection and try again.',
        });
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => { alive = false; clearTimeout(timer); };
  }, [trimmed, tooShort]);

  return {
    results: answered ? answer!.results : null,
    searchError: answered ? answer!.error : null,
    /** There is a term to search, and what is on screen does not yet answer it. */
    searching: !tooShort && !answered,
  };
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ZoneAreaScreen() {
  const { colors, themeMode } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();

  const [mode, setMode] = useState<ZoneMode>('radius');
  const [radiusM, setRadiusM] = useState(500);
  const [region, setRegion] = useState<RegionSummary | null>(null);
  const [fetchedOutline, setFetchedOutline] = useState<Region | null>(null);

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
  const { results, searchError, searching } = useRegionSearch(query);

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

  // Matched against the selected region rather than cleared by an effect, so a
  // boundary can never be drawn under a different region's name — switching
  // areas used to keep the old shape on the preview until the new one arrived.
  const outline = region && fetchedOutline?.id === region.id ? fetchedOutline : null;

  // The outline is only needed to draw the preview, so it is fetched after the
  // region is known rather than as part of the settings load.
  useEffect(() => {
    if (!region) return;
    let alive = true;
    getRegion(region.id).then((r) => { if (alive) setFetchedOutline(r); });
    return () => { alive = false; };
  }, [region]);

  // ── Save ───────────────────────────────────────────────────────────────────
  // Everything saves as you touch it, matching the zone-music screen next door.
  async function save(patch: Partial<ZoneState>, revert: () => void) {
    setSaving(true);
    await runBusy(
      () => api.patch('/api/users/zone/', patch),
      () => setSaving(false),
    ).catch((e: any) => {
      revert();
      Alert.alert(
        'Could not save',
        e?.response?.data?.zone_radius?.[0] ??
        e?.response?.data?.zone_region?.[0] ??
        e?.response?.data?.detail ??
        'Please try again.',
      );
    });
  }

  function commitRadius(next: number) {
    const previous = radiusM;
    setRadiusM(next);
    save({ zone_radius: next }, () => setRadiusM(previous));
  }

  function commitMode(next: ZoneMode) {
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
  }

  /** The one way a region is adopted, whether it was traced or searched for.
   *
   * Both routes land here so the save, the mode switch, the revert-on-failure
   * and the cleared error state cannot drift apart between them. */
  function commitRegion(next: RegionSummary) {
    const previous = region;
    setRegion(next);
    setMode('region');
    setLookupError(null);
    // Clearing the box is enough to empty the results — they are derived from
    // it — so there is nothing else to reset here.
    setQuery('');
    setChoices([]);
    setChoicesFor(null);
    save({ zone_mode: 'region', zone_region: next.id }, () => {
      setRegion(previous);
      if (!previous) setMode('radius');
    });
  }

  function clearRegion() {
    const previous = region;
    if (!previous) return;
    // The outline follows the region — it is matched against it, not stored
    // beside it — so dropping the region is all this has to do.
    setRegion(null);
    // Dropping the place has to drop the mode with it. Leaving the server in
    // region mode pointed at the region just cleared would keep the old city
    // on everyone's map while this screen showed nothing chosen.
    setMode('radius');
    save({ zone_mode: 'radius' }, () => {
      setRegion(previous);
      setMode('region');
    });
  }

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
    // The lookup runs in its own function so that its several early exits all
    // land on the `setLocating(null)` below. That used to be a `finally`, which
    // React Compiler cannot compile — it gives up on this whole screen, and the
    // spinner has to stop on every one of those paths or the button sticks.
    await runTrace(level);
    setLocating(null);
  }

  async function runTrace(level: 'city' | 'district') {
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
    }
  }

  const { previewCoords, previewRings, previewViewport } = useZonePreview({
    mapRef, coords, outline, mode, region, radiusM,
  });

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

        <ZonePreview
          mapRef={mapRef}
          themeMode={themeMode}
          mode={mode}
          region={region}
          coords={coords}
          previewCoords={previewCoords}
          previewViewport={previewViewport}
          previewRings={previewRings}
          radiusM={radiusM}
          outline={outline}
        />

        {mode === 'radius' ? (
          <RadiusCard
            radiusM={radiusM}
            saving={saving}
            onChange={setRadiusM}
            onCommit={commitRadius}
          />
        ) : (
          <PlaceCard
            region={region}
            locating={locating}
            saving={saving}
            lookupError={lookupError}
            choices={choices}
            choicesFor={choicesFor}
            query={query}
            results={results}
            searching={searching}
            searchError={searchError}
            coords={coords}
            onClearRegion={clearRegion}
            onTrace={traceMyPlace}
            onPickRegion={commitRegion}
            onQueryChange={setQuery}
          />
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
