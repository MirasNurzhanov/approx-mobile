import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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

import { ScreenHeader } from '@/components/ui/ScreenHeader';
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
  type ZoneType,
  zoneTypeForRegion,
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
  zone_type?: ZoneType;
  zone_radius?: number;
  /** Write-only, and never stored server-side: the fix the "are you in this
   *  place" check should run against. See `saveWithPosition`. */
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  zone_region?: number | null;
  zone_region_detail?: RegionSummary | null;
  /** Whether the zone re-points itself as its owner moves. See the toggle in
   *  `PlaceCard` for what the two settings actually mean to a person. */
  zone_follows_location?: boolean;
  /** Server-set, read-only: the zone wanted to move and had nowhere to go. */
  zone_follow_stale?: boolean;
  zone_active?: boolean;
}

// ─── Position ─────────────────────────────────────────────────────────────────
/** A device fix, with how wrong the device thinks it is. */
interface Fix {
  latitude: number;
  longitude: number;
  /** Metres of reported error. The server widens the containment check by
   *  exactly this, clamped, so a poor fix near a border is not a refusal. */
  accuracy: number | null;
}

/** The device's position, or null when location is off.
 *
 * Never *asks* for permission: this screen is reachable from Settings, and a
 * permission prompt fired by opening a settings page is exactly the ambush the
 * priming layer exists to avoid. Without a fix the preview simply says so.
 *
 * This used to also fire `reportLocation` and hope. The save is validated
 * server-side, and it used to be validated against the position the *server*
 * held — written by a different endpoint on a different schedule — so this
 * pushed a fresh one across and moved on without waiting. That is a race, and
 * it is the one behind "you are not in Әуезов ауданы" shown to somebody
 * standing in Әуезов ауданы: the zone PATCH regularly won.
 *
 * The fix is not to await it. It is that the save now *carries* the position
 * it wants checked, so there is nothing to race — see `saveWithPosition`. The report
 * stays because the map and a following zone both want the server's copy
 * current, but nothing is validated against it any more.
 */
async function currentCoords(): Promise<Fix | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const coords = {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracy: fix.coords.accuracy ?? null,
    };
    // Still best effort, and no longer load-bearing.
    reportLocation(coords, null, coords.accuracy).catch(() => {});
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
  coords: Fix | null;
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
  coords: Fix | null;
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

