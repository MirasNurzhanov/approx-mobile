import { Linking, Platform } from 'react-native';

/** Offline journey estimates and handoff URLs for maps apps.
 * Optional road routing lives in services/routing and is requested explicitly
 * from DirectionsSheet. Provider responses are predictions, not measurements
 * of a person's journeys; calibration applies local corrections to this model.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * The ways of getting somewhere the app offers.
 *
 * Four, matching what Google Maps itself will route: anything we list and it
 * cannot answer is a button that leads to "no route found". `two-wheeler`
 * (Google's scooter mode) is deliberately absent — it only exists in a handful
 * of countries, and a mode that silently degrades to driving in the rest is
 * worse than not offering it.
 */
export type TravelMode = 'drive' | 'walk' | 'bicycle' | 'transit';

/** Display order, which is also frequency order for a city app: most trips are
 *  driven, then walked. Exported so the sheet does not hard-code a list that
 *  could drift out of step with the tables below. */
export const TRAVEL_MODES: readonly TravelMode[] = ['drive', 'walk', 'bicycle', 'transit'];

export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = {
  drive: 'Drive',
  walk: 'Walk',
  bicycle: 'Cycle',
  transit: 'Transit',
};

/**
 * How much this number is worth.
 *
 * The sheet says which one it is showing, every time, because they are three
 * genuinely different claims and a user deciding whether to leave now deserves
 * to know which they are looking at.
 */
export type EstimateSource =
  /** Straight line times the constants at the top of this file. Instant,
   *  offline, and the roughest thing here. */
  | 'model'
  /** The same model, but with the detour and speed this phone has measured
   *  from real routes — see services/travelCalibration. Still offline. */
  | 'calibrated'
  /** Distance and duration from a routing provider, along actual roads. */
  | 'routed';

export interface TravelEstimate {
  mode: TravelMode;
  /** Where the numbers came from. */
  source: EstimateSource;
  /** Great-circle metres between the two points — what the crow flies. */
  directMeters: number;
  /** Metres actually covered, once roads and one-way systems are allowed for. */
  routeMeters: number;
  /** Door to door, including the overheads below. */
  seconds: number;
  /**
   * Whether this mode is a real option over this distance.
   *
   * False does not mean "hide it" — Google may know about a ferry, or the
   * person may genuinely be planning a two-day hike — it means the number
   * beside it would be a fiction, so the row says "too far" instead of
   * quoting nine days to the minute.
   */
  plausible: boolean;
}

// ── Estimating ───────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than the equirectangular approximation: the cheap version
 * is fine over a city and drifts badly at continental range, and a pinned
 * meetup two countries away is a case this has to get right. It is also called
 * at most a handful of times per sheet open, so there is nothing to save.
 */
export function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const toRad = Math.PI / 180;
  const dLat = (to.latitude - from.latitude) * toRad;
  const dLon = (to.longitude - from.longitude) * toRad;
  const lat1 = from.latitude * toRad;
  const lat2 = to.latitude * toRad;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * How much further than the crow the route actually goes.
 *
 * Roads do not run in straight lines, and the amount they don't varies by
 * mode: a pedestrian cuts through a park a car has to drive around, and a bus
 * route that serves three neighbourhoods on the way is longer than either.
 * These are the ratios that fall out of comparing routed to straight-line
 * distance across typical urban trips; they are the single biggest source of
 * error here and the easiest thing to tune if the estimates read short.
 */
const DETOUR: Record<TravelMode, number> = {
  drive: 1.35,
  walk: 1.22,
  bicycle: 1.28,
  transit: 1.45,
};

/**
 * Fixed cost of the mode, in seconds, that has nothing to do with distance.
 *
 * This is the part a naive distance ÷ speed gets most wrong. Driving two
 * blocks does not take twenty seconds: you walk to the car, and you spend
 * longer than you would like parking at the other end. Waiting for a bus is
 * most of a short transit trip. Without these, every mode looks implausibly
 * fast at short range and driving always wins, which is both wrong and the
 * opposite of what the app should nudge toward.
 */
const OVERHEAD_SECONDS: Record<TravelMode, number> = {
  drive: 240,
  walk: 0,
  bicycle: 90,
  transit: 420,
};

