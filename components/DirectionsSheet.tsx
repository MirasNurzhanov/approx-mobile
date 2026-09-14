import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import {
  IconBike,
  IconCar,
  IconClose,
  IconLocate,
  IconPin,
  IconTransit,
  IconWalk,
  type IconComponent,
} from '@/components/ui/icons';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useTravelEstimates } from '@/hooks/useTravelEstimates';
import {
  TRAVEL_MODES,
  TRAVEL_MODE_LABEL,
  arrivalTime,
  formatDistance,
  formatDuration,
  openDirections,
  type TravelEstimate,
  type TravelMode,
} from '@/services/directions';
import { canStillPrompt, openAppSettings, request } from '@/services/permissions';
import { routingProviders } from '@/services/routing';

/** Compare offline travel estimates before opening a maps app. Local route
 * calibration refines the initial model. A separate road-check button discloses
 * the configured providers and enables supported online modes for this target.
 * Each row states its own source, including when only some modes are routed.
 */
export interface DirectionsTarget {
  latitude: number;
  longitude: number;
  /** What the place is called. Shown as the subtitle; never sent in the URL —
   *  see `openDirections`. */
  title: string;
  /** The named place under the point, when there is one and it differs. */
  placeName?: string;
  /**
   * The destination is a ~500m area rather than a point (a Swift by a creator
   * who shares approximately). Worth saying: the times are to the middle of a
   * circle, and the last few minutes of the trip are guesswork.
   */
  approximate?: boolean;
}

interface Props {
  visible: boolean;
  target: DirectionsTarget;
  onClose: () => void;
}

const MODE_ICON: Record<TravelMode, IconComponent> = {
  drive: IconCar,
  walk: IconWalk,
  bicycle: IconBike,
  transit: IconTransit,
};

/**
 * Under this far, walking is the assumed answer.
 *
 * A kilometre and a half is fifteen to twenty minutes on foot — the range
 * where opening a car navigation app is the wrong reflex. Above it the default
 * goes back to driving. This only sets the *initial* selection; the moment the
 * user touches a mode, their choice stands for the rest of the sheet.
 */
const WALKABLE_METERS = 1_500;

function defaultMode(estimates: TravelEstimate[] | null): TravelMode {
  if (!estimates) return 'drive';
  const walk = estimates.find((e) => e.mode === 'walk');
  return walk && walk.plausible && walk.routeMeters <= WALKABLE_METERS ? 'walk' : 'drive';
}

export function DirectionsSheet({ visible, target, onClose }: Props) {
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible={visible} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={onClose}>
      <DirectionsContent key={`${visible}:${target.latitude}:${target.longitude}`}
        visible={visible} target={target} onClose={onClose} />
    </Modal>
  );
}