function PlaceCard({ region, follows, followStale, locating, saving, lookupError, choices, choicesFor, query, results, searching, searchError, coords, onClearRegion, onTrace, onPickRegion, onPickSearched, onToggleFollow, onQueryChange }: {
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
  coords: Fix | null;
  onClearRegion: () => void;
  onTrace: (size: 'city' | 'district') => void;
  follows: boolean;
  followStale: boolean;
  /** Picked from the candidates a trace produced — still "where I am", so it
   *  keeps following. */
  onPickRegion: (region: RegionSummary) => void;
  /** Found by typing a name. A deliberate choice of *this place*, so it pins. */
  onPickSearched: (region: RegionSummary) => void;
  onToggleFollow: (next: boolean) => void;
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

      {region ? (
        <Pressable
          style={styles.followRow}
          onPress={() => onToggleFollow(!follows)}
          disabled={saving}
          accessibilityRole="switch"
          accessibilityLabel="Move my zone with me"
          accessibilityHint={
            'When this is on, your zone changes to whichever '
            + `${region.kind === 'city' ? 'city' : 'area'} you are in.`
          }
          accessibilityState={{ checked: follows, disabled: saving }}
        >
          <Ionicons
            name={follows ? 'checkbox' : 'square-outline'}
            size={20}
            color={follows ? colors.teal : colors.t3}
          />
          <View style={styles.followText}>
            <Text style={styles.followLabel}>Move my zone with me</Text>
            {/* Says what happens, not what the setting is called. The whole
                confusion this fixes is somebody walking across town and not
                realising their zone stayed behind — so the off state has to
                spell out that it does. */}
            <Text style={styles.followHint}>
              {follows
                ? `Your zone becomes whichever ${region.kind === 'city' ? 'city' : 'area'} you move into.`
                : `Your zone stays on ${region.name} even when you leave it.`}
            </Text>
          </View>
        </Pressable>
      ) : null}

      {/* Only while following: a zone that is *pinned* somewhere the user is
          not standing is the setting working as asked, not a problem. */}
      {region && follows && followStale ? (
        <Text style={styles.followStale}>
          Approx could not find an area where you are now, so your zone is still
          on {region.name}. It will move on its own as soon as it finds one.
        </Text>
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
        onPick={onPickSearched}
      />

      <Text style={styles.hint}>
        Your zone follows the real border of the place, however big it is. It can
        only be somewhere you actually are — whether you trace it or find it by
        name, Approx checks that you are inside it before it takes effect.
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
  coords: Fix | null;
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

// ─── Region search/lookup UI ───────────────────────────────────────────────────
// The typed query, the traced candidates, and the error under them: these four
// change as one unit at the two moments that matter — adopting a region clears
// all of it, and starting a fresh trace clears everything but the query —
// while staying independent of the persisted `region`/`mode` setting itself,
// which has its own revert-on-failure path this state never touches.
interface SearchState {
  query: string;
  lookupError: string | null;
  /** Ranked alternatives, when the server would not choose for us. Kept
   *  separate from `useRegionSearch`'s typed-search results even though they
   *  render alike: these are places that provably contain you and were
   *  declined only for lack of confidence, so they carry reasons and never
   *  need the "not where you are" check that a typed search does. */
  choices: RegionCandidate[];
  choicesFor: 'city' | 'district' | null;
}

const initialSearch: SearchState = {
  query: '',
  lookupError: null,
  choices: [],
  choicesFor: null,
};

type SearchAction =
  | { type: 'queryChanged'; query: string }
  /** A trace just started: drop whatever the last one found, but leave the
   *  typed query — tracing and typing are different ways to look, not a reset
   *  of each other. */
  | { type: 'lookupStarted' }
  | { type: 'lookupError'; message: string }
  | { type: 'candidatesFound'; choices: RegionCandidate[]; choicesFor: 'city' | 'district'; message: string }
  /** A region was adopted, whether traced or searched for — the lookup UI has
   *  nothing left to show. */
  | { type: 'regionAdopted' };

function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case 'queryChanged':
      return { ...state, query: action.query };
    case 'lookupStarted':
      return { ...state, lookupError: null, choices: [], choicesFor: null };
    case 'lookupError':
      return { ...state, lookupError: action.message };
    case 'candidatesFound':
      return { ...state, choices: action.choices, choicesFor: action.choicesFor, lookupError: action.message };
    case 'regionAdopted':
      return initialSearch;
  }
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
  /** Whether the zone re-points itself as the user moves. Defaults off, which
   *  matches the server column — a zone nobody has opted in stays where it was
   *  put, so nothing changes under an existing user. */
  const [followsLocation, setFollowsLocation] = useState(false);
  const [followStale, setFollowStale] = useState(false);
  const [fetchedOutline, setFetchedOutline] = useState<Region | null>(null);

  const [coords, setCoords] = useState<Fix | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /** Which of the two lookup buttons is in flight, so only that one spins. */
  const [locating, setLocating] = useState<'city' | 'district' | null>(null);

  // Search — the way out when tracing finds nothing. `results === null` is the
  // idle state, an empty array is a search that genuinely found nothing, and
  // the two need to look different on screen.
  const [search, dispatchSearch] = useReducer(searchReducer, initialSearch);
  const { results, searchError, searching } = useRegionSearch(search.query);

  const mapRef = useRef<MapView | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  /** Adopt a zone payload into the screen's state.
   *
   * Shared by the initial load and by `commitFollows`, which has to re-read:
   * turning following on re-points the zone server-side, so the response names
   * a region this screen has not heard of yet and the card would otherwise go
   * on displaying the one the user just moved out of. */
  const adoptZone = useCallback((z: ZoneState) => {
    // The screen offers two buttons; the server stores three types. Both
    // polygon types land on the Place tab, and which one it was is
    // recoverable from the region itself, so nothing is lost collapsing
    // them here.
    setMode(z.zone_type !== 'circle' && z.zone_region ? 'region' : 'radius');
    setRadiusM(z.zone_radius && z.zone_radius > 0 ? z.zone_radius : 500);
    if (z.zone_region_detail) setRegion(z.zone_region_detail);
    setFollowsLocation(!!z.zone_follows_location);
    setFollowStale(!!z.zone_follow_stale);
  }, []);

  const refreshZone = useCallback(async () => {
    try {
      const { data } = await api.get<ZoneState>('/api/users/zone/');
      adoptZone(data);
    } catch {
      // The optimistic state on screen is still what was saved; a failed
      // re-read is worth nothing to show and nothing to undo.
    }
  }, [adoptZone]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [zoneRes, position] = await Promise.allSettled([
        api.get<ZoneState>('/api/users/zone/'),
        currentCoords(),
      ]);
      if (!alive) return;

      if (zoneRes.status === 'fulfilled') adoptZone(zoneRes.value.data);
      if (position.status === 'fulfilled' && position.value) setCoords(position.value);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [adoptZone]);

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
  async function save(
    patch: Partial<ZoneState>,
    revert: () => void,
    /** Return true to say the error is dealt with and no alert is wanted. */
    onError?: (data: any) => boolean,
  ) {
    setSaving(true);
    await runBusy(
      () => api.patch('/api/users/zone/', patch),
      () => setSaving(false),
    ).catch((e: any) => {
      revert();
      const data = e?.response?.data;
      if (onError?.(data)) return;
      Alert.alert(
        'Could not save',
        data?.zone_radius?.[0] ??
        data?.zone_region?.[0] ??
        data?.detail ??
        'Please try again.',
      );
    });
  }

  /**
   * A refusal that names the place the user *is* in, offered as a one-tap fix.
   *
   * Without this the error is a dead end: "you do not seem to be inside Әуезов
   * ауданы" tells somebody their choice was wrong and leaves them to work out
   * which of a city's districts is right — which, if you do not know your
   * district's official name, is not something you can work out. The server
   * resolves it from the same fix it just rejected, so the answer is free and
   * exact.
   *
   * Returns whether it handled the error, so `save` knows to skip its alert.
   */
  function offerCorrectPlace(data: any, follows: boolean): boolean {
    const suggestion = data?.you_are_in;
    if (data?.code !== 'outside_region' || !suggestion?.id) return false;
    Alert.alert(
      'That is not where you are',
      `${data?.zone_region?.[0] ?? 'You are not in that place.'}

`
      + `You appear to be in ${suggestion.name}. Use that instead?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Use ${suggestion.name}`,
          onPress: () => {
            // Fetched rather than built from the three fields the error
            // carries: `commitRegion` wants a full summary, and this is the
            // same cache the preview draws its outline from — so the outline
            // is already warm by the time the card renders it.
            getRegion(suggestion.id)
              .then((full) => { if (full) commitRegion(full, follows); })
              .catch(() => {});
          },
        },
      ],
    );
    return true;
  }

  /**
   * Save a zone change, carrying the fix the server should reason from.

   * Used by every path that either names a region or turns following on —
   * both are answers to "where am I", and both used to be resolved server-side
   * against a stored position written by a different endpoint on a different
   * schedule.
   *
   * The server tests "are you in this place" against the coordinates in this
   * request, falling back to its stored copy only for clients too old to send
   * any — so this is what removes the whole class of "the server's position is
   * behind mine". A fresh fix is taken here rather than reusing `coords`,
   * which may be minutes old if the screen has been open: the point is to
   * check against where the user is *now*.
   *
   * With no fix available — location permission off — this sends the change
   * without one and lets the server fall back. That path can still refuse, and
   * it should: without a position there is nothing to prove they are anywhere.
   */
  async function saveWithPosition(patch: Partial<ZoneState>, revert: () => void) {
    const fix = (await currentCoords()) ?? coords;
    if (fix) setCoords(fix);
    await save(
      fix
        ? {
            ...patch,
            latitude: fix.latitude,
            longitude: fix.longitude,
            ...(fix.accuracy != null ? { accuracy: fix.accuracy } : {}),
          }
        : patch,
      revert,
      (data) => offerCorrectPlace(data, !!patch.zone_follows_location),
    );
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
    if (next === 'region') {
      // `zone_type` only — deliberately **not** `zone_region`. The region is
      // not changing here; this tab switch is "go back to the place I already
      // chose", and the server falls back to the stored one when the payload
      // names none.
      //
      // Sending it anyway was how this screen became impossible to use after
      // moving: it re-submitted the old region, the server checked whether the
      // user was still inside it, refused, and the tab snapped back to Radius
      // — so the picker that would have let them choose their new district was
      // unreachable. The server no longer refuses an unchanged region either;
      // both halves are fixed, because either one alone leaves the other free
      // to reintroduce it.
      save({ zone_type: zoneTypeForRegion(region) }, () => setMode(previous));
      return;
    }
    save({ zone_type: 'circle' }, () => setMode(previous));
  }

  /** The one way a region is adopted, whether it was traced or searched for.
   *
   * Both routes land here so the save, the mode switch, the revert-on-failure
   * and the cleared error state cannot drift apart between them. */
  /**
   * @param follows whether the zone should re-point itself as the user moves.
   *
   * Not a setting the user is asked for at this moment — it is read off *how*
   * they chose the place. Tracing, or picking one of the places found around
   * them, is an answer to "where am I"; typing a name is an answer to "which
   * place". The first should follow them and the second should not, and
   * inferring it here means the common path never has to be configured.
   */
  function commitRegion(next: RegionSummary, follows: boolean) {
    const previous = region;
    const previousFollows = followsLocation;
    setRegion(next);
    setFollowsLocation(follows);
    setMode('region');
    // Clearing the query box is enough to empty the search results — they are
    // derived from it — so the reducer resetting the rest of the lookup UI
    // alongside it is all that's needed here.
    dispatchSearch({ type: 'regionAdopted' });
    void saveWithPosition(
      {
        zone_type: zoneTypeForRegion(next),
        zone_region: next.id,
        zone_follows_location: follows,
      },
      () => {
        setRegion(previous);
        setFollowsLocation(previousFollows);
        if (!previous) setMode('radius');
      },
    );
  }

  /** The checkbox on the chosen place.
   *
   * Turning it on re-points the zone server-side straight away — see
   * `ZoneView.patch` — so the response carries the region it landed on and
   * this adopts it rather than leaving the card naming the old one. */
  function commitFollows(next: boolean) {
    const previous = followsLocation;
    setFollowsLocation(next);
    // Through `saveWithPosition`, not `save`: turning this on asks the server
    // to move the zone to where the user is, and without a fix in the request
    // it would resolve that from the stored position — which is the very thing
    // that is behind when somebody has just moved.
    saveWithPosition({ zone_follows_location: next }, () => setFollowsLocation(previous))
      .then(() => refreshZone())
      .catch(() => {});
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
    setFollowStale(false);
    save({ zone_type: 'circle' }, () => {
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
    dispatchSearch({ type: 'lookupStarted' });
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
        dispatchSearch({ type: 'lookupError', message: 'Location is off, so there is nothing to trace. Find your place by name below instead.' });
        return;
      }
      setCoords(position);
      const lookup = await regionForPoint(position.latitude, position.longitude, level);
      if (lookup.region) {
        commitRegion(lookup.region, true);
        return;
      }

      // The server found places that fit but would not choose between them,
      // or found nothing it trusted. Either way it hands back what it saw
      // rather than guessing — a wrong region here is not wrong once, it gets
      // stored and answers for everyone who stands here afterwards.
      if (lookup.candidates.length) {
        dispatchSearch({
          type: 'candidatesFound',
          choices: lookup.candidates,
          choicesFor: level,
          message:
            lookup.outcome === 'ambiguous'
              ? `More than one ${level} fits where you are. Pick the one you mean.`
              : `Nothing here is clearly your ${level}. These are the closest — pick one, or find it by name below.`,
        });
        return;
      }

      if (level === 'district' && lookup.cityName) {
        dispatchSearch({
          type: 'lookupError',
          message: `No district is mapped inside ${lookup.cityName}. Tap “Use my city” to cover all of it, or find it by name below.`,
        });
      } else {
        dispatchSearch({
          type: 'lookupError',
          message: level === 'district'
            ? 'No district is mapped where you are. Try your city, or find it by name below.'
            : 'Nothing mapped covers where you are. Try finding it by name below.',
        });
      }
    } catch (e: any) {
      dispatchSearch({
        type: 'lookupError',
        message: e?.response?.status === 503
          ? 'Place lookups are busy right now. Try again in a moment.'
          : 'Could not find your area right now.',
      });
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
      <ScreenHeader title="Zone Size">
        <View style={[styles.header, { paddingTop: top + 6 }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.t1} />
          </Pressable>
          <Text style={styles.headerTitle}>Zone Size</Text>
          <View style={styles.headerSpacer}>
            {saving ? <ActivityIndicator color={colors.t3} size="small" /> : null}
          </View>
        </View>
      </ScreenHeader>

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
            follows={followsLocation}
            followStale={followStale}
            locating={locating}
            saving={saving}
            lookupError={search.lookupError}
            choices={search.choices}
            choicesFor={search.choicesFor}
            query={search.query}
            results={results}
            searching={searching}
            searchError={searchError}
            coords={coords}
            onClearRegion={clearRegion}
            onTrace={traceMyPlace}
            // Two handlers, one function: a place found *around you* keeps
            // following, a place found *by name* pins. See `commitRegion`.
            onPickRegion={(next) => commitRegion(next, true)}
            onPickSearched={(next) => commitRegion(next, false)}
            onToggleFollow={commitFollows}
            onQueryChange={(query) => dispatchSearch({ type: 'queryChanged', query })}
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

  // ── "Move my zone with me" ──
  followRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
  },
  followText: { flex: 1, gap: 2 },
  followLabel: {
    fontFamily: fonts.body,
    fontSize: type.small,
    fontWeight: '600',
    color: colors.t1,
  },
  followHint: {
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 17,
    color: colors.t3,
  },
  /** Not `error` red. Being unable to find an area is an ordinary gap in
   *  OpenStreetMap's coverage, not something the user did wrong, and the zone
   *  is still working — orange would say otherwise. */
  followStale: {
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 17,
    color: colors.t2,
    backgroundColor: colors.surface2,
    borderRadius: themeRadius.m,
    padding: 10,
  },

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
