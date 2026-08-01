import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import MapView, { Circle, Marker, Polygon, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { navArcClearance, Speedometer } from '@/components/Speedometer';
import { REACTIONS, StoryViewer } from '@/components/StoryViewer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import {
    IconCamera,
    IconClose,
    IconHi,
    IconImage,
    IconList,
    IconLocate,
    IconLocateFixed,
    IconLocateOff,
    IconLock,
    IconPeople,
    IconPin,
    IconSearch,
    IconShield,
    type IconComponent,
} from '@/components/ui/icons';
import { ZonePlayer } from '@/components/ZonePlayer';
import { colors, fonts, radius, type } from '@/constants/theme';
import { announce, useReduceMotion } from '@/hooks/useReduceMotion';
import { api } from '@/services/api';
import { usePermissionPrimer } from '@/components/PermissionPrimer';
import { startBackgroundLocationUpdates } from '@/services/backgroundLocation';
import { atSharingPrecision, reportLocation, type Coordinates } from '@/services/location';
import {
  bindForegroundRefresh,
  check as checkPermission,
  openAppSettings,
  refreshPermissions,
  usePermissionStore,
  type PermissionState,
} from '@/services/permissions';
import { registerNearbyRefresh } from '@/services/nearbyRefresh';
import { motionLabel, presenceLabel, type MotionClass, type Presence } from '@/services/presence';
import { MotionTrail } from '@/components/MotionTrail';
import { PresenceDot } from '@/components/PresenceDot';
import { useMotionTrails } from '@/hooks/useMotionTrails';
import { recordSpeed } from '@/services/ownMotion';
import { getCachedLocationSharing, useLocationSharing } from '@/services/privacy';
import {
    cachedZonePresets,
    fmtRadius,
    loadZonePresets,
    trackTitle,
    type ZonePreset,
} from '@/services/zoneAudio';
import {
    getRegion,
    regionContains,
    toLatLng,
    type Region as ZoneRegion,
    type ZoneMode,
} from '@/services/zoneArea';
import {
    recordOwnStory,
    useStoryArchive,
    type ReactionType,
    type Story,
} from '@/services/stories';

// ─── Types ────────────────────────────────────────────────────────────────────
type Relationship = 'stranger' | 'hi_sent' | 'connected' | 'friend';

interface NearbyUser {
  id: number;
  username: string;
  latitude: number;
  longitude: number;
  relationship: Relationship;
  distance?: number;
  distance_km?: number;
  shared_interests?: string[];
  profile_picture?: string;
  zone_active?: boolean;
  zone_radius?: number;
  /** 'region' means the zone is a real place's border, not a circle — draw
   *  `zone_region_id`'s outline instead of `zone_radius`. */
  zone_mode?: ZoneMode;
  /** Id only: the outline is ~1500 points and this payload is polled every
   *  10s. Resolved through services/zoneArea, which caches per region. */
  zone_region_id?: number | null;
  zone_audio_url?: string;
  /** 'approximate' means the position is snapped to a ~500m cell, so it should
   * be drawn as an area rather than a point that looks exact. */
  location_precision?: 'precise' | 'approximate';
  /** Absent when the viewer is not allowed to see it — which is not the same
   * as offline. Render nothing at all rather than a grey dot. */
  presence?: Presence;
  /** Coarse bucket, friends and connections only. Absent means no trail. */
  motion_class?: MotionClass;
}

/** Only what the owner's own zone circle needs. Their own audio is no longer
 * surfaced on the map — see the zone-detection effect. */