function DirectionsContent({ visible, target, onClose }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();
  const [online, setOnline] = useState(false);
  const providers = routingProviders();
  const providerNames = [...new Set(providers.map(provider => provider.hostname))].join(', ');

  const { status, permission, directMeters, estimates, arrived, refresh, refining } =
    useTravelEstimates(target, visible, online);

  // An explicit choice belongs to this open destination. Until then, derive
  // the default from the latest estimates without a second render.
  const [chosenMode, setChosenMode] = useState<TravelMode | null>(null);
  const mode = chosenMode ?? defaultMode(estimates);

  const selected = estimates?.find((e) => e.mode === mode) ?? null;
  const subtitle = target.placeName && target.placeName !== target.title
    ? target.placeName
    : target.title;

  function pick(next: TravelMode) {
    setChosenMode(next);
  }

  function open(app: 'google' | 'apple') {
    void openDirections(target.latitude, target.longitude, target.title, { mode, app });
    onClose();
  }

  async function enableLocation() {
    // Blocked or restricted: the OS will not show a dialog again, so offering
    // one would be a button that does nothing. Settings is the only door.
    if (permission && !canStillPrompt(permission)) {
      openAppSettings();
      return;
    }
    // Primed by the sheet itself — the person tapped a control on a panel that
    // says, in the line above it, what the location is for and what they get.
    // That is the standard this app holds requests to; see PermissionPrimer.
    await request('location');
    refresh();
  }

  return (
      <View style={styles.root} accessibilityViewIsModal>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />

        <View style={styles.sheet}>
          <ScrollView style={styles.sheetScroll} bounces={false}
            contentContainerStyle={[styles.sheetContent, { paddingBottom: bottom + 20 }]}>
          <View style={styles.grabRow}><View style={styles.handle} /></View>

          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
                Directions
              </Text>
              <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <IconClose size={16} color={colors.t2} />
            </Pressable>
          </View>

          <OriginRow
            status={status}
            permission={permission}
            directMeters={directMeters}
            arrived={arrived}
            colors={colors}
            styles={styles}
            onEnable={enableLocation}
            onRetry={refresh}
          />

          {/* The modes. Present in every state, including the ones with no
              times: the choice still changes which route Google Maps opens
              with, so a person without location permission can still say "walk
              me there" and get a walking route. */}
          <View style={styles.modeList}>
            {TRAVEL_MODES.map((m) => (
              <ModeRow
                key={m}
                mode={m}
                estimate={estimates?.find((e) => e.mode === m) ?? null}
                selected={m === mode}
                arrived={arrived}
                colors={colors}
                styles={styles}
                onPress={() => pick(m)}
              />
            ))}
          </View>

          <View style={styles.footnotes}>
            {providers.length > 0 && estimates && !arrived ? <>
              <Text style={styles.footnote}>
                {online ? 'Road requests share' : 'Checking road routes shares'} your current location and this destination with {providerNames}.
                {' '}Available for {providers.map(provider => TRAVEL_MODE_LABEL[provider.mode]).join(', ')}.
              </Text>
              {!online && <Button label="Check road routes" variant="secondary" size="md" fullWidth
                accessibilityLabel="Check road routes" onPress={() => setOnline(true)} />}
            </> : null}
            {estimates ? (
              <Text style={styles.footnote}>
                {sourceNote(estimates)}
                {refining ? ' Still checking the roads…' : ''}
              </Text>
            ) : null}
            {target.approximate ? (
              <Text style={styles.footnote}>
                This place is shared as an area, not an exact spot, so the last
                few minutes are a guess.
              </Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            <Button
              label="Open in Google Maps"
              variant="primary"
              size="md"
              fullWidth
              onPress={() => open('google')}
              accessibilityLabel={
                `Open ${TRAVEL_MODE_LABEL[mode].toLowerCase()} directions to ${target.title} in Google Maps`
              }
            />
            {/* iOS only, and second. Plenty of iPhone owners navigate with
                Google Maps, so it stays the primary on both platforms; Apple
                Maps is offered because on iOS it is the one that is definitely
                installed. */}
            {Platform.OS === 'ios' ? (
              <Button
                label="Apple Maps"
                variant="secondary"
                size="md"
                fullWidth
                onPress={() => open('apple')}
                accessibilityLabel={
                  `Open ${TRAVEL_MODE_LABEL[mode].toLowerCase()} directions to ${target.title} in Apple Maps`
                }
              />
            ) : null}
          </View>

          {/* Kept last and quiet: it matters, but it is reassurance rather than
              instruction, and it should not be the thing between the times and
              the button. */}
          <Text style={styles.privacy}>
            {online
              ? 'Offline estimates remain available if a road route cannot be found.'
              : 'Estimates are calculated on this phone. Coordinates are shared only when you check road routes or open a maps app.'}
            {selected && selected.plausible && !arrived ? ` Journey time: about ${formatDuration(selected.seconds)}.` : ''}
          </Text>
          </ScrollView>
        </View>
      </View>
  );
}

/** The strip under the header: how far away it is, or why we cannot say. */
function OriginRow({
  status, permission, directMeters, arrived, colors, styles, onEnable, onRetry,
}: {
  status: ReturnType<typeof useTravelEstimates>['status'];
  permission: ReturnType<typeof useTravelEstimates>['permission'];
  directMeters: number | null;
  arrived: boolean;
  colors: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
  onEnable: () => void;
  onRetry: () => void;
}) {
  if (status === 'locating' || status === 'idle') {
    return (
      <View style={styles.originRow}>
        <ActivityIndicator size="small" color={colors.teal} />
        <Text style={styles.originText}>Working out where you are…</Text>
      </View>
    );
  }

  if (status === 'denied') {
    const blocked = permission !== null && !canStillPrompt(permission);
    return (
      <View style={styles.originRow}>
        <IconLocate size={15} color={colors.t3} />
        <Text style={styles.originText}>
          Turn on location to see how long it takes to get here.
        </Text>
        <Pressable
          onPress={onEnable}
          hitSlop={8}
          style={({ pressed }) => [pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={blocked ? 'Open settings' : 'Allow location access'}
        >
          <Text style={styles.originAction}>{blocked ? 'Settings' : 'Allow'}</Text>
        </Pressable>
      </View>
    );
  }

  if (status === 'unavailable') {
    return (
      <View style={styles.originRow}>
        <IconLocate size={15} color={colors.t3} />
        <Text style={styles.originText}>Couldn’t get a fix on where you are.</Text>
        <Pressable
          onPress={onRetry}
          hitSlop={8}
          style={({ pressed }) => [pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={styles.originAction}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.originRow}>
      <IconPin size={15} color={colors.teal} />
      <Text style={styles.originText}>
        {arrived
          ? 'You’re already here.'
          : `${formatDistance(directMeters ?? 0)} away in a straight line`}
      </Text>
    </View>
  );
}

function ModeRow({
  mode, estimate, selected, arrived, colors, styles, onPress,
}: {
  mode: TravelMode;
  estimate: TravelEstimate | null;
  selected: boolean;
  arrived: boolean;
  colors: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
  onPress: () => void;
}) {
  const Icon = MODE_ICON[mode];
  const label = TRAVEL_MODE_LABEL[mode];

  // Three ways a row can read, in the order they take precedence:
  //   already there   → no time, because there is no journey
  //   too far to do   → say that, rather than quote nine days to the minute
  //   a real estimate → duration, and the clock time it lands at
  let headline: string | null = null;
  let detail: string | null = null;
  let dim = false;

  if (arrived) {
    headline = '—';
    detail = 'You’re here';
    dim = true;
  } else if (estimate && !estimate.plausible) {
    headline = 'Too far';
    detail = `${formatDistance(estimate.routeMeters)} by this route`;
    dim = true;
  } else if (estimate) {
    headline = formatDuration(estimate.seconds);
    const at = arrivalTime(estimate.seconds);
    detail = at
      ? `${formatDistance(estimate.routeMeters)} · arrive ${at}`
      : formatDistance(estimate.routeMeters);
  }

  const source = estimate?.source === 'routed' ? 'Road route'
    : estimate?.source === 'calibrated' ? 'Calibrated estimate' : 'Modelled estimate';
  const spoken = headline && detail
    ? `${label}, about ${headline}, ${detail}, ${source}`
    : `${label} directions`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeRow,
        selected && styles.modeRowSelected,
        pressed && styles.pressed,
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={spoken}
    >
      <View style={[styles.modeGlyph, selected && styles.modeGlyphSelected]}>
        <Icon size={20} color={selected ? colors.teal : colors.t2} />
      </View>

      <View style={styles.modeName}>
        <Text style={[styles.modeLabel, selected && styles.modeLabelSelected]} numberOfLines={1}>{label}</Text>
        {!!estimate && !arrived && <Text style={styles.modeSource}>{source}</Text>}
      </View>

      {headline ? (
        <View style={styles.modeTimes}>
          <Text
            style={[styles.modeDuration, dim && styles.modeDim, selected && !dim && styles.modeDurationSelected]}
            numberOfLines={1}
          >
            {headline}
          </Text>
          {detail ? (
            <Text style={styles.modeDetail} numberOfLines={1}>{detail}</Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

// Summarize mixed sources without implying that every mode was routed.
function sourceNote(estimates: TravelEstimate[]): string {
  const routed = estimates.filter(e => e.source === 'routed').map(e => TRAVEL_MODE_LABEL[e.mode]);
  if (routed.length) {
    return `Road routes for ${routed.join(', ')}. Other modes remain estimates. `
      + 'Times include estimated preparation or parking. Live traffic and transit timetables are not included.';
  }
  if (estimates.some((e) => e.source === 'calibrated')) {
    return 'Estimated from distance, adjusted using previous provider routes in this area and distance range. '
      + 'These are not measurements of your actual journeys. Traffic and closures are not included.';
  }
  return 'Estimated from distance — traffic, timetables and closures are not '
    + `included. ${Platform.OS === 'ios' ? 'The maps app' : 'Google Maps'} has the live version.`;
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  pressed: { opacity: 0.6 },

  sheet: {
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetContent: { paddingHorizontal: 20, gap: 14 },
  grabRow: { alignItems: 'center', paddingTop: 10, paddingBottom: 2 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1, gap: 2 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.title,
    color: colors.t1,
  },
  subtitle: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3 },
  close: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  originRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.m,
    backgroundColor: colors.surface2,
  },
  originText: { flex: 1, fontFamily: fonts.body, fontSize: typography.caption, color: colors.t2 },
  originAction: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: typography.caption,
    color: colors.teal,
  },

  // The whole sheet scrolls so route disclosure and handoff buttons remain
  // reachable on small screens and at large accessibility font sizes.
  modeList: { gap: 8 },

  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  modeRowSelected: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  modeGlyph: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeGlyphSelected: { backgroundColor: colors.surface },
  modeName: { flex: 1, gap: 3 },
  modeSource: { fontFamily: fonts.body, fontSize: 10, color: colors.t3 },
  modeLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  modeLabelSelected: { color: colors.t1 },

  modeTimes: { alignItems: 'flex-end', gap: 2, flexShrink: 1 },
  modeDuration: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: typography.body,
    color: colors.t1,
  },
  modeDurationSelected: { color: colors.teal },
  // t2 rather than t3: at caption size on this surface t3 is 3.1:1 and fails
  // AA — the same reason the nav palette holds its own greys.
  modeDetail: { fontFamily: fonts.body, fontSize: typography.micro, color: colors.t2 },
  modeDim: { color: colors.t3, fontWeight: '600' },

  footnotes: { gap: 6 },
  footnote: {
    fontFamily: fonts.body,
    fontSize: typography.micro,
    lineHeight: 16,
    color: colors.t3,
  },

  actions: { gap: 8 },
  privacy: {
    fontFamily: fonts.body,
    fontSize: typography.micro,
    lineHeight: 16,
    color: colors.t3,
    textAlign: 'center',
  },
});