/**
 * Effective door-to-door speed in m/s, as breakpoints of route distance.
 *
 * Speed is not constant with distance, and pretending it is fails at both
 * ends. A 1 km drive averages city-centre speed — lights, junctions, a crawl
 * out of a car park. A 60 km drive is mostly highway. Same story for transit:
 * a short hop is all stops, a long one is mostly a train moving.
 *
 * Walking and cycling barely change, and what change there is comes from
 * fatigue and hills rather than infrastructure, so their curves are nearly
 * flat — a slight dip on very short trips (you start slow) and a slight one on
 * very long ones.
 *
 * Interpolated linearly between breakpoints and clamped at both ends; see
 * `speedAt`.
 */
const SPEED_CURVE: Record<TravelMode, readonly (readonly [meters: number, mps: number])[]> = {
  // 16 km/h crawling out of a side street → 80 km/h once it is mostly open
  // road. The 500 m breakpoint is load-bearing: without it a 300 m drive comes
  // out level with the same walk, and this is precisely the range where the
  // sheet should be saying "just walk".
  drive: [[500, 4.5], [1_000, 5.6], [5_000, 8.3], [20_000, 13.9], [60_000, 22.2]],
  // ~4.7 km/h brisk pavement pace, easing off over a long walk.
  walk: [[500, 1.25], [2_000, 1.35], [10_000, 1.2]],
  // ~13 km/h through traffic, ~18 km/h once out of it.
  bicycle: [[1_000, 3.6], [5_000, 4.4], [20_000, 5.0]],
  // 12 km/h of stop-and-go → 45 km/h of rail.
  transit: [[2_000, 3.4], [10_000, 6.5], [50_000, 12.5]],
};

/**
 * Beyond this many route metres, the mode stops being a real answer.
 *
 * Chosen as "nobody does this", not "it is impossible": 25 km is a five-hour
 * walk, which people do on purpose but not to reach a café. Past the limit the
 * estimate is still computed — a caller that wants the number can have it —
 * but `plausible` is false and the UI says so instead of quoting it.
 */
const PLAUSIBLE_LIMIT_M: Record<TravelMode, number> = {
  drive: 3_000_000,
  walk: 25_000,
  bicycle: 120_000,
  transit: 400_000,
};

/**
 * Under this many metres, you have arrived.
 *
 * Roughly the accuracy of a good GPS fix plus the width of a building, so
 * below it "2 minutes' walk" is noise dressed up as information.
 */
export const ARRIVED_METERS = 60;

/** Linear interpolation across the curve, held flat outside its ends. */
function speedAt(mode: TravelMode, meters: number): number {
  const curve = SPEED_CURVE[mode];
  if (meters <= curve[0][0]) return curve[0][1];

  for (let i = 1; i < curve.length; i += 1) {
    const [prevM, prevV] = curve[i - 1];
    const [nextM, nextV] = curve[i];
    if (meters <= nextM) {
      const t = (meters - prevM) / (nextM - prevM);
      return prevV + (nextV - prevV) * t;
    }
  }
  return curve[curve.length - 1][1];
}

/** Baseline factors used both by the offline estimate and route calibration. */
export function modelTravelFactors(directMeters: number, mode: TravelMode): { detour: number; mps: number } {
  const direct = Number.isFinite(directMeters) && directMeters > 0 ? directMeters : 0;
  return { detour: DETOUR[mode], mps: speedAt(mode, direct * DETOUR[mode]) };
}

/**
 * One mode's estimate for a straight-line distance.
 *
 * Note the order: the speed curve is read at the *route* distance, not the
 * direct one, because that is the distance actually being covered — reading it
 * at the crow-flies figure would quote city speeds for a trip that is already
 * on the motorway.
 */