interface SelfZone {
  zone_active: boolean;
  zone_radius: number;
  zone_mode: ZoneMode;
  zone_region_id: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────
// Ring colour carries the relationship, and nothing else does: blue is a
// friend, orange is a connection, teal is a matched stranger. One colour per
// state, used on the marker, in the sheet and on the zone.
const COLOR_FRIEND    = colors.blue;
const COLOR_CONNECTED = colors.orange;
const COLOR_STRANGER  = colors.teal;

/** Matches APPROX_GRID_M on the server. */
const APPROX_RADIUS_M = 500;

/** Stranger marker: a point of light, not a pin. Small on purpose — a stranger
 *  is a dot with no name and no face, so the marker should not imply it is
 *  hiding a card behind it. */
const DOT_CORE = 14;
const DOT_HALO = 30;


/**
 * Marker draw order.
 *
 * Self sits at the *bottom*. It is the biggest thing on the map — a 54 px halo
 * — and at the default zoom (~2 m per pixel) that covers everyone within about
 * 50 m of you. Drawing it on top meant a stranger standing right next to you
 * was hidden behind your own marker until you zoomed in far enough to pull the
 * two apart. You always know where you are; the map is for everyone else.
 */
const Z_SELF = 1;
const Z_STRANGER = 4;
const Z_FRIEND = 5;
/** Above the people it stands in for: while a pile is collapsed, the badge is
 *  the only thing there is to hit. */
const Z_CLUSTER = 6;
const Z_STORY = 7;

const REL_LABEL: Record<Relationship, string> = {
  stranger:  'Nearby',
  hi_sent:   'Hi Sent',
  connected: 'Connected',
  friend:    'Friend',
};

const POLL_MS            = 10_000;
const STORY_POLL_MS      = 10_000;
/** How still the camera must be before the marker layout reacts to a new zoom. */
const ZOOM_SETTLE_MS     = 220;

// Neutral dark map per the redesign: tonal grays only, muted labels, no accent color.
const DARK_MAP_STYLE = [
  { elementType: 'geometry',                    stylers: [{ color: '#0E0E11' }] },
  { elementType: 'labels.text.fill',            stylers: [{ color: '#5E5E68' }] },
  { elementType: 'labels.text.stroke',          stylers: [{ color: '#0A0A0B' }] },
  { featureType: 'road', elementType: 'geometry',              stylers: [{ color: '#1A1A20' }] },
  { featureType: 'road', elementType: 'geometry.stroke',       stylers: [{ color: '#16161B' }] },
  { featureType: 'road', elementType: 'labels.text.fill',      stylers: [{ color: '#5E5E68' }] },
  { featureType: 'road.highway', elementType: 'geometry',      stylers: [{ color: '#1A1A20' }] },
  { featureType: 'water', elementType: 'geometry',             stylers: [{ color: '#0A0A0D' }] },
  { featureType: 'water', elementType: 'labels.text.fill',     stylers: [{ color: '#5E5E68' }] },
  { featureType: 'poi', elementType: 'geometry',               stylers: [{ color: '#101312' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'geometry',           stylers: [{ color: '#16161B' }] },
  { featureType: 'administrative', elementType: 'geometry',         stylers: [{ color: '#1A1A20' }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#5E5E68' }] },
];
/** How far the sheet travels to get off screen — not its height, which sizes
 *  to content. Raised from 400 when the zone player moved into the card: a
 *  friend broadcasting a track makes the tallest card the sheet holds, and a
 *  travel distance shorter than the card leaves a sliver of it on screen. */
const SHEET_H   = 560;
const SPRING_CFG = { damping: 22, stiffness: 220, mass: 0.9 };

// ── Locate control ──
/** Street-level, close enough to tell which side of the road you're on. */
const FOCUS_DELTA = 0.006;
/** Long enough to read as travel between two places rather than a cut. */
const RECENTER_MS = 450;
const LOCATE_SIZE = 48;   // ≥ 44pt target
const LOCATE_INSET = 20;  // matches the top bar's horizontal padding
/**
 * How old the last fix may be before recentering re-reads it rather than
 * trusting it. The watcher only fires every 10m, so a still user's fix is old
 * and correct — age is not shown as staleness anywhere, it only decides
 * whether to ask the OS again first. Coming back from a long backgrounding is
 * the case this exists for: the alternative is confidently centring on where
 * the phone was an hour ago.
 */
const STALE_FIX_MS = 30_000;

// Muted avatar hues from the redesign (hue1–hue6), dark text on top.
const AVATAR_COLORS = ['#7FB8A4', '#A48FD1', '#C9A06B', '#8FA9D1', '#C98A8A', '#9BBF7F'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function avatarBgColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + (hash << 5) - hash;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function fmtDistance(m?: number): string | null {
  if (m == null) return null;
  return m < 1000 ? `${Math.round(m)} m away` : `${(m / 1000).toFixed(1)} km away`;
}

// ─── Overlapping markers ──────────────────────────────────────────────────────
/**
 * People standing together are, on the map, one marker with the others hidden
 * underneath it — and because the owner's marker is drawn *below* everyone
 * else's on purpose (see Z_SELF), the one that disappears is you.
 *
 * Neither draw order nor marker size can fix that: at the same coordinate,
 * something has to be on top. So markers that collide on screen are fanned out
 * around the spot they share, and a leader line runs from each one back to it.
 * The fan is measured in pixels, not metres, so it separates by the same amount
 * at every zoom — and the lines are what keep it honest, since the marker is
 * then a few metres from where its owner actually is.
 *
 * Only markers move. Zones, the approximate-location haze and motion trails are
 * real geography and stay exactly where they are.
 */
const M_PER_DEG = 111_320;

/** Markers whose centres land closer than this are treated as one pile. */
const OVERLAP_PX = 26;
/** Marker footprint the fan has to keep clear between neighbours. */
const MARKER_PX = 44;
/** Clearance from the owner's marker. Measured against its solid 34 px core,
 *  not the 54 px halo — the halo is translucent, so a neighbour sitting over its
 *  edge is still perfectly readable, and using the full halo would push everyone
 *  a further 10 px (20 m at the default zoom) from where they really are. */
const SELF_CLEAR_PX = (34 + MARKER_PX) / 2;
/** The key the owner's own marker is filed under. */
const SELF_KEY = 'self';

/**
 * The hard ceiling on how far the fan may move a marker.
 *
 * The fan is sized in pixels, which is what keeps it legible at every zoom — but
 * a pixel is worth more metres the further you zoom out, so left uncapped the
 * same 39 px nudge becomes a kilometre. Two things break at that point: the
 * marker stops describing where its owner is, and anyone standing inside a sound
 * zone gets pushed outside the circle they are audibly within.
 *
 * So the fan is capped, and when the cap leaves too little room to separate a
 * pile, the pile is drawn as a count instead. Zooming out therefore trades
 * individuals for a number rather than for a fiction.
 */
const FAN_MAX_M = 80;

/**
 * Widest span the layout will reason about, in degrees of latitude.
 *
 * Google Maps will happily zoom out to the whole globe, at which point a pixel
 * is worth tens of kilometres and `SELF_CLEAR_PX` worth of offset lands a badge
 * in another hemisphere — or past the poles, which is an invalid coordinate and
 * takes the native map down with it. Past this the layout stops caring how far
 * out you are: everything is one pile either way.
 */
const MAX_ZOOM_DELTA = 2;

/**
 * Zoom, snapped to √2 steps.
 *
 * The layout only needs a rough idea of how far out the camera is, and a
 * continuous value meant every marker re-rendered on every zoom event Android
 * emitted mid-pinch. Buckets reduce a whole pinch to a handful of updates.
 */
function zoomBucket(latitudeDelta: number): number {
  if (!Number.isFinite(latitudeDelta) || latitudeDelta <= 0) return 0.012;
  const clamped = Math.min(Math.max(latitudeDelta, 0.0005), MAX_ZOOM_DELTA);
  return 2 ** (Math.round(Math.log2(clamped) * 2) / 2);
}

/** Refuse to hand the native map a coordinate it can crash on. */
function isDrawable(p?: GeoPoint | null): p is GeoPoint {
  return (
    !!p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 85 &&
    Math.abs(p.longitude) <= 180
  );
}

interface ZoneArea extends GeoPoint { radius: number }

interface GeoPoint { latitude: number; longitude: number }

function metersPerDegLng(latitude: number): number {
  // Guard the poles: cos(90°) is 0 and would send the offset to infinity.
  return M_PER_DEG * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
}

function offsetByMeters(p: GeoPoint, northM: number, eastM: number): GeoPoint {
  // Clamped: an offset that runs off the top of the world is an invalid
  // coordinate, and the native map does not survive being handed one.
  const latitude = Math.max(-85, Math.min(85, p.latitude + northM / M_PER_DEG));
  return { latitude, longitude: p.longitude + eastM / metersPerDegLng(p.latitude) };
}

/** Flat-earth distance. Over the tens of metres this is used for, the error is
 *  far below the pixel it is being compared against. */
function roughMeters(a: GeoPoint, b: GeoPoint): number {
  const dNorth = (a.latitude - b.latitude) * M_PER_DEG;
  const dEast = (a.longitude - b.longitude) * metersPerDegLng(a.latitude);
  return Math.hypot(dNorth, dEast);
}

export interface FanInput extends GeoPoint { key: string }
export interface FanResult {
  /** Where to draw the marker. Equal to the true point when nothing collided. */
  position: GeoPoint;
  /** True point, when the marker was moved — the leader line's other end. */
  anchor?: GeoPoint;
}
export interface ClusterResult {
  key: string;
  /** How many people the badge stands in for. */
  count: number;
  position: GeoPoint;
  /** Set when the badge had to be moved off the spot it describes. */
  anchor?: GeoPoint;
}
export interface MarkerLayout {
  /** Markers drawn individually, by key. A key that is absent was folded into
   *  a cluster — its owner must not also be drawn. */
  placed: Map<string, FanResult>;
  clusters: ClusterResult[];
}

/**
 * How far a marker at `center` may move without leaving a zone it is inside.
 *
 * A marker `d` metres from the middle of a zone of radius `R` has `R − d` to
 * spare. Being inside someone's sound zone is an audible fact, so a marker that
 * the fan pushed across the circle's edge would contradict what the user can
 * hear. Zones the point is already outside impose nothing.
 */
function fanCapMeters(center: GeoPoint, zones: ZoneArea[]): number {
  let cap = FAN_MAX_M;
  for (const zone of zones) {
    const d = roughMeters(center, zone);
    if (d >= zone.radius) continue;
    cap = Math.min(cap, zone.radius - d);
  }
  return cap;
}

/** Ring radius whose straight-line gap between neighbours is one marker wide.
 *  Sizing by arc length instead looks right but comes out short — a ring of
 *  three lands 36 px apart and still overlaps. */
function ringRadiusPx(count: number): number {
  return count < 2 ? MARKER_PX : MARKER_PX / (2 * Math.sin(Math.PI / count));
}

/**
 * Decide where every marker goes: fanned apart, or replaced by a count.
 *
 * `metersPerPx` converts the pixel thresholds above into map distance at the
 * current zoom, so a fan separates by the same amount on screen however far in
 * you are — and zooming in shrinks how far each marker sits from the truth.
 *
 * Two rules survive every zoom level:
 *
 *  - **The owner never moves.** When a pile contains them they keep their real
 *    position and everyone else rings around it. Your own marker is the one
 *    position on this map you can check against the world outside the phone, and
 *    it is the centre of your own zone — nudging it would put your avatar
 *    off-centre inside your own circle. They are never folded into a count
 *    either: "you" is not a statistic.
 *  - **Nobody is moved further than the cap.** If separating a pile would cost
 *    more than that, the pile becomes one badge with a number on it. That is the
 *    zoomed-out case: a count is true, whereas a fan that flings people across a
 *    neighbourhood — or out of a sound zone they are standing in — is not.
 */
function layoutMarkers(
  points: FanInput[],
  metersPerPx: number,
  zones: ZoneArea[],
): MarkerLayout {
  const placed = new Map<string, FanResult>();
  const clusters: ClusterResult[] = [];
  if (points.length === 0 || !Number.isFinite(metersPerPx) || metersPerPx <= 0) {
    return { placed, clusters };
  }

  /**
   * Badge keys are the rounded centre, not the member list.
   *
   * Keying on membership looked tidier and was the bug: one person walking in or
   * out changed the key, React unmounted the badge and mounted a new one, and a
   * fresh marker re-arms `tracksViewChanges`. Do that repeatedly — which is
   * exactly what a pinch does — and Android is re-rasterizing markers every
   * frame until it runs out of memory. A position key keeps the same badge
   * mounted while the pile stays put.
   */
  const usedKeys = new Set<string>();
  const badgeKey = (center: GeoPoint) => {
    const base = `cluster-${center.latitude.toFixed(4)}-${center.longitude.toFixed(4)}`;
    let key = base;
    for (let i = 2; usedKeys.has(key); i++) key = `${base}-${i}`;
    usedKeys.add(key);
    return key;
  };

  const threshold = OVERLAP_PX * metersPerPx;
  const piles: FanInput[][] = [];
  for (const p of points) {
    const pile = piles.find((group) => group.some((q) => roughMeters(q, p) <= threshold));
    if (pile) pile.push(p);
    else piles.push([p]);
  }

  const keep = (p: FanInput) => {
    placed.set(p.key, { position: { latitude: p.latitude, longitude: p.longitude } });
  };

  for (const pile of piles) {
    if (pile.length === 1) {
      keep(pile[0]);
      continue;
    }

    const self = pile.find((p) => p.key === SELF_KEY);
    const others = self ? pile.filter((p) => p.key !== SELF_KEY) : pile;

    // Ring centre: the owner's exact position when they are in the pile,
    // otherwise the pile's centroid — which keeps a group of other people put
    // when the server re-orders them between polls.
    const center: GeoPoint = self
      ? { latitude: self.latitude, longitude: self.longitude }
      : {
          latitude: pile.reduce((s, p) => s + p.latitude, 0) / pile.length,
          longitude: pile.reduce((s, p) => s + p.longitude, 0) / pile.length,
        };

    if (self) keep(self);

    // With the owner sitting at the centre, the ring also has to clear *them*.
    const wantPx = self
      ? Math.max(SELF_CLEAR_PX, ringRadiusPx(others.length))
      : ringRadiusPx(others.length);
    const wantM = wantPx * metersPerPx;
    const capM = fanCapMeters(center, zones);

    if (wantM > capM) {
      clusters.push({
        key: badgeKey(center),
        count: others.length,
        // A badge stands for a group rather than claiming to be one person's
        // position, so moving it clear of the owner's marker costs nothing —
        // and it has to move, because the owner's marker is staying put.
        position: self ? offsetByMeters(center, SELF_CLEAR_PX * metersPerPx, 0) : center,
        anchor: self ? center : undefined,
      });
      continue;
    }

    const radiusM = wantM;
    others.forEach((p, i) => {
      // Start at the top and go clockwise.
      const angle = (2 * Math.PI * i) / others.length - Math.PI / 2;
      placed.set(p.key, {
        position: offsetByMeters(center, -radiusM * Math.sin(angle), radiusM * Math.cos(angle)),
        anchor: center,
      });
    });
  }

  return { placed, clusters };
}

/**
 * A stranger's distance, as a band plus an approximate figure.
 *
 * Strangers never get an exact number. "90 m away" is a measurement of a person
 * who has not agreed to be measured — and read twice a minute it is enough to
 * walk someone down. The band is the useful part anyway: what a stranger needs
 * to know is whether this is worth crossing the road for.
 */
function distanceBand(m?: number): string | null {
  if (m == null) return null;
  const band = m < 150 ? 'Close' : m < 400 ? 'Nearby' : 'In range';
  const approx = m < 1000
    ? `about ${Math.max(10, Math.round(m / 10) * 10)} m`
    : `about ${(m / 1000).toFixed(1)} km`;
  return `${band} · ${approx}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DotMarker({ coordinate, color, presence, zIndex, onPress }: {
  coordinate: { latitude: number; longitude: number };
  color: string;
  presence?: Presence;
  zIndex?: number;
  onPress?: () => void;
}) {
  // Re-arm tracking briefly when the color changes (friend data arrives after
  // the first nearby fetch), then freeze the rasterized marker again.
  // Presence is in the same bucket: it changes the rasterized bitmap, so it has
  // to re-arm too, but only when it actually flips — not on every poll.
  const online = presence?.is_online;
  const [settling, setSettling] = useState(true);
  useEffect(() => {
    setSettling(true);
    const t = setTimeout(() => setSettling(false), 400);
    return () => clearTimeout(t);
  }, [color, online]);

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={settling}
      zIndex={zIndex}
      onPress={onPress}
    >
      {/* The wrapper is the full halo box rather than the dot with the halo
          bleeding out of it: Android clips marker children to their parent
          when it rasterizes, so anything outside these bounds would vanish. */}
      <View style={styles.dotWrap}>
        {/* Two discs, not one: a wide faint bloom and a tighter brighter one,
            which is what makes the dot read as lit from within rather than as
            a flat circle sitting on the map. */}
        <View style={[styles.dotBloom, { backgroundColor: color }]} />
        <View style={[styles.dotGlow, { backgroundColor: color }]} />
        <View style={[styles.userDot, { backgroundColor: color, shadowColor: color }]} />
        {/* Absent presence renders nothing — PresenceDot returns null — so a
            hidden state never becomes a visible "offline". */}
        <View style={styles.dotPresence}>
          <PresenceDot presence={presence} size={8} haloColor={colors.bg} />
        </View>
      </View>
    </Marker>
  );
}

interface AvatarMarkerProps {
  coordinate: { latitude: number; longitude: number };
  uri?: string;
  username: string;
  ringColor: string;
  size?: number;
  zIndex?: number;
  presence?: Presence;
  motion?: MotionClass;
  /** Shown under the ring. Someone whose face you are allowed to see is someone
   *  whose name you are allowed to see, so the marker says both. */
  caption?: string;
  /** Appended to the caption in the ring colour — "· zone" when they are
   *  broadcasting, which is the one thing worth walking towards. */
  captionTag?: string;
  onPress?: () => void;
}

/** Caption geometry, needed up front: the anchor has to be computed from the
 *  full marker height so the ring — not the whole box — sits on the point. */
const CAPTION_GAP = 5;
const CAPTION_H = 17;

function AvatarMarker({
  coordinate,
  uri,
  username,
  ringColor,
  size = 40,
  zIndex,
  presence,
  motion,
  caption,
  captionTag,
  onPress,
}: AvatarMarkerProps) {
  // Markers rasterize their children: keep tracking until the remote image is
  // drawn, and re-arm briefly when the ring color changes (friend data arrives
  // after the first nearby fetch).
  const [imageReady, setImageReady] = useState(!uri);
  const [imageFailed, setImageFailed] = useState(false);
  const [ringSettling, setRingSettling] = useState(true);

  const online = presence?.is_online;

  useEffect(() => { setImageReady(!uri); setImageFailed(false); }, [uri]);
  useEffect(() => {
    setRingSettling(true);
    const t = setTimeout(() => setRingSettling(false), 400);
    return () => clearTimeout(t);
    // Presence changes the bitmap too, so it re-arms tracking — but keyed on
    // the boolean, not the object, so a poll that returns an equal presence
    // does not re-rasterize every avatar on the map.
  }, [ringColor, online]);

  // The trail is decorative and hidden from assistive tech, so the state it
  // conveys is spelled out here instead — motion must never be carried by the
  // effect alone.
  const label = [username, captionTag, presenceLabel(presence), motionLabel(motion)]
    .filter(Boolean)
    .join(', ');

  const inner = size - 6;

  // With a caption the marker is taller than the ring, and anchoring by the
  // box's centre would float the ring above the point it belongs to. Anchor on
  // the ring's centre instead, expressed as a fraction of the full height.
  const totalH = caption ? size + CAPTION_GAP + CAPTION_H : size;
  const anchorY = (size / 2) / totalH;

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: anchorY }}
      tracksViewChanges={!imageReady || ringSettling}
      zIndex={zIndex}
      accessibilityLabel={label}
      onPress={onPress}
    >
      {/* Column wrapper: Android clips marker children to the parent box when
          it rasterizes, so the caption has to live inside it. */}
      <View style={styles.avatarMarkerWrap}>
        <View style={[styles.avatarMarkerRing, { width: size, height: size, borderRadius: size / 2, borderColor: ringColor }]}>
          {uri && !imageFailed ? (
            <Image
              source={{ uri }}
              style={{ width: inner, height: inner, borderRadius: inner / 2 }}
              onLoad={() => setTimeout(() => setImageReady(true), 250)}
              onError={() => { setImageFailed(true); setImageReady(true); }}
            />
          ) : (
            <View
              style={[
                styles.avatarMarkerFallback,
                { width: inner, height: inner, borderRadius: inner / 2, backgroundColor: avatarBgColor(username) },
              ]}
            >
              <Text style={styles.avatarMarkerInitial}>{username ? username.charAt(0).toUpperCase() : '?'}</Text>
            </View>
          )}
          <View style={styles.markerPresence}>
            <PresenceDot presence={presence} size={10} haloColor={colors.bg} />
          </View>
        </View>

        {caption ? (
          <View style={styles.markerCaption}>
            <Text style={styles.markerCaptionText} numberOfLines={1}>
              {caption}
              {captionTag ? (
                <Text style={[styles.markerCaptionTag, { color: ringColor }]}>{` · ${captionTag}`}</Text>
              ) : null}
            </Text>
          </View>
        ) : null}
      </View>
    </Marker>
  );
}

/**
 * The owner's own marker.
 *
 * Everyone else on this map is either a bare dot or an avatar in a coloured
 * ring, so "me" cannot just be one more of those in a different colour — at a
 * glance it reads as another person standing where you are. It gets the halo
 * idiom every map uses for self instead: a soft disc under a ringed core,
 * which nothing else on this map has, in the same purple as the owner's own
 * zone circle.
 */
function SelfMarker({ coordinate, uri, username }: {
  coordinate: { latitude: number; longitude: number };
  uri?: string;
  username: string;
}) {
  const [imageReady, setImageReady] = useState(!uri);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageReady(!uri); setImageFailed(false); }, [uri]);

  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} zIndex={Z_SELF} tracksViewChanges={!imageReady}>
      <View style={styles.selfHalo}>
        <View style={styles.selfCore}>
          {uri && !imageFailed ? (
            <Image
              source={{ uri }}
              style={styles.selfAvatar}
              onLoad={() => setTimeout(() => setImageReady(true), 250)}
              onError={() => { setImageFailed(true); setImageReady(true); }}
            />
          ) : (
            <View style={[styles.selfAvatar, styles.selfInitialWrap]}>
              <Text style={styles.selfInitial}>
                {username ? username.charAt(0).toUpperCase() : '·'}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Marker>
  );
}

/**
 * What a pile becomes when it cannot be fanned apart — a headcount.
 *
 * Deliberately faceless. A pile at this zoom is usually strangers, and a stack of
 * little avatars would hand out the photos the map withholds until a Hi is
 * mutual. A number gives the one thing worth knowing from this far out — how many
 * people are over there — and tapping goes in for the detail.
 */
function ClusterMarker({ coordinate, count, onPress }: {
  coordinate: { latitude: number; longitude: number };
  count: number;
  onPress?: () => void;
}) {
  // Same reason as DotMarker: freeze the raster, but not before it has drawn.
  const [settling, setSettling] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setSettling(false), 400);
    return () => clearTimeout(t);
  }, [count]);

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={settling}
      zIndex={Z_CLUSTER}
      onPress={onPress}
      accessibilityLabel={`${count} ${count === 1 ? 'person' : 'people'} here. Zoom in to see them.`}
    >
      <View style={styles.clusterWrap}>
        <View style={styles.clusterBloom} />
        <View style={styles.clusterBadge}>
          <IconPeople size={12} color={colors.teal} />
          <Text style={styles.clusterCount}>{count}</Text>
        </View>
      </View>
    </Marker>
  );
}

function StoryBubble({ story, count }: { story: Story; count: number }) {
  const avatarBg = avatarBgColor(story.author.username);

  const reactions = story.reactions ?? {};
  const topReaction = REACTIONS.reduce<{ type: ReactionType; Icon: IconComponent; count: number } | null>(
    (best, { type, Icon }) => {
      const count = reactions[type] ?? 0;
      return count > 0 && (!best || count > best.count) ? { type, Icon, count } : best;
    },
    null,
  );

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={styles.storyCard}>
        {/* The badge is a sibling of the clipped avatar, not a child of it.
            Inside `storyAvatarWrap` — which is a circle with overflow hidden —
            a badge in the corner is cut in half by the curve. */}
        <View style={styles.storyAvatarStack}>
          <View style={styles.storyAvatarWrap}>
            {story.author.profile_picture ? (
              <Image source={{ uri: story.author.profile_picture }} style={styles.storyCardAvatarImg} />
            ) : (
              <View style={[styles.storyCardAvatar, { backgroundColor: avatarBg }]}>
                <Text style={styles.storyCardAvatarText}>{story.author.username.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </View>
          {count > 1 && (
            <View style={styles.storyCountBadge}>
              <Text style={styles.storyCountText}>{count}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.storyCardTail} />
      {topReaction && (
        <View style={styles.storyReactionPill}>
          <topReaction.Icon size={11} color={colors.t2} />
          <Text style={styles.storyReactionText}>{topReaction.count}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Locate control ───────────────────────────────────────────────────────────
type LocateState =
  /** Camera is free — wherever the user last left it. */
  | 'off'
  /** Camera tracks each new fix. */
  | 'following'
  /** No fix yet, or one is being resolved. */
  | 'locating'
  /** No permission, so there is nothing to centre on. */
  | 'unavailable';

/** Written as what tapping does, since that is what changes on activation. */
const LOCATE_LABEL: Record<LocateState, string> = {
  off:         'Center on my location',
  following:   'Following your location, tap to stop',
  locating:    'Finding your location',
  unavailable: 'Location unavailable, tap to find out why',
};

const LOCATE_HINT: Record<LocateState, string | undefined> = {
  off:         'Moves the map to where you are and keeps it there as you move',
  following:   undefined,
  locating:    undefined,
  unavailable: 'Aura does not have permission to use your location',
};

function LocateButton({
  state,
  bottom,
  onPress,
}: {
  state: LocateState;
  bottom: number;
  onPress: () => void;
}) {
  const following = state === 'following';

  // The icon carries the state as a shape — a filled centre when tracking, a
  // slash when unavailable — so following is still legible without the teal.
  const Icon = following ? IconLocateFixed : state === 'unavailable' ? IconLocateOff : IconLocate;
  const tint = following ? colors.teal : state === 'unavailable' ? colors.t3 : colors.t2;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      disabled={state === 'locating'}
      hitSlop={8}
      style={[styles.locateBtn, following && styles.locateBtnActive, { bottom }]}
      accessibilityRole="button"
      accessibilityLabel={LOCATE_LABEL[state]}
      accessibilityHint={LOCATE_HINT[state]}
      // `selected` is what makes a screen reader say "on"/"off" for the two
      // live states. Unavailable is deliberately not `disabled`: it is still
      // the thing you tap to find out why, and disabled controls are skipped.
      accessibilityState={{ selected: following, busy: state === 'locating' }}
    >
      {state === 'locating' ? (
        <ActivityIndicator size="small" color={colors.t2} />
      ) : (
        <Icon size={22} color={tint} />
      )}
    </TouchableOpacity>
  );
}

// ─── Top Bar ─────────────────────────────────────────────────────────────────
function TopBar({
  nearby,
  onPrivacy,
  onSearch,
  onList,
}: {
  nearby: number;
  onPrivacy: () => void;
  onSearch: () => void;
  onList: () => void;
}) {
  const { top } = useSafeAreaInsets();
  return (
    <View style={[styles.topBar, { paddingTop: top + 6 }]}>
      <Text style={styles.topLogoText} accessibilityRole="header">AURA</Text>

      {/* The count is the only part of the map a screen reader can reach, so
          it carries the plural and the unit rather than a bare number. */}
      <View
        style={styles.nearbyBadge}
        accessible
        accessibilityLabel={`${nearby} ${nearby === 1 ? 'person' : 'people'} nearby`}
      >
        <IconPeople size={16} color={colors.t2} />
        <Text style={styles.nearbyBadgeText} importantForAccessibility="no">
          {nearby} nearby
        </Text>
      </View>

      <View style={styles.topSpacer} />

      {/* Markers on a map cannot be focused or read. This is the same data as
          a linear list — the non-visual equivalent of the map itself. */}
      <TouchableOpacity
        onPress={onList}
        activeOpacity={0.7}
        style={styles.iconBtn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="People nearby, list view"
        accessibilityHint="Opens a readable list of everyone shown on the map"
      >
        <IconList size={20} color={colors.t2} />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onSearch}
        activeOpacity={0.7}
        style={styles.iconBtn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Search for people"
      >
        <IconSearch size={20} color={colors.t2} />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onPrivacy}
        activeOpacity={0.7}
        style={styles.iconBtn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Privacy and safety settings"
      >
        <IconShield size={20} color={colors.t2} />
      </TouchableOpacity>
    </View>
  );
}

// The floating zone banner used to live here. It announced "you are in @x's
// zone" over the map and, with autoplay on, had already started their track by
// the time you read it. Both halves are gone: a zone is now something you open
// from the person it belongs to (see UserSheet), and it makes no sound until
// you press play.

// ─── Create Story Modal ───────────────────────────────────────────────────────
interface CreateStoryModalProps {
  visible: boolean;
  onClose: () => void;
  onPost: (text: string, photoUri: string | null) => Promise<void>;
}

function CreateStoryModal({ visible, onClose, onPost }: CreateStoryModalProps) {
  const { bottom } = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const { ensure: ensurePermission, primer } = usePermissionPrimer();

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  async function takePhoto() {
    // Primed, and offers a route into Settings when previously refused —
    // the old alert was a dead end.
    if (!(await ensurePermission('camera'))) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'] as any,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  async function handlePost() {
    if (!text.trim()) {
      Alert.alert('Write something', 'Your story needs some text.');
      return;
    }
    setPosting(true);
    try {
      await onPost(text.trim(), photoUri);
      setText('');
      setPhotoUri(null);
      onClose();
    } catch {
      Alert.alert('Failed to post', 'Please try again.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.createModalBackdrop} onPress={onClose} />
        <View style={[styles.createModalSheet, { paddingBottom: bottom + 20 }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.createModalHeader}>
            <Text style={styles.createModalTitle}>Drop a Story</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <IconClose size={20} color={colors.t3} />
            </TouchableOpacity>
          </View>
          {primer}
          <TextInput
            style={styles.storyInput}
            placeholder="What's happening here?"
            placeholderTextColor="#444"
            value={text}
            onChangeText={(t) => setText(t.slice(0, 280))}
            multiline
            maxLength={280}
            autoFocus
          />
          <Text style={styles.charCount}>{text.length}/280</Text>
          {photoUri ? (
            <View style={styles.photoPreviewContainer}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
              <TouchableOpacity style={styles.removePhotoBtn} onPress={() => setPhotoUri(null)} hitSlop={8}>
                <IconClose size={14} color={colors.t1} />
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.createModalActions}>
            <TouchableOpacity
              style={styles.photoPickBtn}
              onPress={takePhoto}
              activeOpacity={0.75}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Take a photo"
            >
              <IconCamera size={20} color={colors.t2} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.photoPickBtn}
              onPress={pickPhoto}
              activeOpacity={0.75}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Choose a photo from your library"
            >
              <IconImage size={20} color={colors.t2} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.postBtn, (!text.trim() || posting) && { opacity: 0.5 }]}
              onPress={handlePost}
              activeOpacity={0.8}
              disabled={!text.trim() || posting}
            >
              {posting ? (
                <ActivityIndicator color="#0a0a0a" size="small" />
              ) : (
                <Text style={styles.postBtnText}>Post Story</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── User Sheet ───────────────────────────────────────────────────────────────
interface SheetProps {
  user: NearbyUser;
  sheetY: SharedValue<number>;
  onDismiss: () => void;
  onFriendChange: () => void;
  /** Where the viewer is. Needed because being inside a region zone is a
   *  point-in-polygon question, which a scalar distance cannot answer. */
  viewerCoords: { latitude: number; longitude: number } | null;
  /** This user's zone outline when they are in region mode, once resolved. */
  zoneRegion: ZoneRegion | null;
}

function UserSheet({
  user, sheetY, onDismiss, onFriendChange, viewerCoords, zoneRegion,
}: SheetProps) {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  const rel         = user.relationship ?? 'stranger';
  const isFriend    = rel === 'friend';
  const isConnected = rel === 'connected';
  const isHiSent    = rel === 'hi_sent';
  const isStranger  = rel === 'stranger';

  const relRingColor  = isFriend ? colors.blue : isConnected ? colors.orange : colors.t3;
  const relLabelColor = isFriend ? colors.blue : isConnected ? colors.orange : colors.t2;
  const dist          = fmtDistance(user.distance);

  // The sheet stays mounted when tapping straight to another marker, so the
  // sent state must reset per user.
  const [requestSent, setRequestSent] = useState(false);
  useEffect(() => { setRequestSent(false); }, [user.id]);

  function sendFriendRequest() {
    api.post(`/api/friends/request/${user.id}/`)
      .then(() => setRequestSent(true))
      .catch((e) => console.log('[Friend Request] error:', e?.response?.status, JSON.stringify(e?.response?.data)));
  }

  function sendHi() {
    api.post('/api/friends/hi/', { receiver_id: user.id })
      .then(() => onFriendChange())
      .catch((e) => console.log('[Hi] error:', e?.response?.status, JSON.stringify(e?.response?.data)));
    onDismiss();
  }

  function goToMessages() {
    onDismiss();
    router.push({ pathname: '/messages/[id]', params: { id: user.id, username: user.username } });
  }

  function goToProfile() {
    onDismiss();
    router.push({ pathname: '/profile/[id]', params: { id: user.id, username: user.username } });
  }

  // Whether this person's identity is ours to show. Below a mutual Hi there is
  // no name and no face on this card — the map showed a point, and the card has
  // to agree with the map or the point was never really anonymous.
  const identified = isFriend || isConnected;

  // Friends and connections get the real number; a stranger gets a band.
  const distLine = identified ? dist : distanceBand(user.distance);
  const zoneLine = isFriend && user.zone_active ? 'in their sound zone' : null;
  const metaLine = [distLine, zoneLine].filter(Boolean).join(' · ');

  // ── Their zone track ──
  // The server only sends zone_audio_url to viewers allowed to hear it, so a
  // URL here is already permission to play — but permission is not a reason to
  // start. Nothing loads until the play button below is pressed.
  const zoneUrl = isFriend && user.zone_active ? user.zone_audio_url : undefined;
  const zoneRadius = user.zone_radius && user.zone_radius > 0 ? user.zone_radius : 500;
  const distanceM = user.distance ?? (user.distance_km != null ? user.distance_km * 1000 : null);
  // A region zone is a shape, not a distance: someone 3km away can be well
  // inside a city while someone 300m away across the boundary is outside, so
  // the radius comparison would be wrong in both directions.
  const isRegionZone = user.zone_mode === 'region' && !!zoneRegion;
  // What the zone is *called* in the copy below — "800 m" or "Almaty".
  const zoneLabel = isRegionZone ? zoneRegion!.name : fmtRadius(zoneRadius);
  // Unknown position is not "out of range" — a card that refuses to play with
  // no reason it can name is worse than one that plays a track you can hear.
  const insideZone = isRegionZone
    ? (!viewerCoords ||
       regionContains(zoneRegion!, viewerCoords.latitude, viewerCoords.longitude))
    : (distanceM == null || distanceM < zoneRadius);

  // Preset names arrive from the API; until they do, the fallback list stands
  // in and an upload is named after its file either way.
  const [presets, setPresets] = useState<ZonePreset[]>(cachedZonePresets);
  useEffect(() => {
    let alive = true;
    loadZonePresets().then((list) => { if (alive) setPresets(list); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onDismiss} />
      <Animated.View style={[styles.sheet, { paddingBottom: bottom + 16 }, animStyle]}>
        <View style={styles.sheetHandle} />

        {/* Identity row: who, how far, and what they are to you — one line of
            each, read left to right. The old sheet stacked this centred over
            400 px, which pushed the actions below the fold on small screens. */}
        <View style={styles.sheetHead}>
          {identified ? (
            <Avatar
              uri={user.profile_picture}
              name={user.username}
              size="md"
              ringColor={relRingColor}
              presence={user.presence}
            />
          ) : (
            // The marker, enlarged. A stranger is a point of light here too.
            <View style={styles.strangerAvatar}>
              <View style={styles.strangerAvatarGlow} />
              <View style={styles.strangerAvatarCore} />
            </View>
          )}

          <View style={styles.sheetHeadBody}>
            <Text style={styles.sheetName} numberOfLines={1}>
              {identified ? user.username : 'Someone nearby'}
            </Text>
            {metaLine ? (
              <Text style={styles.sheetMeta} numberOfLines={1}>{metaLine}</Text>
            ) : null}
          </View>

          <View style={[styles.relPill, { borderColor: relRingColor }]}>
            <Text style={[styles.relPillText, { color: relLabelColor }]}>
              {REL_LABEL[rel] ?? 'Nearby'}
            </Text>
          </View>
        </View>

        {/* Presence and motion were badges in the meta row and are now a single
            quiet line — still spelled out in words, because the trail on the map
            is decorative and hidden from assistive tech. */}
        {(user.presence || motionLabel(user.motion_class)) && (
          <View style={styles.statusRow}>
            {user.presence && <PresenceDot presence={user.presence} size={8} withText />}
            {motionLabel(user.motion_class) && (
              <Text
                style={styles.statusMotion}
                accessible
                accessibilityLabel={motionLabel(user.motion_class)!}
              >
                {user.motion_class === 'fast' ? 'Moving fast' : 'On the move'}
              </Text>
            )}
          </View>
        )}

        {/* Their zone, on the person it belongs to — the map used to float this
            over everything as a banner, which is how it ended up playing to
            people who had never asked for it. */}
        {zoneUrl && (
          <View style={styles.zoneSection}>
            <Text style={styles.sectionLabel}>Zone music</Text>
            <ZonePlayer
              // Remounts per track, so switching between two friends' cards
              // cannot leave the previous one loaded.
              key={zoneUrl}
              url={zoneUrl}
              title={trackTitle(zoneUrl, presets)}
              subtitle={
                insideZone
                  ? `@${user.username} · inside their ${zoneLabel} zone`
                  : `@${user.username} · ${zoneLabel} zone`
              }
              blockedReason={
                insideZone
                  ? null
                  : `Out of range — step inside their ${zoneLabel} zone to listen`
              }
              accessibilityName={`${user.username}'s zone track`}
            />
            <View style={styles.zoneNote}>
              <IconLock size={12} color={colors.t3} />
              <Text style={styles.zoneNoteText}>
                Audible to their friends only. It stays silent until you press play.
              </Text>
            </View>
          </View>
        )}

        {user.shared_interests && user.shared_interests.length > 0 && (
          <View style={styles.interestsSection}>
            <Text style={styles.sectionLabel}>
              {identified ? 'Shared interests' : 'You both like'}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {user.shared_interests.map((tag, i) => (
                <View key={i} style={styles.chip}>
                  <Text style={styles.chipText}>{tag}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Connections can be promoted to friends right from the map; the
            server rejects friend requests to anyone not connected yet. */}
        {isConnected && (
          <View style={styles.addFriendRow}>
            <Button
              label={requestSent ? 'Friend Request Sent ✓' : 'Add Friend'}
              variant={requestSent ? 'secondary' : 'primary'}
              size="md"
              fullWidth
              disabled={requestSent}
              onPress={sendFriendRequest}
            />
          </View>
        )}

        {/* One decision, then a way out of it. The primary action is wide and
            the dismiss is a square beside it, so the choice a stranger card
            offers reads as "yes, or nothing". */}
        <View style={styles.actions}>
          <View style={styles.actionPrimary}>
            {isStranger && (
              <Button label="Say Hi" variant="primary" size="md" fullWidth onPress={sendHi} />
            )}
            {isHiSent && (
              <Button label="Hi Sent ✓" variant="secondary" size="md" fullWidth disabled />
            )}
            {identified && (
              <Button label="Message" variant="primary" size="md" fullWidth onPress={goToMessages} />
            )}
          </View>
          <View style={styles.actionSecondary}>
            <Button label="Profile" variant="ghost" size="md" fullWidth onPress={goToProfile} />
          </View>
          <Pressable
            onPress={onDismiss}
            style={styles.actionDismiss}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <IconClose size={16} color={colors.t3} />
          </Pressable>
        </View>

        {/* Says out loud what the card is already doing. Someone deciding
            whether to send a Hi is deciding how much of themselves it costs. */}
        {isStranger && (
          <Text style={styles.sheetFootnote}>
            They see the same shared interests — and nothing else about you.
          </Text>
        )}
      </Animated.View>
    </>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function MapScreen() {
  useEffect(() => { console.log('[Map] step 1: component mounted'); }, []);
  const router = useRouter();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
  const [coords, setCoords]           = useState<{ latitude: number; longitude: number } | null>(null);
  const [nearby, setNearby]           = useState<NearbyUser[]>([]);
  const [permState, setPermState]     = useState<PermissionState | null>(null);
  const { ensure: ensurePermission, primer } = usePermissionPrimer();
  const [selectedUser, setSelectedUser] = useState<NearbyUser | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [friendIds, setFriendIds]     = useState<Set<number>>(new Set());
  const [connectionIds, setConnectionIds] = useState<Set<number>>(new Set());
  const [selfProfile, setSelfProfile] = useState<{ username: string; profile_picture?: string } | null>(null);
  const [selfZone, setSelfZone]       = useState<SelfZone | null>(null);
  const [hiToast, setHiToast]           = useState(false);
  const [locationToast, setLocationToast] = useState(false);
  const [stories, setStories]           = useState<Story[]>([]);
  const [storyViewer, setStoryViewer]   = useState<{ stories: Story[] } | null>(null);
  const [createStoryCoord, setCreateStoryCoord] = useState<{ latitude: number; longitude: number } | null>(null);

  const [following, setFollowing]     = useState(false);
  const [locating, setLocating]       = useState(false);

  const coordsRef          = useRef(coords);
  const hiToastTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUserIdRef   = useRef<number | null>(null);
  const mapRef             = useRef<MapView | null>(null);
  /** Last region the map settled on, so recentering can keep the user's zoom
   * instead of snapping back to the default every time they move. */
  const regionRef          = useRef<Region | null>(null);
  /** Viewport, for turning the marker fan's pixel thresholds into map metres.
   *
   * State rather than a ref because the fan is rendered from it — but coarse
   * state: `zoomDelta` only moves when the zoom changes materially, so panning
   * (which never changes latitudeDelta) re-renders nothing, and a pinch
   * re-rasterizes the markers once instead of continuously. */
  const [zoomDelta, setZoomDelta] = useState(() => zoomBucket(0.012));
  const [mapH, setMapH] = useState(0);
  /** Debounce for the above — see onRegionChangeComplete. */
  const zoomSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (zoomSettleRef.current) clearTimeout(zoomSettleRef.current); }, []);
  /** The position the camera was last sent to, so a fix that rounds to the
   * same approximate point doesn't re-issue an animation. */
  const centeredOnRef      = useRef<Coordinates | null>(null);
  /** When `coords` was last measured, not when it was last rendered. */
  const fixAtRef           = useRef(0);
  /** Latest platform speed estimate, in m/s; null when it has none. A ref, not
   * state — it changes on every fix and only the next poll reads it. */
  const speedRef           = useRef<number | null>(null);
  const followingRef       = useRef(false);
  const watchRef           = useRef<Location.LocationSubscription | null>(null);
  const startingWatchRef   = useRef(false);
  coordsRef.current = coords;
  currentUserIdRef.current = currentUserId;
  followingRef.current = following;

  const sheetY = useSharedValue(SHEET_H);
  const reduceMotion = useReduceMotion();

  // ── Location accuracy ──
  // The owner's own view is the easiest place to leak the precise position of
  // someone sharing approximately, so everything drawn for them — the marker,
  // their zone circle, and where the locate button centres — goes through the
  // same rounding the network layer applies. Until the mode is known we draw
  // nothing rather than guess, which is why the map waits on `displayCoords`
  // and not on `coords`.
  const sharing = useLocationSharing();
  const displayCoords = useMemo(
    () => (coords && sharing ? atSharingPrecision(coords, sharing) : null),
    [coords, sharing],
  );

  // ── Location permission, re-read on every foreground ──
  // A grant seen when the map mounted is not a grant now: iOS "Allow Once"
  // lapses the moment the app is backgrounded, and either OS can revoke from
  // Settings while we are suspended. This is the same store Settings →
  // Permissions reads, so the two can't disagree.
  const permissions = usePermissionStore();
  useEffect(() => {
    refreshPermissions(['location']).catch(() => {});
    return bindForegroundRefresh();
  }, []);
  const locationState = permissions.location?.state ?? permState;
  const locationGranted = locationState === 'granted';

  // Stories deleted from the archive screen vanish here immediately instead of
  // waiting for the next poll.
  const { deletedIds } = useStoryArchive();

  // Stories are friends-only: the backend returns everyone nearby, so drop
  // anything not authored by the current user or one of their friends.
  const storiesByAuthor = useMemo(() => {
    const map = new Map<number, Story[]>();
    for (const story of stories) {
      if (deletedIds.has(story.id)) continue;
      const id = Number(story.author.id);
      if (id !== currentUserId && !friendIds.has(id)) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(story);
    }
    return map;
  }, [stories, currentUserId, friendIds, deletedIds]);

  // Interest matching: friends and connections are always visible; strangers
  // only appear when at least one interest is shared. The backend includes
  // the requester in /nearby/, so until our own id is known we can't tell
  // ourselves apart from strangers — render nobody for that moment instead of
  // briefly treating the owner's zone as a locked stranger zone.
  const visibleNearby = useMemo(() => {
    if (currentUserId === null) return [];
    return nearby.filter((u) => {
      const uid = Number(u.id);
      if (uid === currentUserId) return false;
      if (friendIds.has(uid) || connectionIds.has(uid)) return true;
      return (u.shared_interests?.length ?? 0) > 0;
    });
  }, [nearby, currentUserId, friendIds, connectionIds]);

  // Speed trails. Fed from the same list the markers render, so a person who
  // disappears from `visibleNearby` takes their trail history with them.
  const motionTrails = useMotionTrails(visibleNearby);

  /** Outlines for every region zone currently on screen.
   *
   * The nearby payload carries region *ids*; the geometry is fetched once per
   * region and cached across sessions, so a hundred people sharing a city cost
   * one request between them. Held in state rather than read straight from the
   * cache because a fetch that lands must trigger a re-render — otherwise the
   * outline arrives and nothing draws it until the next unrelated poll. */
  const [regionOutlines, setRegionOutlines] = useState<Map<number, ZoneRegion>>(new Map());

  const neededRegionIds = useMemo(() => {
    const ids = new Set<number>();
    if (selfZone?.zone_active && selfZone.zone_mode === 'region' && selfZone.zone_region_id) {
      ids.add(selfZone.zone_region_id);
    }
    for (const u of visibleNearby) {
      if (u.zone_active && u.zone_mode === 'region' && u.zone_region_id) ids.add(u.zone_region_id);
    }
    return ids;
  }, [visibleNearby, selfZone]);

  useEffect(() => {
    let alive = true;
    const missing = [...neededRegionIds].filter((id) => !regionOutlines.has(id));
    if (missing.length === 0) return;

    Promise.all(missing.map((id) => getRegion(id))).then((fetched) => {
      if (!alive) return;
      const landed = fetched.filter((r): r is ZoneRegion => r != null);
      if (landed.length === 0) return;
      setRegionOutlines((prev) => {
        const next = new Map(prev);
        for (const r of landed) next.set(r.id, r);
        return next;
      });
    });
    return () => { alive = false; };
  }, [neededRegionIds, regionOutlines]);

  /** Every live sound zone, so the fan can be held inside the circles people
   *  are audibly standing in. */
  // Region zones are deliberately absent: this constraint exists to stop a
  // fanned marker being flung out of a circle it is standing in, and the fan
  // is capped at tens of metres. No displacement that small can move anyone
  // out of a city, so a polygon has nothing to constrain here.
  const zoneAreas = useMemo<ZoneArea[]>(() => {
    const areas: ZoneArea[] = [];
    if (
      displayCoords && selfZone?.zone_active &&
      selfZone.zone_mode === 'radius' && (selfZone.zone_radius ?? 0) > 0
    ) {
      areas.push({ ...displayCoords, radius: selfZone.zone_radius });
    }
    for (const u of visibleNearby) {
      if (!u.zone_active || u.zone_mode === 'region') continue;
      if (!(u.zone_radius ?? 0) || u.latitude == null || u.longitude == null) continue;
      areas.push({ latitude: u.latitude, longitude: u.longitude, radius: u.zone_radius! });
    }
    return areas;
  }, [visibleNearby, displayCoords, selfZone]);

  /**
   * Where every marker is drawn, and which piles became a count instead.
   *
   * The owner is in the input so a pile containing them is recognised as theirs:
   * they stay put and the pile opens up around them. Before the viewport has
   * been measured this is empty, and everyone falls back to their true point —
   * which is exactly the old behaviour, so the first frame is never wrong.
   */
  const markerLayout = useMemo<MarkerLayout>(() => {
    // latitudeDelta spans the viewport's height, so this is metres per pixel.
    const metersPerPx = mapH > 0 ? (zoomDelta * M_PER_DEG) / mapH : 0;
    if (metersPerPx <= 0) return { placed: new Map(), clusters: [] };

    const points: FanInput[] = [];
    if (displayCoords) {
      points.push({ key: SELF_KEY, latitude: displayCoords.latitude, longitude: displayCoords.longitude });
    }
    for (const u of visibleNearby) {
      if (u.latitude == null || u.longitude == null) continue;
      points.push({ key: `u-${u.id}`, latitude: u.latitude, longitude: u.longitude });
    }
    return layoutMarkers(points, metersPerPx, zoneAreas);
  }, [visibleNearby, displayCoords, zoomDelta, mapH, zoneAreas]);

  /** Marker position for someone, falling back to their true point before the
   *  viewport is measured on the first frame. */
  const posFor = useCallback(
    (key: string, fallback: GeoPoint): GeoPoint =>
      markerLayout.placed.get(key)?.position ?? fallback,
    [markerLayout],
  );

  // Nearby people used to generate alerts from here — "@miras is nearby ·
  // 180m away", "@aisha shares your interests". They no longer do: being
  // somewhere is not an event, and the map already shows who is around. The
  // markers below are the whole of it now.

  const fetchFriends = useCallback(async () => {
    try {
      const r = await api.get<{ friends: { id: number }[]; connections: { id: number }[] }>('/api/friends/list/');
      setFriendIds(new Set(r.data.friends.map((u) => Number(u.id))));
      setConnectionIds(new Set(r.data.connections.map((u) => Number(u.id))));
    } catch {}
  }, []);

  // Zone audio is no longer the map's to play. There is no screen-level sound
  // any more, no autoplay when you cross into someone's circle, and nothing to
  // stop on unmount: a friend's track is loaded by the player inside their card
  // and unloaded when that card closes. Walking into a zone is an invitation,
  // not a command to a stranger's phone speaker.
  //
  // Only the track *names* are fetched here, once, so a friend's card can say
  // "Rain" instead of the URL it came from.
  useEffect(() => { loadZonePresets().catch(() => {}); }, []);

  function handleHiSent() {
    fetchFriends();
    setHiToast(true);
    if (hiToastTimer.current) clearTimeout(hiToastTimer.current);
    hiToastTimer.current = setTimeout(() => setHiToast(false), 1500);
  }

  const fetchStories = useCallback(async () => {
    console.log('[Stories] fetching nearby stories...');
    try {
      const r = await api.get<Story[]>('/api/stories/nearby/');
      const data = r.data;
      console.log('[Stories] received:', data.length, 'stories');
      console.log('[Stories] first story coords:', data[0]?.latitude, data[0]?.longitude);
      console.log('[Stories] after reaction fetch:', JSON.stringify(data.map(s => ({ id: s.id, reactions: s.reactions }))));
      setStories(data);
      data.forEach(s => {
        if (s.image) ExpoImage.prefetch(s.image);
      });
    } catch {}
  }, []);

  function openStoryViewer(authorStories: Story[]) {
    sheetY.value = SHEET_H;
    setSelectedUser(null);
    setStoryViewer({ stories: authorStories });
  }

  async function reactToStory(storyId: number, reaction: ReactionType) {
    try {
      const response = await api.post(`/api/stories/${storyId}/react/`, { reaction: reaction });
      console.log('[Reaction] success:', response.data);
      const applyReaction = <T extends Story>(s: T): T => {
        if (s.id !== storyId) return s;
        const wasActive = s.user_reaction === reaction;
        const updated = { ...s.reactions };
        if (s.user_reaction) updated[s.user_reaction] = Math.max(0, updated[s.user_reaction] - 1);
        if (!wasActive) updated[reaction] = (updated[reaction] ?? 0) + 1;
        return { ...s, reactions: updated, user_reaction: wasActive ? null : reaction };
      };
      setStoryViewer((prev) => prev ? { stories: prev.stories.map(applyReaction) } : prev);
      setStories((prev) => prev.map(applyReaction));
      await fetchStories();
    } catch (error: any) {
      console.log('[Reaction] error:', error.response?.status, JSON.stringify(error.response?.data));
    }
  }

  async function createStory(text: string, photoUri: string | null) {
    const c = createStoryCoord ?? coordsRef.current;
    if (!c) throw new Error('No location');
    const lat = parseFloat(c.latitude.toFixed(6));
    const lng = parseFloat(c.longitude.toFixed(6));
    console.log('[Story] posting story at:', lat, lng);
    console.log('[Story] content:', text);
    const formData = new FormData();
    formData.append('text', text);
    formData.append('content', text);
    formData.append('latitude', String(lat));
    formData.append('longitude', String(lng));
    if (photoUri) {
      formData.append('image', {
        uri: photoUri,
        type: 'image/jpeg',
        name: 'story-image.jpg',
      } as any);
    }
    console.log('[Story] posting with image:', photoUri ? 'yes' : 'no');
    console.log('[Story] formData fields:', text, lat, lng);
    try {
      const response = await api.post('/api/stories/', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      const newStory = response.data;
      console.log('[Story] success:', newStory);
      setStories(prev => [...prev, newStory]);
      recordOwnStory(newStory);
      setTimeout(() => fetchStories(), 500);
    } catch (error: any) {
      console.log('[Story] error:', error.response?.status, JSON.stringify(error.response?.data));
      throw error;
    }
  }

  // Self data is refetched on every focus: a fetch that failed right after
  // login would otherwise never retry (leaving the owner's zone invisible),
  // and changes made in Zone Setup must show up when returning to the map.
  const loadSelf = useCallback(() => {
    console.log('[Map] step 4: loading self (me/profile/zone)');
    api.get<{ id: number; username: string }>('/api/users/me/')
      .then((r) => setCurrentUserId(r.data.id))
      .catch((e: any) => console.log('[Map] /users/me/ error:', e?.response?.status));

    api.get<{ username: string; profile_picture?: string }>('/api/users/profile/')
      .then((r) => setSelfProfile({ username: r.data.username, profile_picture: r.data.profile_picture }))
      .catch(() => {});

    // The zone endpoint answers with either {zone_active, zone_radius, ...} or
    // {active, ...} and may omit the radius — normalize so the owner's circle
    // renders regardless of which shape arrives.
    api.get<Record<string, any>>('/api/users/zone/')
      .then((r) => {
        const d = r.data ?? {};
        const normalized: SelfZone = {
          zone_active: Boolean(d.zone_active ?? d.active ?? false),
          zone_radius: Number(d.zone_radius) > 0 ? Number(d.zone_radius) : 500,
          // `effective_zone_mode`, not the raw one: a region evicted from the
          // cache leaves the stored mode saying 'region' with nothing to draw.
          zone_mode: (d.effective_zone_mode ?? d.zone_mode) === 'region' ? 'region' : 'radius',
          zone_region_id: d.zone_region ?? null,
        };
        console.log('[Zone] self zone:', JSON.stringify(normalized));
        setSelfZone(normalized);
      })
      .catch((e: any) => console.log('[Zone] self zone fetch error:', e?.response?.status));

    fetchFriends();
  }, [fetchFriends]);

  useFocusEffect(useCallback(() => { loadSelf(); }, [loadSelf]));

  /**
   * The one location subscription on this screen. The locate control and
   * follow mode read from it rather than opening a second one — two GPS
   * subscriptions on a screen people leave open is a real battery cost for no
   * extra information.
   *
   * Guarded so it can be called from both the mount effect and the
   * permission-regained effect without ever ending up with two watchers.
   */
  const startWatching = useCallback(async () => {
    if (watchRef.current || startingWatchRef.current) return;
    startingWatchRef.current = true;
    try {
      // Background location is optional and is *not* asked for here. It now
      // lives in Settings → Permissions, where the user can opt in knowingly
      // rather than being ambushed on first launch.
      await startBackgroundLocationUpdates();
      const init = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      console.log('[Map] step 3: location received', init.coords.latitude, init.coords.longitude);
      fixAtRef.current = init.timestamp;
      setCoords({ latitude: init.coords.latitude, longitude: init.coords.longitude });
      recordSpeed(init.coords.speed);
      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        (loc) => {
          fixAtRef.current = loc.timestamp;
          setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          // The platform's own fused speed, which this watcher was already
          // receiving and discarding. Kept in a ref rather than state: it
          // changes on every fix and nothing renders from it directly, so
          // setting state here would re-render the whole map for nothing.
          speedRef.current = loc.coords.speed ?? null;
          recordSpeed(loc.coords.speed);
        },
      );
    } catch (e: any) {
      console.log('[Map] location watch failed:', e?.message);
    } finally {
      startingWatchRef.current = false;
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Primed, not cold. The old code fired the system dialog the instant the
      // map mounted, and then fired the *background* location dialog straight
      // after it — two unexplained prompts back to back, with iOS allowing
      // exactly one chance at each.
      const granted = await ensurePermission('location');
      if (!granted) {
        const info = await checkPermission('location');
        setPermState(info.state);
        return;
      }
      setPermState('granted');
      await startWatching();
    })();

    return () => {
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Permission can come back mid-session — from the locate button's primer, or
  // from the user flipping it in Settings and returning. The subscription died
  // with the revocation, so it has to be re-armed here or follow mode would
  // track a position that never updates again.
  useEffect(() => {
    if (locationGranted) startWatching();
  }, [locationGranted, startWatching]);

  const tick = useCallback(async () => {
    const c = coordsRef.current;
    if (!c) return;

    // Without our own id the nearby list stays hidden (we couldn't filter
    // ourselves out of it), so keep retrying the identity fetch until it lands.
    if (currentUserIdRef.current === null) loadSelf();

    const [, nearbyResult] = await Promise.allSettled([
      // Honours the Location sharing setting; sends nothing when paused.
      // Speed rides along on the same request — the server buckets it into a
      // coarse class and never stores the figure itself.
      reportLocation({ latitude: c.latitude, longitude: c.longitude }, speedRef.current),
      api.get<NearbyUser[]>('/api/proximity/nearby/'),
    ]);

    if (nearbyResult.status === 'fulfilled') {
      const users = nearbyResult.value.data;
      users.forEach((u) => {
        if (u.zone_active || u.zone_radius) {
          console.log('[Map] zone data:', u.username, u.zone_active, u.zone_radius, u.zone_audio_url);
        }
      });
      setNearby(users);
    }
    await fetchFriends();
  }, [fetchFriends, loadSelf]);

  useEffect(() => {
    if (!coords) return;
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [!!coords]); // eslint-disable-line react-hooks/exhaustive-deps

  // Register tick as the global refresh so other screens can trigger it
  useEffect(() => {
    registerNearbyRefresh(tick);
  }, [tick]);

  useEffect(() => {
    fetchStories();
    const id = setInterval(fetchStories, STORY_POLL_MS);
    return () => clearInterval(id);
  }, [fetchStories]);


  // Keep the open sheet in sync with the latest nearby fetch
  useEffect(() => {
    if (!selectedUser) return;
    const fresh = nearby.find((u) => u.id === selectedUser.id);
    if (fresh) setSelectedUser(fresh);
  }, [nearby]);

  // Keep the open story viewer in sync with the latest stories fetch
  useEffect(() => {
    if (!storyViewer) return;
    setStoryViewer((prev) => {
      if (!prev) return prev;
      return { stories: prev.stories.map((s) => stories.find((f) => f.id === s.id) ?? s) };
    });
  }, [stories]);

  function openSheet(user: NearbyUser) {
    setSelectedUser(user);
    sheetY.value = withSpring(0, SPRING_CFG);
  }

  function closeSheet() {
    sheetY.value = withSpring(SHEET_H, SPRING_CFG, (done) => {
      if (done) runOnJS(setSelectedUser)(null);
    });
  }

  // ── Locate / follow ─────────────────────────────────────────────────────────
  //
  // This is a camera control and nothing else. It deliberately never calls
  // reportLocation or tick: a button that made the phone transmit its position
  // would be a way to broadcast location while sharing is paused, which is the
  // one thing pausing is supposed to guarantee. Recentering while paused moves
  // the camera and sends nothing.
  //
  // It also reuses the map's existing watchPositionAsync subscription rather
  // than opening its own. A second GPS subscription on a screen people leave
  // open is a real battery cost for no new information.
  const centerOnSelf = useCallback(
    (target: Coordinates, resetZoom: boolean) => {
      const map = mapRef.current;
      if (!map) return;
      const current = regionRef.current;
      const zoomed = resetZoom || !current;
      centeredOnRef.current = target;
      map.animateToRegion(
        {
          ...target,
          latitudeDelta:  zoomed ? FOCUS_DELTA : current!.latitudeDelta,
          longitudeDelta: zoomed ? FOCUS_DELTA : current!.longitudeDelta,
        },
        // Both platforms treat a zero duration as an instant move, so Reduce
        // Motion gets a real jump rather than a very fast animation.
        reduceMotion ? 0 : RECENTER_MS,
      );
    },
    [reduceMotion],
  );

  // Guarded through a ref, not through the state updater: onPanDrag fires on
  // every frame of a drag, and announcing from inside a setState callback
  // would repeat for each one.
  const stopFollowing = useCallback((reason: 'gesture' | 'tap') => {
    if (!followingRef.current) return;
    followingRef.current = false;
    setFollowing(false);
    announce(
      reason === 'gesture'
        ? 'Stopped following your location, map moved'
        : 'Stopped following your location',
    );
  }, []);

  /**
   * Tapping a headcount goes in far enough to break the pile up.
   *
   * A third of the current span per tap, so a badge over a dense spot can be
   * opened by tapping it again rather than by guessing a zoom level. Following is
   * released first: the camera is being sent where the user chose, and the next
   * position fix would otherwise haul it straight back.
   */
  const zoomToCluster = useCallback(
    (center: { latitude: number; longitude: number }) => {
      const map = mapRef.current;
      if (!map) return;
      stopFollowing('tap');
      const current = regionRef.current;
      const delta = Math.max(0.0015, (current?.latitudeDelta ?? zoomDelta) / 3);
      map.animateToRegion(
        { ...center, latitudeDelta: delta, longitudeDelta: delta },
        reduceMotion ? 0 : RECENTER_MS,
      );
    },
    [reduceMotion, stopFollowing, zoomDelta],
  );

  // Track each new fix while following. The guard matters in approximate mode,
  // where consecutive fixes usually round to the same point and would
  // otherwise re-animate the camera to where it already is.
  useEffect(() => {
    if (!following || !displayCoords) return;
    const last = centeredOnRef.current;
    if (last && last.latitude === displayCoords.latitude && last.longitude === displayCoords.longitude) return;
    centerOnSelf(displayCoords, false);
  }, [following, displayCoords, centerOnSelf]);

  // Losing permission while following leaves the camera locked to a position
  // that will never update again.
  useEffect(() => {
    if (!locationGranted && following) setFollowing(false);
  }, [locationGranted, following]);

  async function explainUnavailable() {
    // The primer already covers both shapes of this: the reason plus the OS
    // dialog while we may still ask, and the reason plus Linking.openSettings()
    // once it has been permanently refused. A second explanation of our own
    // here would only be a worse copy of it.
    if (await ensurePermission('location')) {
      setPermState('granted');
      await refreshPermissions(['location']);
    }
  }

  /** Ask the OS for a fresh fix and feed it into the shared position state. */
  const refreshFix = useCallback(async (): Promise<Coordinates | null> => {
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
      fixAtRef.current = fix.timestamp;
      setCoords(next);
      return atSharingPrecision(next, sharing ?? (await getCachedLocationSharing()));
    } catch {
      return null;
    }
  }, [sharing]);

  function startFollowing(target: Coordinates) {
    centerOnSelf(target, true);
    // Set before the re-render: stopFollowing reads the ref, and onPanDrag can
    // fire a frame ahead of the state update.
    followingRef.current = true;
    setFollowing(true);
    announce('Following your location');
  }

  async function handleLocatePress() {
    if (!locationGranted) {
      explainUnavailable();
      return;
    }
    if (following) {
      stopFollowing('tap');
      return;
    }

    // Move on the fix we already have. The watcher only fires every 10m, so a
    // still user's fix is minutes old and perfectly accurate — blocking on the
    // GPS first made the button do nothing for the second or two a fresh fix
    // takes, which reads as broken.
    if (displayCoords) {
      startFollowing(displayCoords);
      // If it really is old enough to predate a backgrounding, re-read in the
      // background; follow mode moves the camera the moment the fix lands.
      if (Date.now() - fixAtRef.current > STALE_FIX_MS) refreshFix();
      return;
    }

    // Nothing to centre on at all. This is the only case that waits, and it
    // waits rather than falling back to a hardcoded coordinate.
    setLocating(true);
    const target = await refreshFix();
    setLocating(false);
    if (!target) {
      Alert.alert(
        'Can’t find you yet',
        'Aura couldn’t get a location fix. Move somewhere with a clearer view of the sky and try again.',
      );
      return;
    }
    startFollowing(target);
  }

  const locateState: LocateState =
    !locationGranted ? 'unavailable'
    : locating || !displayCoords ? 'locating'
    : following ? 'following'
    : 'off';

  /** The control belongs to the map, not to the states that replace it: over
   * the permission dead end it duplicates the Allow button, and over the
   * full-screen "Locating you…" it is a spinner on top of a spinner. */
  const mapVisible = !(permState && permState !== 'granted') && !!displayCoords;

  // The nav arc spans the full width, so there is no free bottom corner: the
  // button clears whatever height the arc reaches across its own footprint.
  const locateBottom = bottomInset + navArcClearance(LOCATE_INSET, LOCATE_SIZE) + 12;

  const region: Region | undefined = displayCoords
    ? { ...displayCoords, latitudeDelta: 0.012, longitudeDelta: 0.012 }
    : undefined;

  return (
    <View style={styles.container}>
      {permState && permState !== 'granted' ? (
        // An explicit dead end with a way out, rather than a spinner that
        // never resolves or a sentence with no action attached.
        <View style={styles.center} accessible accessibilityRole="alert">
          <Text style={styles.emptyTitle}>The map needs location access</Text>
          <Text style={styles.errorText}>
            {permState === 'blocked'
              ? 'Location is turned off for Aura in system settings. The map can’t show anyone nearby until it’s back on.'
              : 'Aura shows people with shared interests near you right now. Without location there’s nothing to show.'}
          </Text>
          <Pressable
            onPress={async () => {
              if (permState === 'blocked') {
                openAppSettings();
                return;
              }
              if (await ensurePermission('location')) setPermState('granted');
            }}
            style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={
              permState === 'blocked' ? 'Open system settings' : 'Allow location access'
            }
          >
            <Text style={styles.emptyBtnText}>
              {permState === 'blocked' ? 'Open Settings' : 'Allow location'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/nearby')}
            style={({ pressed }) => [styles.emptyLink, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Open the nearby people list instead"
          >
            <Text style={styles.emptyLinkText}>See nearby people as a list</Text>
          </Pressable>
        </View>
      ) : !displayCoords ? (
        <View style={styles.center} accessible accessibilityLabel="Finding your location">
          <ActivityIndicator color={colors.teal} size="large" />
          <Text style={styles.loadingText}>Locating you…</Text>
        </View>
      ) : (
        <MapView
          ref={mapRef}
          onLayout={(e) => {
            console.log('[Map] step 5: map rendering');
            setMapH(e.nativeEvent.layout.height);
          }}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          customMapStyle={DARK_MAP_STYLE}
          initialRegion={region}
          showsUserLocation={false}
          showsMyLocationButton={false}
          rotateEnabled={false}
          pitchEnabled={false}
          // Dragging the map is the user taking the camera back. Follow mode
          // drops out rather than fighting the gesture and snapping away from
          // wherever they just moved to. Pinch-zoom is not a pan, so zooming
          // in on yourself keeps following, the way it does in Google Maps.
          onPanDrag={() => stopFollowing('gesture')}
          onRegionChangeComplete={(r) => {
            regionRef.current = r;
            // Android fires this repeatedly through a continuous pinch, and each
            // pass re-renders every marker on the map. So the layout's zoom is
            // updated once the camera has been still for a moment, and only when
            // it lands in a different bucket — a pinch costs one re-render at the
            // end instead of one per frame, and a pan costs none.
            if (zoomSettleRef.current) clearTimeout(zoomSettleRef.current);
            zoomSettleRef.current = setTimeout(() => {
              const next = zoomBucket(r.latitudeDelta);
              setZoomDelta((prev) => (next === prev ? prev : next));
            }, ZOOM_SETTLE_MS);
          }}
          onLongPress={() => {
            if (!coords) return;
            setCreateStoryCoord(coords);
            setLocationToast(true);
            if (locationToastTimer.current) clearTimeout(locationToastTimer.current);
            locationToastTimer.current = setTimeout(() => setLocationToast(false), 2000);
          }}
        >
          {/* Zones for nearby users — a circle, or the outline of the place
              they picked. A region whose outline has not landed yet draws
              nothing rather than falling back to a circle: a 500m ring where a
              city belongs is a worse answer than a moment's absence. */}
          {visibleNearby
            .filter((u) => u.zone_active && u.latitude != null && u.longitude != null)
            .map((u) => {
              if (u.zone_mode === 'region') {
                const outline = u.zone_region_id ? regionOutlines.get(u.zone_region_id) : null;
                if (!outline) return null;
                return outline.rings.map((ring, i) => (
                  <Polygon
                    key={`zone-${u.id}-${i}`}
                    coordinates={toLatLng(ring)}
                    fillColor="rgba(31,199,182,0.06)"
                    strokeColor="rgba(31,199,182,0.35)"
                    strokeWidth={1.5}
                  />
                ));
              }
              if (!(u.zone_radius ?? 0)) return null;
              return (
                <Circle
                  key={`zone-${u.id}`}
                  center={{ latitude: u.latitude, longitude: u.longitude }}
                  radius={u.zone_radius!}
                  fillColor="rgba(31,199,182,0.08)"
                  strokeColor="rgba(31,199,182,0.35)"
                  strokeWidth={1.5}
                />
              );
            })}

          {/* Own zone */}
          {selfZone?.zone_active && selfZone.zone_mode === 'region' && selfZone.zone_region_id
            ? regionOutlines.get(selfZone.zone_region_id)?.rings.map((ring, i) => (
                <Polygon
                  key={`self-zone-${i}`}
                  coordinates={toLatLng(ring)}
                  fillColor="rgba(139,92,246,0.05)"
                  strokeColor="rgba(139,92,246,0.35)"
                  strokeWidth={1.5}
                />
              ))
            : selfZone?.zone_active && (selfZone.zone_radius ?? 0) > 0 && (
              <Circle
                center={displayCoords}
                radius={selfZone.zone_radius}
                fillColor="rgba(139,92,246,0.07)"
                strokeColor="rgba(139,92,246,0.35)"
                strokeWidth={1.5}
              />
            )}

          {/* Approximate sharers get a haze instead of a precise-looking pin —
              the marker would otherwise imply accuracy the data doesn't have. */}
          {visibleNearby
            .filter((u) => u.location_precision === 'approximate' && u.latitude != null && u.longitude != null)
            .map((u) => (
              <Circle
                key={`approx-${u.id}`}
                center={{ latitude: u.latitude, longitude: u.longitude }}
                radius={APPROX_RADIUS_M}
                fillColor="rgba(244,244,246,0.06)"
                strokeColor="rgba(244,244,246,0.18)"
                strokeWidth={1}
              />
            ))}

          {/* Speed trails, drawn before the markers so they sit underneath and
              read as something the avatar is leaving behind. Only ever built
              from positions already observed — never extrapolated ahead of the
              last known point, which on a 10s poll is already stale. */}
          {Array.from(motionTrails.entries()).map(([id, path]) => (
            <MotionTrail key={`trail-${id}`} path={path} reduceMotion={reduceMotion} />
          ))}

          {/* Leader lines back to the spot a moved marker really occupies.
              Without them the fan would quietly claim that people sitting at
              one table are tens of metres apart. Drawn under the markers. */}
          {[
            ...Array.from(markerLayout.placed.entries()).map(([key, fan]) => ({ key, ...fan })),
            ...markerLayout.clusters,
          ].map((item) =>
            // Both ends validated: a single bad coordinate in a Polyline is
            // enough to bring the native map down.
            item.anchor && isDrawable(item.anchor) && isDrawable(item.position) ? (
              <Polyline
                key={`leader-${item.key}`}
                coordinates={[item.anchor, item.position]}
                strokeColor="rgba(244,244,246,0.28)"
                strokeWidth={1}
                lineDashPattern={[3, 3]}
                zIndex={2}
              />
            ) : null,
          )}

          {visibleNearby.filter((u) => u.latitude != null && u.longitude != null).map((user) => {
            // Absent from `placed` means this person was folded into a headcount
            // badge. Drawing them as well would put two of them on the map.
            const layout = markerLayout.placed.get(`u-${user.id}`);
            if (!layout || !isDrawable(layout.position)) return null;

            const uid = Number(user.id);
            const isFriend = friendIds.has(uid);
            const isConnected = connectionIds.has(uid);
            const color = isFriend ? COLOR_FRIEND : isConnected ? COLOR_CONNECTED : COLOR_STRANGER;
            // Anyone you have a name for gets a face and a name plate — blue
            // ring for a friend, orange for a connection. Strangers stay a lit
            // point: no photo, no name, nothing to screenshot, until the Hi is
            // mutual and they cross into the row above.
            return isFriend || isConnected ? (
              <AvatarMarker
                key={user.id}
                coordinate={layout.position}
                uri={user.profile_picture}
                username={user.username}
                ringColor={color}
                presence={user.presence}
                motion={user.motion_class}
                caption={user.username}
                // A connection has no zone access, so tagging one would be
                // advertising a door they cannot open.
                captionTag={isFriend && user.zone_active ? 'zone' : undefined}
                zIndex={Z_FRIEND}
                onPress={() => openSheet(user)}
              />
            ) : (
              <DotMarker
                key={user.id}
                coordinate={layout.position}
                color={color}
                presence={user.presence}
                zIndex={Z_STRANGER}
                onPress={() => openSheet(user)}
              />
            );
          })}

          {/* Approximate sharers see their own fuzz too. A bare point would
              tell them they are pinned exactly where they stand, which is the
              opposite of what they chose. */}
          {sharing === 'approximate' && (
            <Circle
              center={displayCoords}
              radius={APPROX_RADIUS_M}
              fillColor="rgba(139,92,246,0.06)"
              strokeColor="rgba(139,92,246,0.22)"
              strokeWidth={1}
            />
          )}

          {/* Piles that could not be fanned apart without moving someone too far
              — which is what zooming out does to a pixel-sized fan. A number
              instead, and a tap to go in and see who. */}
          {markerLayout.clusters.filter((c) => isDrawable(c.position)).map((cluster) => (
            <ClusterMarker
              key={cluster.key}
              coordinate={cluster.position}
              count={cluster.count}
              onPress={() => zoomToCluster(cluster.anchor ?? cluster.position)}
            />
          ))}

          {/* Never moved, and never folded into a count. When someone stands
              where you stand, they are the one who gets fanned aside — so this
              marker, and the zone centred on it, stay exactly where you are. */}
          <SelfMarker
            coordinate={posFor(SELF_KEY, displayCoords)}
            uri={selfProfile?.profile_picture}
            username={selfProfile?.username ?? ''}
          />

          {Array.from(storiesByAuthor.entries()).map(([authorId, authorStories]) => {
            const first = authorStories[0];
            return (
              <Marker
                key={`story-author-${authorId}`}
                coordinate={{ latitude: first.latitude, longitude: first.longitude }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
                // Above the people markers, which now claim a zIndex of their
                // own — a bubble is drawn above its point, so it covers nobody.
                zIndex={Z_STORY}
                onPress={() => openStoryViewer(authorStories)}
              >
                <StoryBubble story={first} count={authorStories.length} />
              </Marker>
            );
          })}
        </MapView>
      )}

      {/* Top bar */}
      <TopBar
        nearby={visibleNearby.length}
        onPrivacy={() => router.push('/zone')}
        onSearch={() => router.push('/search')}
        onList={() => router.push('/nearby')}
      />

      {/* User detail sheet — where zone audio lives now. */}
      {selectedUser && (
        <UserSheet
          user={selectedUser}
          sheetY={sheetY}
          onDismiss={closeSheet}
          onFriendChange={handleHiSent}
          viewerCoords={displayCoords ?? null}
          zoneRegion={
            selectedUser.zone_region_id
              ? regionOutlines.get(selectedUser.zone_region_id) ?? null
              : null
          }
        />
      )}

      {/* Full-screen story viewer */}
      {storyViewer && (() => {
        const author = storyViewer.stories[0]?.author;
        const authorId = author ? Number(author.id) : null;
        const replyTo =
          author && authorId !== null && authorId !== currentUserId && friendIds.has(authorId)
            ? { id: authorId, username: author.username }
            : null;
        return (
          <StoryViewer
            stories={storyViewer.stories}
            onClose={() => setStoryViewer(null)}
            onReact={reactToStory}
            replyTo={replyTo}
            currentUserId={currentUserId}
          />
        );
      })()}

      <CreateStoryModal
        visible={createStoryCoord !== null}
        onClose={() => setCreateStoryCoord(null)}
        onPost={createStory}
      />

      {/* Hi sent toast */}
      {hiToast && (
        <View style={[styles.hiToast, { top: topInset + 104 }]} pointerEvents="none">
          <IconHi size={16} color={colors.teal} />
          <Text style={styles.hiToastText}>Hi sent</Text>
        </View>
      )}

      {/* Story location toast */}
      {locationToast && (
        <View style={[styles.hiToast, { top: topInset + 104 }]} pointerEvents="none">
          <IconPin size={16} color={colors.teal} />
          <Text style={styles.hiToastText}>Story will be posted at your current location</Text>
        </View>
      )}

      {primer}

      <Speedometer />

      {/* Locate / follow control.
          Rendered after the nav on purpose. The Speedometer's root is a
          full-width absolutely-positioned View with default pointerEvents and
          elevation 10, so it swallows every touch inside its ~200pt-tall
          rectangle that doesn't land on one of its own tabs — anything drawn
          behind it there is visible but dead. It has to absorb those touches
          (otherwise drags on the opaque arc would pan the map underneath), so
          the button sits above it instead.

          Hidden while a sheet or full-screen overlay owns the screen: the user
          sheet reaches 400pt up with a backdrop over everything below it, so a
          button left there is both covered and unreachable. */}
      {mapVisible && !selectedUser && !storyViewer && createStoryCoord === null && (
        <LocateButton state={locateState} bottom={locateBottom} onPress={handleLocatePress} />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontFamily: fonts.body, color: colors.t3, fontSize: 14 },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 20,
    color: colors.t1,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  errorText: {
    fontFamily: fonts.body,
    color: colors.t2,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  emptyBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.m,
    paddingHorizontal: 28,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 8,
  },
  emptyBtnText: { fontFamily: fonts.body, fontWeight: '700', fontSize: 15, color: colors.bg },
  emptyLink: { paddingVertical: 12, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  emptyLinkText: { fontFamily: fonts.body, fontWeight: '600', fontSize: 14, color: colors.teal },

  // ── Stranger marker: a lit point, no pin and no card ──
  //
  // The box stays DOT_HALO wide whatever the core does — it is also the touch
  // target, and at latitudeDelta 0.012 (~2 m per pixel) a 30 px box is about
  // the smallest thing a thumb can reliably hit among neighbours.
  dotWrap: {
    width: DOT_HALO,
    height: DOT_HALO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Outer bloom: wide and very faint, so a cluster of matched strangers reads
   *  as a lit area before you can pick out the individual points. */
  dotBloom: {
    position: 'absolute',
    width: DOT_HALO,
    height: DOT_HALO,
    borderRadius: DOT_HALO / 2,
    opacity: 0.14,
  },
  /** Inner glow: tight enough to belong to the core rather than to the map. */
  dotGlow: {
    position: 'absolute',
    width: DOT_CORE + 8,
    height: DOT_CORE + 8,
    borderRadius: (DOT_CORE + 8) / 2,
    opacity: 0.3,
  },
  userDot: {
    width: DOT_CORE,
    height: DOT_CORE,
    borderRadius: DOT_CORE / 2,
    // A thin dark rim, not a thick one: the point has to stay a point when it
    // lands on a pale road label.
    borderWidth: 1.5,
    borderColor: colors.bg,
    // iOS only; Android rasterizes the marker and drops it, which is why the
    // bloom above does the same job structurally.
    shadowOpacity: 0.9,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },

  /** Presence badge, pinned to the dot's lower-right so it reads as attached
   * to that person rather than as a second pin beside them. Offset from the
   * halo box's edge, since that is what the badge is positioned against. */
  dotPresence: {
    position: 'absolute',
    right: (DOT_HALO - DOT_CORE) / 2 - 2,
    bottom: (DOT_HALO - DOT_CORE) / 2 - 2,
  },

  /** Same idiom on the avatar markers, where the ring is the parent box. */
  markerPresence: {
    position: 'absolute',
    right: -2,
    bottom: -2,
  },

  // ── Avatar markers: photo/initial core, bg gap, relationship-colored ring ──
  avatarMarkerWrap: { alignItems: 'center' },
  avatarMarkerRing: {
    borderWidth: 2,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Cluster badge: a pile too tight to fan, shown as a headcount ──
  clusterWrap: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Reads as "several people" before the number is even legible. */
  clusterBloom: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.teal,
    opacity: 0.14,
  },
  clusterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.teal,
  },
  clusterCount: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: colors.t1,
  },

  /** Name plate under the ring. Dark chip rather than bare text: over a light
   *  road or a water label, plain white type is unreadable. */
  markerCaption: {
    height: CAPTION_H,
    marginTop: CAPTION_GAP,
    maxWidth: 108,
    paddingHorizontal: 7,
    justifyContent: 'center',
    borderRadius: radius.s,
    backgroundColor: 'rgba(10,10,11,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  markerCaptionText: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: colors.t1,
  },
  markerCaptionTag: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
  },
  avatarMarkerFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarMarkerInitial: {
    fontFamily: fonts.display,
    fontWeight: '600',
    // Tracks the 34 px fallback circle the larger marker leaves behind it.
    fontSize: 15,
    color: colors.bg,
  },

  // ── Self marker: purple halo, bg gap, purple ring — the halo is what makes
  // it read as "me" rather than as another avatar in another colour ──
  selfHalo: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(139,92,246,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfCore: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.purple,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  selfInitialWrap: {
    backgroundColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfInitial: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 12,
    color: colors.bg,
  },

  // ── Top bar (flat, no blur) ──
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 6,
    zIndex: 100,
  },
  topLogoText: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 17,
    color: colors.t1,
    letterSpacing: 17 * 0.22,
  },
  topSpacer: { flex: 1 },
  nearbyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 100,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nearbyBadgeText: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: colors.t2,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Locate control (tonal surface, teal tint while following) ──
  locateBtn: {
    position: 'absolute',
    right: LOCATE_INSET,
    width: LOCATE_SIZE,
    height: LOCATE_SIZE,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    // Above the nav (zIndex 100 / elevation 10). Android orders hit-testing by
    // elevation independently of zIndex, so both are needed for the tap to
    // land — this is the one elevation on the screen, not a stacked shadow.
    zIndex: 110,
    elevation: 12,
  },
  locateBtnActive: {
    backgroundColor: colors.tealTint,
    borderColor: colors.tealLine,
  },

  // ── Zone audio, inside the sheet ──
  zoneSection: { marginBottom: 16, gap: 8 },
  zoneNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  zoneNoteText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 15,
    color: colors.t3,
  },

  // ── Sheet ──
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 150 },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // Sizes to its content — a stranger card is four short rows and used to be
    // padded out to 400 px of empty surface. SHEET_H is only the distance it
    // travels to get off screen, which stays larger than any card it holds.
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    zIndex: 200,
    elevation: 20,
    backgroundColor: colors.surface,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  // Identity row: avatar or point, name + meta, relationship pill.
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  sheetHeadBody: { flex: 1, gap: 3 },
  sheetName: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 17,
    color: colors.t1,
  },
  sheetMeta: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
  },

  /** A stranger's "avatar": the map marker at card scale. Nothing is being
   *  withheld behind a placeholder silhouette — this is all there is. */
  strangerAvatar: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strangerAvatarGlow: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.teal,
    opacity: 0.16,
  },
  strangerAvatarCore: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.teal,
  },

  /** Outlined, not filled: the relationship is a label on this person, and a
   *  filled chip in the same colour would read as a button. */
  relPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  relPillText: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  statusMotion: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: colors.teal,
  },
  interestsSection: { marginBottom: 20 },
  sectionLabel: {
    fontFamily: fonts.body,
    color: colors.t3,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  chipRow: { gap: 8 },
  chip: {
    backgroundColor: colors.surface2,
    borderRadius: radius.m,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    fontFamily: fonts.body,
    color: colors.t2,
    fontSize: 12,
    fontWeight: '500',
  },
  // Action row: wide primary, narrower secondary, square dismiss.
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionPrimary: { flex: 1.5 },
  actionSecondary: { flex: 1 },
  actionDismiss: {
    width: 44,
    height: 44,
    borderRadius: radius.m,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFriendRow: { marginBottom: 10 },
  sheetFootnote: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.t3,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 8,
  },

  // ─── Story marker: surface card + tail + reaction pill (no gold, no shadows) ───
  storyCard: {
    padding: 5,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  storyAvatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  storyCardAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyCardAvatarImg: { width: 40, height: 40, borderRadius: 20 },
  storyCardAvatarText: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 14,
    color: colors.bg,
  },
  storyCardTail: {
    width: 10,
    height: 10,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    transform: [{ rotate: '45deg' }],
    marginTop: -6,
  },
  storyReactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 100,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  storyReactionText: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: colors.t2,
  },

  // ─── Story count badge (inside avatar, bottom-right) ───
  // Sized to the avatar it sits on, so the badge below can overhang its edge
  // without being clipped by the avatar's own rounding.
  storyAvatarStack: { width: 40, height: 40 },
  storyCountBadge: {
    position: 'absolute',
    // Top-right, not bottom-right: the bottom corner is where the card's tail
    // points, and the two were overlapping.
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.teal,
    borderWidth: 1.5,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  storyCountText: {
    fontFamily: fonts.body,
    // 9pt was below the 11pt floor constants/theme.ts documents as the limit
    // of legibility. Dark on teal, matching every other filled badge here —
    // white on teal is the app's lowest-contrast pairing.
    fontSize: type.micro,
    fontWeight: '700',
    color: colors.bg,
  },

  // ─── Create story modal ───
  createModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  createModalSheet: {
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: colors.surface,
  },
  createModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
    marginTop: 6,
  },
  createModalTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 17,
    color: colors.t1,
  },
  storyInput: {
    fontFamily: fonts.body,
    color: colors.t1,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 4,
    padding: 12,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
  },
  charCount: {
    fontFamily: fonts.body,
    color: colors.t3,
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 12,
  },
  photoPreviewContainer: {
    marginBottom: 12,
    position: 'relative',
  },
  photoPreview: {
    width: '100%',
    height: 160,
    borderRadius: radius.m,
  },
  removePhotoBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createModalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  photoPickBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.m,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  postBtn: {
    flex: 1,
    backgroundColor: colors.teal,
    borderRadius: radius.m,
    paddingVertical: 14,
    alignItems: 'center',
  },
  postBtnText: { fontFamily: fonts.body, color: colors.bg, fontSize: 15, fontWeight: '600' },

  // ── Hi toast (design toast: surface2 pill, icon + label) ──
  hiToast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 100,
    paddingHorizontal: 16,
    paddingVertical: 9,
    zIndex: 200,
  },
  hiToastText: { fontFamily: fonts.body, color: colors.t1, fontSize: 13, fontWeight: '500' },
});