export function estimateTravel(
  directMeters: number,
  mode: TravelMode,
  learned?: { detour: number; mps: number } | null,
): TravelEstimate {
  const safeDirect = Number.isFinite(directMeters) && directMeters > 0 ? directMeters : 0;
  const calibrated = learned && Number.isFinite(learned.detour) && learned.detour >= 1
    && learned.detour <= 10 && Number.isFinite(learned.mps) && learned.mps > 0 && learned.mps <= 80
    ? learned : null;
  const factors = calibrated ?? modelTravelFactors(safeDirect, mode);
  const routeMeters = safeDirect * factors.detour;
  // Calibration evaluates local, distance-banded ratios against the baseline
  // curve before passing these factors, so longer trips still adapt in speed.
  const speed = factors.mps;
  const seconds = routeMeters / speed + OVERHEAD_SECONDS[mode];

  return {
    mode,
    source: calibrated ? 'calibrated' : 'model',
    directMeters: safeDirect,
    routeMeters,
    // Rounded to 30s: quoting "13 min" and "14 min" for two modes whose models
    // differ by a guessed detour factor implies a precision that is not there.
    seconds: Math.round(seconds / 30) * 30,
    plausible: routeMeters <= PLAUSIBLE_LIMIT_M[mode],
  };
}

/** Every mode, in display order, for one pair of points. */
export function estimateAllModes(from: GeoPoint, to: GeoPoint): TravelEstimate[] {
  const direct = haversineMeters(from, to);
  return TRAVEL_MODES.map((mode) => estimateTravel(direct, mode));
}

/**
 * Replace an estimate with what a provider actually measured.
 *
 * The overhead stays. A routing engine times the journey from the first metre
 * of road to the last; it does not know that you have to walk to the car and
 * then find somewhere to leave it at the other end, and those minutes are real
 * — they are most of what makes a short drive not worth taking. So the road
 * part becomes the provider's and the door-to-door part stays ours.
 *
 * `plausible` is recomputed from the real distance, which is the point: a walk
 * that the crow says is 20 km and the pavement says is 26 km should be refused
 * on the 26.
 */
export function withRoutedLeg(
  estimate: TravelEstimate,
  routed: { meters: number; seconds: number },
): TravelEstimate {
  if (!Number.isFinite(routed.meters) || !Number.isFinite(routed.seconds)
    || routed.meters <= 0 || routed.seconds <= 0) return estimate;
  // Gross profile mistakes or corrupt responses must not turn a car route
  // into a walking ETA. Allow small endpoint snaps, but not impossible travel.
  const maxMps: Record<TravelMode, number> = { drive: 80, walk: 5, bicycle: 25, transit: 100 };
  if (routed.meters / routed.seconds > maxMps[estimate.mode]
    || routed.meters + 100 < estimate.directMeters * 0.95) return estimate;
  const seconds = routed.seconds + OVERHEAD_SECONDS[estimate.mode];
  return {
    ...estimate,
    source: 'routed',
    routeMeters: routed.meters,
    seconds: Math.round(seconds / 30) * 30,
    plausible: routed.meters <= PLAUSIBLE_LIMIT_M[estimate.mode],
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * A duration, at the precision the estimate actually supports.
 *
 * Never seconds, and never "1h 0m": both read as measurements when this is a
 * guess. Past a day it degrades to days and hours, because at that range the
 * minutes were never meaningful.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return 'Under a min';

  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} hr` : `${days} d`;
}

/**
 * A distance.
 *
 * Metric by default, because everywhere this app is used is. `imperial` is a
 * parameter rather than a locale lookup so the caller decides — there is no
 * localisation library in this project, and guessing the unit system from a
 * device language is how apps end up quoting miles in Almaty.
 */
export function formatDistance(meters: number, imperial = false): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';

  if (imperial) {
    const feet = meters * 3.28084;
    if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
    const miles = meters / 1609.344;
    return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
  }

  if (meters < 950) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * The clock time you would get there, or null when the trip is long enough
 * that naming an hour would be silly.
 *
 * Twelve hours is the cut: a time of day is useful for "leave now, arrive at
 * 14:20" and misleading for a trip that spans a night's sleep, a border and a
 * meal. `now` is injectable so the estimate can be tested without freezing the
 * clock.
 */
export function arrivalTime(seconds: number, now: Date = new Date()): string | null {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 12 * 3600) return null;
  const at = new Date(now.getTime() + seconds * 1000);
  try {
    return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    // A device with no Intl data still deserves a working sheet.
    return null;
  }
}

// ── Handing the point to a maps app ──────────────────────────────────────────

/** Which app to open. Google Maps everywhere; Apple Maps is offered on iOS
 *  alongside it rather than instead of it, because plenty of iPhone owners use
 *  Google Maps and the reverse is also true. */
export type MapsApp = 'google' | 'apple';

const GOOGLE_TRAVELMODE: Record<TravelMode, string> = {
  drive: 'driving',
  walk: 'walking',
  bicycle: 'bicycling',
  transit: 'transit',
};

/** Apple's `dirflg`. Cycling is `b` on iOS 14+ where Apple has cycling data
 *  and is ignored elsewhere, which degrades to Apple's own default rather than
 *  to a wrong mode — the reason it is worth passing at all. */
const APPLE_DIRFLG: Record<TravelMode, string> = {
  drive: 'd',
  walk: 'w',
  bicycle: 'b',
  transit: 'r',
};

export interface DirectionsOptions {
  /** Defaults to driving, which is what a bare "Directions" button has always
   *  meant here. */
  mode?: TravelMode;
  /** Which app to aim at. Defaults to Google Maps. */
  app?: MapsApp;
  /**
   * Where to start from.
   *
   * Almost always omitted, and that is the better default: left out, both apps
   * use the phone's own live position, which is more current than anything
   * this app is holding and does not put the user's coordinates in a URL.
   * Passed only when the origin is deliberately not "here".
   */
  origin?: GeoPoint | null;
}

/**
 * The URL for a route, as a plain string.
 *
 * Separated from `openDirections` so it can be tested without stubbing
 * `Linking`, and so a caller that wants to share a link rather than open one
 * has it.
 *
 * Both forms are https universal links rather than custom schemes
 * (`comgooglemaps://`, `maps://`). That is the whole trick to not needing
 * `LSApplicationQueriesSchemes` on iOS or a `<queries>` block on Android: the
 * OS routes an https link to the installed app when there is one, and to the
 * browser when there is not. A custom scheme would need a native config change
 * — and therefore a new build — to even ask whether the app is there.
 */
export function directionsUrl(
  destination: GeoPoint,
  { mode = 'drive', app = 'google', origin = null }: DirectionsOptions = {},
): string {
  const dest = `${destination.latitude},${destination.longitude}`;
  const from = origin ? `${origin.latitude},${origin.longitude}` : null;

  if (app === 'apple') {
    const params = [`daddr=${dest}`, `dirflg=${APPLE_DIRFLG[mode]}`];
    if (from) params.push(`saddr=${from}`);
    return `https://maps.apple.com/?${params.join('&')}`;
  }

  // Google's documented, versioned URL form. `api=1` is what makes it stable —
  // the older `maps?q=` and `maps?daddr=` spellings still work but carry no
  // travel mode, which is the entire point of this function.
  const params = [
    'api=1',
    `destination=${encodeURIComponent(dest)}`,
    `travelmode=${GOOGLE_TRAVELMODE[mode]}`,
  ];
  if (from) params.push(`origin=${encodeURIComponent(from)}`);
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}

/**
 * Open a route to a point in the phone's maps app.
 *
 * The signature keeps its original three positional arguments so the plain
 * "Directions" buttons that predate travel modes still read the same; the
 * options object is additive.
 *
 * `title` is no longer in the URL. It used to be, as a `q=` label, and it was
 * the reason the old form could not carry a travel mode: Google's labelled
 * search URL and its directions URL are different endpoints. Both apps name
 * the destination from their own place data anyway, which is more likely to be
 * right than a title somebody typed into a club chat.
 *
 * Falls back once, to the same link without a mode, and stays quiet after
 * that: a device with no browser and no maps app has nothing this can offer,
 * and an alert about it would be noise on top of a dead end.
 */
export function openDirections(
  latitude: number,
  longitude: number,
  title?: string,
  options: DirectionsOptions = {},
): Promise<void> {
  const url = directionsUrl({ latitude, longitude }, options);
  return Linking.openURL(url).catch(() => {
    const bare = Platform.OS === 'ios'
      ? `https://maps.apple.com/?daddr=${latitude},${longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    return Linking.openURL(bare).then(() => {}, () => {});
  });
}
