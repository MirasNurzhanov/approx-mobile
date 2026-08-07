import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    AppState,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import MapView, { Circle, Marker, Polygon, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { navArcClearance } from '@/components/navArc';
import { Speedometer } from '@/components/Speedometer';
import { REACTIONS } from '@/components/storyReactions';
import { StoryViewer } from '@/components/StoryViewer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import {
    IconCalendar,
    IconCamera,
    IconClose,
    IconHi,
    IconImage,
    IconList,
    IconLocate,
    IconLocateFixed,
    IconLocateOff,
    IconLock,
    IconMusic,
    IconPeople,
    IconPin,
    IconSearch,
    type IconComponent,
} from '@/components/ui/icons';
import { iconForInterest } from '@/components/ui/interestIcons';
import { ZonePlayer } from '@/components/ZonePlayer';
import { mapStyleFor } from '@/constants/mapStyle';
import {
    CAPTION_GAP,
    CAPTION_H,
    layoutMarkers,
    offsetByMeters,
    type FanInput,
    M_PER_DEG,
    SELF_KEY,
    type GeoPoint,
    type MarkerLayout,
    type ZoneArea,
} from '@/services/markerLayout';
import { fonts, radius, type, withAlpha, zoneRingColor } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { announce, useReduceMotion } from '@/hooks/useReduceMotion';
import { api } from '@/services/api';
import { runBusy } from '@/services/busy';
import { uploadImageToCloudinary } from '@/services/cloudinary';
import { usePermissionPrimer } from '@/components/PermissionPrimer';
import { startBackgroundLocationUpdates } from '@/services/backgroundLocation';
import { atSharingPrecision, reportLocation, type Coordinates } from '@/services/location';
import {
  bindForegroundRefresh,
  check as checkPermission,
  openAppSettings,
  refreshPermissions,
  request as requestPermission,
  usePermissionStore,
  type PermissionState,
} from '@/services/permissions';
import { registerNearbyRefresh, registerMeetupRemove } from '@/services/nearbyRefresh';
import { motionLabel, presenceLabel, type MotionClass, type Presence } from '@/services/presence';
import { MotionTrail } from '@/components/MotionTrail';
import { PresenceDot } from '@/components/PresenceDot';
import { useMotionTrails } from '@/hooks/useMotionTrails';
import { recordSpeed } from '@/services/ownMotion';
import { getCachedLocationSharing, useLocationSharing } from '@/services/privacy';
import { fmtRadius, trackTitle } from '@/services/zoneAudio';
import { isInMainlandChina, MAINLAND_CHINA_NOTICE } from '@/services/gcj02';
import {
    getRegion,
    regionContains,
    ringsForDisplay,
    type Region as ZoneRegion,
    type ZoneMode,
} from '@/services/zoneArea';
import {
    normalizeStories,
    recordOwnStory,
    useStoryArchive,
    type ReactionType,
    type Story,
} from '@/services/stories';
import { withNumericCoordsList } from '@/services/coords';

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
  /** How close you have to be to *hear* them, which is no longer how big their
   *  zone is. Sent only to viewers allowed to hear the track at all, so its
   *  absence means "no audio for you" rather than "no music zone". */
  music_zone_radius?: number;
  /** True when they gave the music a zone of its own — the only case where a
   *  second circle is worth drawing over the first. */
  music_zone_separate?: boolean;
  /** Present for Apple Music tracks, which have a real name and cover art.
   *  Everything else is still named by services/zoneAudio from its URL. */
  zone_track_title?: string;
  zone_track_artist?: string;
  zone_track_artwork?: string;
  /** The slice of the track its owner set to repeat. Absent means the whole
   *  thing. Honoured here, not just on the owner's screen — the trim is part
   *  of what the zone plays. */
  zone_track_start_ms?: number;
  zone_track_end_ms?: number | null;
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
  /** Earshot, drawn as its own ring wherever the zone circle is not already
   *  drawing it. The owner is the one person who cannot hear their own zone
   *  from the map, so seeing where the sound stops is the only feedback they
   *  get. `music_zone_radius` is the server's resolved `music_radius_m` — the
   *  separate dial or the zone radius inherited — so it is the true distance
   *  either way. */
  music_zone_separate: boolean;
  music_zone_radius: number;
  /** The sound zone's own on/off. Off means no ring, because there is nothing
   *  audible for one to mark. */
  music_zone_active: boolean;
  /** Whether there is a track at all. Nothing carries from an empty zone, so an
   *  earshot ring around one marks the reach of silence. */
  has_track: boolean;
}

interface ClubMeetup {
  id: number;
  club: number;
  club_name: string;
  club_emblem?: string;
  created_by: { id: number; username: string; profile_picture?: string };
  title: string;
  description?: string;
  location_name?: string;
  latitude: number;
  longitude: number;
  event_datetime: string;
  status: string;
  expires_at: string;
}

interface MapNearbyResponse {
  users: NearbyUser[];
  stories: Story[];
  meetups: ClubMeetup[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
// Ring colour carries the relationship, and nothing else does: blue is a
// friend, orange is a connection, teal is a matched stranger. One colour per
// state, used on the marker, in the sheet and on the zone.
// COLOR_FRIEND / COLOR_CONNECTED / COLOR_STRANGER are computed inside MapScreen
// using the dynamic theme — see below.

/** Matches APPROX_GRID_M on the server. */
const APPROX_RADIUS_M = 500;

/** Stranger marker: a point of light, not a pin. Small on purpose — a stranger
 *  is a dot with no name and no face, so the marker should not imply it is
 *  hiding a card behind it. */
const DOT_CORE = 14;
const DOT_HALO = 30;
/** Halo for a dot carrying an interest glyph. Bigger than DOT_HALO because the
 *  core has to hold a 13pt icon and its ring, not a 14pt point. */
const DOT_HALO_ICON = 38;

/** Avatar URLs that have decoded at least once this session.
 *
 * Module-level on purpose: it has to outlive the markers themselves, because
 * the whole point is surviving an unmount. Grows with the number of distinct
 * people seen on one run of the app — a few hundred strings at worst — and is
 * discarded with the process. */
const loadedAvatars = new Set<string>();



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
//: Above the circles it labels, below every person on the map — a label for a
//: zone must never be the thing covering someone standing in it.
const Z_MUSIC = 2;
const Z_STRANGER = 4;
const Z_FRIEND = 5;
/** Above the people it stands in for: while a pile is collapsed, the badge is
 *  the only thing there is to hit. */
const Z_CLUSTER = 6;
const Z_STORY   = 7;
const Z_MEETUP  = 8;

// ─── PARKED_MARKERS ───────────────────────────────────────────────────────────
/*
 * Why markers on this map are parked instead of unmounted.
 *
 * `react-native-maps` cannot reliably remove a child from the native map under
 * the New Architecture. Fabric's interop layer loses track of custom children
 * (`MapView → Marker → custom view`), logs `removeViewAt: view already removed
 * from parent!`, and the removal never reaches `MapView.removeFeatureAt` — so
 * the marker stays on the GoogleMap forever, long after React has forgotten it.
 * Upstream: react-native-maps#5736, open, still present in 1.26.x, so upgrading
 * is not the way out. `newArchEnabled: false` would be, at the cost of the rest
 * of the app.
 *
 * The layout is what makes this visible. Pinching folds people into a headcount
 * and opens them out again, and each fold unmounts a handful of markers: zoom
 * out and the faces stay behind under the new badge, zoom back in and the badge
 * stays behind on top of the faces. That second one is the bug as reported —
 * "the number is still on the map" — and `layoutMarkers` was never at fault.
 *
 * So nothing this layout controls is ever unmounted. A marker with no one to
 * draw goes transparent and shrinks to `parkedMarker`, keeping its slot in the
 * child list; badges and leader lines come from fixed pools of slots that grow
 * but never shrink. React then only ever *updates* map children while the
 * camera moves, and update is the path that works.
 *
 * Markers do still unmount when someone leaves `visibleNearby` entirely, which
 * is a poll-rate event rather than a per-frame one. Same latent bug, far rarer;
 * worth pooling too if stale faces ever show up.
 */

const REL_LABEL: Record<Relationship, string> = {
  stranger:  'Nearby',
  hi_sent:   'Hi Sent',
  connected: 'Connected',
  friend:    'Friend',
};

const POLL_MS            = 10_000;
/** How still the camera must be before the marker layout reacts to a new zoom. */
const ZOOM_SETTLE_MS     = 220;

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

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      weekday: 'short', month: 'short', day: 'numeric',
      year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function fmtTimeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`;
}

/**
 * The radius of the viewer's own earshot ring, or null for no ring.
 *
 * Yours is not drawn on quite the same terms as everyone else's, and the
 * difference is that yours is also a control. Other people's rings answer "can
 * I hear something here"; yours additionally answers "how far did I just set
 * that dial", which is a question worth answering before there is a track.
 *
 *  1. Is the sound zone on? Muting is the switch that stops people hearing
 *     you, so it is the switch that removes the ring marking where they would
 *     — and with the size controls hidden while muted, there is no dial left
 *     to preview either.
 *  2. Is earshot a dial you set? A separate music zone is drawn whether or not
 *     a track is loaded: the ring is the only place the radius is visible at
 *     real scale, and sizing the zone before choosing the song is the normal
 *     order to do those two things in.
 *  3. Otherwise, is there a track? Inherited earshot is not a preview of
 *     anything — the number belongs to the zone, and Zone Size previews it
 *     there — so an empty zone has no reach worth drawing.
 *  4. Is earshot a circle at all? A region zone that the music still follows
 *     has a city outline for a listening range, and drawing `zone_radius` as a
 *     circle would claim a boundary that is not the one in force. Same rule
 *     other people get, a few lines further down in `musicZones`.
 *  5. Is the zone circle already drawing it? When earshot is inherited and the
 *     zone is on the map at the same radius, a second identical ring is not
 *     information — but when the zone circle is *off*, this ring is the only
 *     thing showing how far the music goes, and it must stay.
 *
 * Point 5 is what makes turning "a separate zone for music" off safe. It used
 * to delete the ring outright, which on a map with the zone circle hidden left
 * nothing at all — the switch looked like it had removed the zone.
 */
function selfEarshotRing(zone: SelfZone | null): number | null {
  if (!zone?.music_zone_active) return null;
  if (!(zone.music_zone_radius > 0)) return null;
  if (zone.music_zone_separate) return zone.music_zone_radius;
  if (!zone.has_track) return null;
  if (zone.zone_mode === 'region') return null;
  if (zone.zone_active) return null;
  return zone.music_zone_radius;
}


/**
 * Widest span the layout will reason about, in degrees of latitude.
 *
 * Google Maps will happily zoom out to the whole globe, at which point a pixel
 * is worth tens of kilometres and `SELF_CLEAR_PX` worth of offset lands a badge
 * in another hemisphere — or past the poles, which is an invalid coordinate and
 * takes the native map down with it.
 */
const MAX_ZOOM_DELTA = 2;

/**
 * The zoom, rounded to half a power of two.
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

/** Refuse to hand the native map a coordinate it can crash on.
 *
 * `Number.isFinite` does not coerce, so this also rejects the string
 * coordinates DRF sends for stories and meetups — which is precisely why
 * people's markers survived the New Architecture and those two did not. The
 * coercion in services/coords.ts is the real fix; this stays as the last gate
 * in front of the native view, and additionally rejects the polar latitudes
 * Mercator cannot project even though they are perfectly real places.
 *
 * Generic so `.filter(isDrawable)` narrows to the caller's own row type rather
 * than flattening it to a bare point. */
function isDrawable<T extends GeoPoint>(p?: T | null): p is T {
  return (
    !!p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 85 &&
    Math.abs(p.longitude) <= 180
  );
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

/**
 * `tracksViewChanges` for a marker whose bitmap depends on `key`.
 *
 * react-native-maps rasterizes a marker's children and then freezes the result,
 * so anything that changes what the marker should look like has to re-arm
 * tracking or it keeps drawing the picture it froze first.
 *
 * Phrased as "the key I last settled on is not the key I am drawing now", which
 * means a changed key re-arms tracking in the *same* render that changes it.
 * The older shape — a flag flipped back to true inside an effect — repainted
 * every affected marker a second time on every poll, and on a busy map that is
 * a full extra rasterization pass for each of them.
 */
function useMarkerSettle(key: string, settleMs = 400) {
  const [settledKey, setSettledKey] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSettledKey(key), settleMs);
    return () => clearTimeout(t);
  }, [key, settleMs]);

  return {
    settling: settledKey !== key,
    /** For markers that know they have finished drawing before the timer. */
    markSettled: () => setSettledKey(key),
  };
}

/**
 * A matched stranger.
 *
 * They stay anonymous — no photo, no name, nothing to screenshot — but not
 * unexplained. A stranger is only on this map because you share an interest
 * with them (see `visibleNearby`), and until now that reason was invisible:
 * the map showed a lit dot with no way to tell why it was there, or what the
 * two of you had in common, short of tapping it.
 *
 * So the dot carries the interest itself. That is the one thing about them
 * which is safe to show, because it is not really about them — it is the
 * overlap, and you already know your own half of it.
 */
function DotMarker({
  coordinate, color, presence, zIndex, sharedInterests, showCaption = true, parked, onPress,
}: {
  coordinate: { latitude: number; longitude: number };
  color: string;
  presence?: Presence;
  zIndex?: number;
  /** Interests you both have. First one is shown; the rest become a count. */
  sharedInterests?: string[];
  /** False when this dot shares its spot with others — the glyph stays, the
   *  word under it goes. See `FanResult.crowded`. */
  showCaption?: boolean;
  /** This person is inside a headcount badge right now. Drawn as nothing rather
   *  than unmounted — see `PARKED_MARKERS`. */
  parked?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Re-arm tracking briefly when the color changes (friend data arrives after
  // the first nearby fetch), then freeze the rasterized marker again.
  // Presence is in the same bucket: it changes the rasterized bitmap, so it has
  // to re-arm too, but only when it actually flips — not on every poll.
  const online = presence?.is_online;
  const primary = sharedInterests?.[0];
  const extra = Math.max((sharedInterests?.length ?? 0) - 1, 0);
  const InterestIcon = primary ? iconForInterest(primary) : null;
  /** The word under the dot. Suppressed in a pile — see `showCaption`. */
  const captionText = showCaption ? primary : undefined;

  // `primary` belongs in the key with the rest: the marker freezes its own
  // bitmap once settled, so an interest that arrives on a later poll — the
  // first one can land before the interest data does — would otherwise never be
  // drawn at all. `parked` for the same reason: the dot has to redraw as the
  // empty spacer on the way in, and as itself on the way back out.
  const { settling } = useMarkerSettle(
    `${color}|${online}|${primary}|${extra}|${captionText}|${parked}`,
  );

  // The glyph needs a bigger core to sit in than a bare point does, and the
  // caption makes the marker taller than its halo — so the anchor moves off
  // centre to keep the *dot* over the coordinate rather than the whole box.
  const haloH = primary ? DOT_HALO_ICON : DOT_HALO;
  const totalH = captionText ? haloH + CAPTION_GAP + CAPTION_H : haloH;

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: (haloH / 2) / totalH }}
      tracksViewChanges={settling}
      opacity={parked ? 0 : 1}
      zIndex={zIndex}
      accessibilityLabel={
        parked
          ? undefined
          : primary
            ? `Someone nearby who also likes ${primary}${extra > 0 ? `, and ${extra} more shared` : ''}`
            : 'Someone nearby with a shared interest'
      }
      onPress={parked ? undefined : onPress}
    >
      {parked ? <View style={styles.parkedMarker} /> : (
      /* Android clips marker children to their parent box when it rasterizes,
         so the halo and the caption both have to live inside this column. */
      <View style={styles.dotColumn}>
        <View style={[styles.dotWrap, { width: haloH, height: haloH }]}>
          {/* Two discs, not one: a wide faint bloom and a tighter brighter one,
              which is what makes the dot read as lit from within rather than as
              a flat circle sitting on the map. */}
          <View style={[styles.dotBloom, { width: haloH, height: haloH, borderRadius: haloH / 2, backgroundColor: color }]} />
          {InterestIcon ? (
            <View style={[styles.dotIconCore, { borderColor: color, boxShadow: `0 0 5px ${withAlpha(color, 0.9)}` }]}>
              <InterestIcon size={13} color={color} />
            </View>
          ) : (
            <>
              <View style={[styles.dotGlow, { backgroundColor: color }]} />
              <View style={[styles.userDot, { backgroundColor: color, boxShadow: `0 0 5px ${withAlpha(color, 0.9)}` }]} />
            </>
          )}
          {/* Absent presence renders nothing — PresenceDot returns null — so a
              hidden state never becomes a visible "offline". */}
          <View style={[styles.dotPresence, primary && styles.dotPresenceIcon]}>
            <PresenceDot presence={presence} size={8} haloColor={colors.bg} />
          </View>
        </View>

        {captionText ? (
          <View style={styles.markerCaption}>
            <Text style={styles.markerCaptionText} numberOfLines={1}>
              {captionText}
              {extra > 0 ? (
                <Text style={[styles.markerCaptionTag, { color }]}>{` +${extra}`}</Text>
              ) : null}
            </Text>
          </View>
        ) : null}
      </View>
      )}
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
  /** This person is inside a headcount badge right now. Drawn as nothing rather
   *  than unmounted — see `PARKED_MARKERS`. */
  parked?: boolean;
  onPress?: () => void;
}

/** Caption geometry, needed up front: the anchor has to be computed from the
 *  full marker height so the ring — not the whole box — sits on the point. */

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
  parked,
  onPress,
}: AvatarMarkerProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // Markers rasterize their children: keep tracking until the remote image is
  // drawn, and re-arm briefly when the ring color changes (friend data arrives
  // after the first nearby fetch).
  // Seeded from `loadedAvatars`, which is why avatars stopped blinking.
  //
  // Being folded into a headcount badge no longer unmounts this marker — it
  // parks, see `PARKED_MARKERS` — so `imageReady` survives a pinch outright.
  // `loadedAvatars` still earns its keep for the mounts that remain: someone
  // walking back into `visibleNearby` comes back already wearing their face
  // instead of flashing a blank ring while a cached picture decodes again.
  // Tagged with the uri it describes rather than reset by an effect when the
  // uri changes. The effect version was a render late, so a marker whose
  // picture changed showed the previous person's face inside the new ring for
  // a frame before blanking.
  const [load, setLoad] = useState<{ uri?: string; ready: boolean; failed: boolean }>(
    () => ({ uri, ready: !uri || loadedAvatars.has(uri), failed: false }),
  );
  const loadIsCurrent = load.uri === uri;
  const imageReady  = loadIsCurrent ? load.ready  : !uri || loadedAvatars.has(uri);
  const imageFailed = loadIsCurrent ? load.failed : false;
  const online = presence?.is_online;

  // Presence changes the bitmap too, so it re-arms tracking — but keyed on the
  // boolean, not the object, so a poll that returns an equal presence does not
  // re-rasterize every avatar on the map. Parking is a bitmap change as well:
  // the ring has to redraw as the empty spacer, and back again.
  const { settling: ringSettling } = useMarkerSettle(`${ringColor}|${online}|${parked}`);

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
      opacity={parked ? 0 : 1}
      zIndex={zIndex}
      accessibilityLabel={parked ? undefined : label}
      onPress={parked ? undefined : onPress}
    >
      {parked ? <View style={styles.parkedMarker} /> : (
      /* Column wrapper: Android clips marker children to the parent box when
         it rasterizes, so the caption has to live inside it. */
      <View style={styles.avatarMarkerWrap}>
        <View style={[styles.avatarMarkerRing, { width: size, height: size, borderRadius: size / 2, borderColor: ringColor }]}>
          {uri && !imageFailed ? (
            <Image
              source={{ uri }}
              style={{ width: inner, height: inner, borderRadius: inner / 2 }}
              onLoad={() => {
                loadedAvatars.add(uri);
                setTimeout(() => setLoad({ uri, ready: true, failed: false }), 250);
              }}
              onError={() => setLoad({ uri, ready: true, failed: true })}
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
      )}
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // Same shape as AvatarMarker: the load state carries the uri it belongs to,
  // so changing your own picture is not a reset an effect has to perform.
  const [load, setLoad] = useState<{ uri?: string; ready: boolean; failed: boolean }>(
    () => ({ uri, ready: !uri, failed: false }),
  );
  const loadIsCurrent = load.uri === uri;
  const imageReady  = loadIsCurrent ? load.ready  : !uri;
  const imageFailed = loadIsCurrent ? load.failed : false;

  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} zIndex={Z_SELF} tracksViewChanges={!imageReady}>
      <View style={styles.selfHalo}>
        <View style={styles.selfCore}>
          {uri && !imageFailed ? (
            <Image
              source={{ uri }}
              style={styles.selfAvatar}
              onLoad={() => {
                loadedAvatars.add(uri);
                setTimeout(() => setLoad({ uri, ready: true, failed: false }), 250);
              }}
              onError={() => setLoad({ uri, ready: true, failed: true })}
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
/**
 * The label that makes a music zone legible as one.
 *
 * A second ring around a person is otherwise just another ring — the map is
 * full of circles, and "this one is how far the sound carries" is not
 * something a stroke colour can say. So the ring is drawn faintly and a small
 * note-and-distance chip sits on its edge, which is where the two facts people
 * actually want live: that it is music, and where it stops.
 *
 * Pinned due north of the centre so it lands on the ring itself rather than
 * floating near it, and so two zones on top of each other stack their labels
 * in a readable column instead of overlapping at the same point.
 */
function MusicZoneBadge({ center, radius, mine, label, color }: {
  center: GeoPoint;
  radius: number;
  mine?: boolean;
  /** What the chip says: a friend's @name, or your own reach. */
  label: string;
  /** The ring's colour, repeated here so the chip and the circle it labels are
   *  visibly one thing when several overlap. */
  color: string;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // Same reason as ClusterMarker: let it draw, then freeze the raster — and
  // re-arm on every input that changes what the chip says, or a zone resized or
  // recoloured mid-session keeps drawing the label it first froze.
  const { settling } = useMarkerSettle(`${radius}|${label}|${color}`);

  return (
    <Marker
      coordinate={offsetByMeters(center, radius, 0)}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={settling}
      zIndex={Z_MUSIC}
      accessibilityLabel={
        mine
          ? `Your music carries ${fmtRadius(radius)}`
          // The name goes first: a screen reader arriving at this chip is
          // answering "whose zone is this", same as the colour does visually.
          : `${label}'s music zone, ${fmtRadius(radius)} across`
      }
    >
      <View style={[styles.musicBadge, { borderColor: withAlpha(color, 0.55) }]}>
        <IconMusic size={10} color={color} />
        <Text style={[styles.musicBadgeText, { color }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Marker>
  );
}

function ClusterMarker({ coordinate, count, parked, onPress }: {
  coordinate: { latitude: number; longitude: number };
  count: number;
  /** Slot currently standing in for no pile — see `PARKED_MARKERS`. */
  parked?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // Same reason as DotMarker: freeze the raster, but not before it has drawn.
  //
  // Re-arming is the point. Without it the badge froze its first bitmap for
  // good: a pile that gained or lost someone kept drawing its old number,
  // because the timer had already fired and nothing ever re-armed tracking.
  // Parking is in the key too — a slot that goes quiet has to redraw as the
  // empty spacer, or it keeps a headcount's worth of tap target sitting on the
  // map.
  const { settling } = useMarkerSettle(`${count}|${parked}`);

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={settling}
      opacity={parked ? 0 : 1}
      zIndex={Z_CLUSTER}
      onPress={parked ? undefined : onPress}
      accessibilityLabel={
        parked ? undefined : `${count} ${count === 1 ? 'person' : 'people'} here. Zoom in to see them.`
      }
    >
      {parked ? (
        <View style={styles.parkedMarker} />
      ) : (
        <View style={styles.clusterWrap}>
          <View style={styles.clusterBloom} />
          <View style={styles.clusterBadge}>
            <IconPeople size={12} color={colors.teal} />
            <Text style={styles.clusterCount}>{count}</Text>
          </View>
        </View>
      )}
    </Marker>
  );
}

function StoryBubble({ story, count, onAvatarLoad }: { story: Story; count: number; onAvatarLoad?: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
              <Image
                source={{ uri: story.author.profile_picture }}
                style={styles.storyCardAvatarImg}
                onLoad={onAvatarLoad}
              />
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

function StoryMarker({ stories, onPress }: { stories: Story[]; onPress: () => void }) {
  const first = stories[0];
  // With `tracksViewChanges` permanently false the marker is snapshotted on
  // first render — before the avatar arrives — and stays blank forever. Track
  // until the image load fires (or a fallback timeout for letter avatars and
  // failed loads), and re-track for a beat whenever the bubble's content
  // changes so new stories and reaction counts actually repaint.
  const signature = `${first.id}:${stories.length}:${first.author.profile_picture ?? ''}:${JSON.stringify(first.reactions ?? {})}`;
  const { settling: tracks, markSettled } = useMarkerSettle(signature, 3000);

  // One frame after load isn't enough on Android — give the draw a moment
  // before freezing the snapshot.
  const settle = () => { setTimeout(markSettled, 300); };

  return (
    <Marker
      coordinate={{ latitude: first.latitude, longitude: first.longitude }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracks}
      zIndex={Z_STORY}
      onPress={onPress}
    >
      <StoryBubble story={first} count={stories.length} onAvatarLoad={settle} />
    </Marker>
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const following = state === 'following';

  // The icon carries the state as a shape — a filled centre when tracking, a
  // slash when unavailable — so following is still legible without the teal.
  const Icon = following ? IconLocateFixed : state === 'unavailable' ? IconLocateOff : IconLocate;
  const tint = following ? colors.teal : state === 'unavailable' ? colors.t3 : colors.t2;

  return (
    <Pressable
      onPress={onPress}
      disabled={state === 'locating'}
      hitSlop={8}
      style={({ pressed }) => [
        styles.locateBtn,
        following && styles.locateBtnActive,
        { bottom },
        pressed && { opacity: 0.75 },
      ]}
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
    </Pressable>
  );
}

// ─── Top Bar ─────────────────────────────────────────────────────────────────
function TopBar({
  nearby,
  onZoneMusic,
  onSearch,
  onList,
}: {
  nearby: number;
  onZoneMusic: () => void;
  onSearch: () => void;
  onList: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
      <Pressable
        onPress={onList}
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="People nearby, list view"
        accessibilityHint="Opens a readable list of everyone shown on the map"
      >
        <IconList size={20} color={colors.t2} />
      </Pressable>

      <Pressable
        onPress={onSearch}
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Search for people"
      >
        <IconSearch size={20} color={colors.t2} />
      </Pressable>

      {/* A shield used to sit here, labelled "privacy and safety", and it
          opened Zone Music. The icon promised one screen and the tap gave
          another; the note is what is actually behind it. */}
      <Pressable
        onPress={onZoneMusic}
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Zone music"
        accessibilityHint="Choose what plays in your zone and how far it carries"
      >
        <IconMusic size={20} color={colors.t2} />
      </Pressable>
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
    await runBusy(async () => {
      await onPost(text.trim(), photoUri);
      setText('');
      setPhotoUri(null);
      onClose();
    }, () => setPosting(false))
      .catch(() => Alert.alert('Failed to post', 'Please try again.'));
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.createModalBackdrop} onPress={onClose} />
        <View style={[styles.createModalSheet, { paddingBottom: bottom + 20 }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.createModalHeader}>
            <Text style={styles.createModalTitle}>Drop a Story</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => pressed && { opacity: 0.2 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <IconClose size={20} color={colors.t3} />
            </Pressable>
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
              <Image source={{ uri: photoUri }} style={styles.photoPreview} contentFit="cover" />
              <Pressable
                style={({ pressed }) => [styles.removePhotoBtn, pressed && { opacity: 0.2 }]}
                onPress={() => setPhotoUri(null)}
                hitSlop={8}
              >
                <IconClose size={14} color={colors.t1} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.createModalActions}>
            <Pressable
              style={({ pressed }) => [styles.photoPickBtn, pressed && { opacity: 0.75 }]}
              onPress={takePhoto}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Take a photo"
            >
              <IconCamera size={20} color={colors.t2} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.photoPickBtn, pressed && { opacity: 0.75 }]}
              onPress={pickPhoto}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Choose a photo from your library"
            >
              <IconImage size={20} color={colors.t2} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.postBtn,
                (!text.trim() || posting) && { opacity: 0.5 },
                pressed && { opacity: 0.8 },
              ]}
              onPress={handlePost}
              disabled={!text.trim() || posting}
            >
              {posting ? (
                <ActivityIndicator color={colors.bg} size="small" />
              ) : (
                <Text style={styles.postBtnText}>Post Story</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Meetup Marker ────────────────────────────────────────────────────────────
function MeetupMarker({ meetup, onPress }: { meetup: ClubMeetup; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Marker
      coordinate={{ latitude: meetup.latitude, longitude: meetup.longitude }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
      zIndex={Z_MEETUP}
      onPress={onPress}
    >
      <View style={styles.meetupMarkerWrap}>
        <View style={styles.meetupMarkerBubble}>
          {meetup.club_emblem ? (
            <Image source={{ uri: meetup.club_emblem }} style={styles.meetupMarkerImg} />
          ) : (
            <IconCalendar size={18} color="#fff" />
          )}
        </View>
        <View style={styles.meetupMarkerTail} />
      </View>
    </Marker>
  );
}

// ─── Meetup Sheet ─────────────────────────────────────────────────────────────
function MeetupSheet({
  meetup,
  sheetY,
  onDismiss,
}: {
  meetup: ClubMeetup;
  sheetY: SharedValue<number>;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();
  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.get() }] }));

  function openDirections() {
    const label = encodeURIComponent(meetup.title);
    const url = Platform.OS === 'ios'
      ? `maps://0,0?q=${label}@${meetup.latitude},${meetup.longitude}`
      : `geo:${meetup.latitude},${meetup.longitude}?q=${meetup.latitude},${meetup.longitude}(${label})`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://maps.google.com/maps?q=${meetup.latitude},${meetup.longitude}`);
    });
  }

  return (
    <>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onDismiss} />
      <Animated.View style={[styles.sheet, { paddingBottom: bottom + 16 }, animStyle]}>
        <View style={styles.sheetHandle} />

        {/* Head: club emblem + title + expiry */}
        <View style={styles.sheetHead}>
          {meetup.club_emblem ? (
            <Image source={{ uri: meetup.club_emblem }} style={styles.meetupSheetEmblem} />
          ) : (
            <View style={styles.meetupSheetEmblemFallback}>
              <IconCalendar size={22} color="#fff" />
            </View>
          )}
          <View style={styles.sheetHeadBody}>
            <Text style={styles.sheetName} numberOfLines={2}>{meetup.title}</Text>
            <Text style={styles.sheetMeta} numberOfLines={1}>{meetup.club_name}</Text>
          </View>
          <View style={styles.meetupExpiryPill}>
            <Text style={styles.meetupExpiryText}>{fmtTimeLeft(meetup.expires_at)}</Text>
          </View>
        </View>

        {/* Details */}
        <View style={styles.meetupDetailBlock}>
          <View style={styles.meetupDetailRow}>
            <IconCalendar size={14} color={colors.t3} />
            <Text style={styles.meetupDetailText}>{fmtDateTime(meetup.event_datetime)}</Text>
          </View>
          {meetup.location_name ? (
            <View style={styles.meetupDetailRow}>
              <IconPin size={14} color={colors.t3} />
              <Text style={styles.meetupDetailText} numberOfLines={1}>{meetup.location_name}</Text>
            </View>
          ) : null}
          <View style={styles.meetupDetailRow}>
            <IconPeople size={14} color={colors.t3} />
            <Text style={styles.meetupDetailText}>Proposed by @{meetup.created_by.username}</Text>
          </View>
          {meetup.description ? (
            <Text style={styles.meetupDescription}>{meetup.description}</Text>
          ) : null}
        </View>

        <Button label="Get Directions" variant="primary" size="md" fullWidth onPress={openDirections} />
      </Animated.View>
    </>
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.get() }],
  }));

  const rel         = user.relationship ?? 'stranger';
  const isFriend    = rel === 'friend';
  const isConnected = rel === 'connected';
  const isHiSent    = rel === 'hi_sent';
  const isStranger  = rel === 'stranger';

  const relRingColor  = isFriend ? colors.blue : isConnected ? colors.orange : colors.t3;
  const relLabelColor = isFriend ? colors.blue : isConnected ? colors.orange : colors.t2;
  const dist          = fmtDistance(user.distance);

  // The sheet stays mounted when tapping straight to another marker, so "sent"
  // has to mean "sent to *this* person". Recording who it was sent to says that
  // outright, instead of a boolean that an effect has to remember to clear —
  // and the old version cleared it a render late, so tapping from someone you
  // had just messaged to someone new showed "Sent" under the new name first.
  const [sentTo, setSentTo] = useState<number | null>(null);
  const requestSent = sentTo === user.id;

  function sendFriendRequest() {
    api.post(`/api/friends/request/${user.id}/`)
      .then(() => setSentTo(user.id))
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
  const zoneLine = identified && user.zone_audio_url ? 'in their sound zone' : null;
  const metaLine = [distLine, zoneLine].filter(Boolean).join(' · ');


  // ── Their zone track ──
  // The server only sends zone_audio_url to viewers allowed to hear it —
  // friends and connections, never a stranger, whatever the owner's Zone
  // audio setting says — so a URL here is already permission to play. This
  // check is redundant with that server gate, kept as a second line of
  // defence rather than trusting the field's mere presence.
  //
  // The track is its own switch. `zone_active` governs whether they are drawn
  // with a zone on the map, and reading it here is what made turning that
  // circle off silently mute a song its owner had not touched.
  const zoneUrl = identified ? user.zone_audio_url : undefined;
  const zoneRadius = user.zone_radius && user.zone_radius > 0 ? user.zone_radius : 500;
  const distanceM = user.distance ?? (user.distance_km != null ? user.distance_km * 1000 : null);
  // A region zone is a shape, not a distance: someone 3km away can be well
  // inside a city while someone 300m away across the boundary is outside, so
  // the radius comparison would be wrong in both directions.
  //
  // …unless they gave the music its own zone, which is always a circle. Then
  // that circle is the answer whatever shape the zone around it happens to be.
  const musicRadius = user.music_zone_radius && user.music_zone_radius > 0
    ? user.music_zone_radius
    : zoneRadius;
  const isRegionZone = user.zone_mode === 'region' && !!zoneRegion && !user.music_zone_separate;
  // What earshot is *called* in the copy below — "200 m" or "Almaty".
  const zoneLabel = isRegionZone ? zoneRegion!.name : fmtRadius(musicRadius);
  // Unknown position is not "out of range" — a card that refuses to play with
  // no reason it can name is worse than one that plays a track you can hear.
  const insideZone = isRegionZone
    ? (!viewerCoords ||
       regionContains(zoneRegion!, viewerCoords.latitude, viewerCoords.longitude))
    : (distanceM == null || distanceM < musicRadius);

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
              // An Apple track knows its own name and artist; an upload is
              // still named from the URL, which for Apple's CDN would be a
              // hash.
              title={user.zone_track_title || trackTitle(zoneUrl)}
              artwork={user.zone_track_artwork}
              startMs={user.zone_track_start_ms ?? 0}
              endMs={user.zone_track_end_ms ?? null}
              subtitle={
                [
                  user.zone_track_artist || `@${user.username}`,
                  insideZone ? `inside their ${zoneLabel} zone` : `${zoneLabel} zone`,
                ].join(' · ')
              }
              blockedReason={
                insideZone
                  ? null
                  : isRegionZone
                    ? `Out of range — step inside ${zoneLabel} to listen`
                    : `Out of range — step within ${zoneLabel} of them to listen`
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
              {user.shared_interests.map((tag) => (
                <View key={tag} style={styles.chip}>
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
  const { colors, themeMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const COLOR_FRIEND    = colors.blue;
  const COLOR_CONNECTED = colors.orange;
  const COLOR_STRANGER  = colors.teal;
  const router = useRouter();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
  const [coords, setCoords]           = useState<{ latitude: number; longitude: number } | null>(null);
  const [nearby, setNearby]           = useState<NearbyUser[]>([]);
  const [permState, setPermState]     = useState<PermissionState | null>(null);
  const { ensure: ensurePermission, primer } = usePermissionPrimer();
  /** Who the sheet was opened for. The row shown is read back out of the live
   *  list below, so an open sheet follows each poll on its own. */
  const [openUser, setOpenUser] = useState<NearbyUser | null>(null);
  const selectedUser = openUser ? (nearby.find((u) => u.id === openUser.id) ?? openUser) : null;
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [friendIds, setFriendIds]     = useState<Set<number>>(new Set());
  const [connectionIds, setConnectionIds] = useState<Set<number>>(new Set());
  const [selfProfile, setSelfProfile] = useState<{ username: string; profile_picture?: string } | null>(null);
  const [selfZone, setSelfZone]       = useState<SelfZone | null>(null);
  const [hiToast, setHiToast]           = useState(false);
  const [locationToast, setLocationToast] = useState(false);
  const [stories, setStories]           = useState<Story[]>([]);
  /** Which stories the viewer was opened on. Each one is read back out of the
   *  live list below, so reactions and refetches show through without the
   *  viewer's copy having to be patched to match. */
  const [openStories, setOpenStories]   = useState<Story[] | null>(null);
  const storyViewer = openStories
    ? { stories: openStories.map((s) => stories.find((f) => f.id === s.id) ?? s) }
    : null;
  const [createStoryCoord, setCreateStoryCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [clubMeetups, setClubMeetups]   = useState<ClubMeetup[]>([]);
  const [selectedMeetup, setSelectedMeetup] = useState<ClubMeetup | null>(null);

  // The last non-null selection — lets us keep the sheet components mounted
  // between taps instead of unmounting on every dismiss. State rather than a
  // ref, because render reads it back to decide what stays mounted, and a ref
  // read during render is what stops the compiler optimising this screen.
  const [sheetUser, setSheetUser]     = useState<NearbyUser | null>(null);
  const [sheetMeetup, setSheetMeetup] = useState<ClubMeetup | null>(null);

  const [followRequested, setFollowRequested] = useState(false);
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
  // Both mirror state for the polling and location callbacks further down.
  // Declared above every effect that reads them, so on any commit where both
  // run this one lands first.
  useEffect(() => {
    coordsRef.current = coords;
    currentUserIdRef.current = currentUserId;
  });

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

  // Following depends on the permission that feeds it, so it is stated as a
  // condition rather than a flag some effect has to switch off afterwards.
  // Losing location mid-follow now stops it in the same render; before, the
  // camera stayed locked to a position that would never update again until an
  // effect noticed and re-rendered.
  // `following` itself is still derived in render, so the condition above still
  // holds the moment the permission drops. Only the ref mirror — read by
  // `stopFollowing`, which both gestures and taps reach after a commit — waits
  // for the effect. The handlers that need it sooner still set it themselves.
  const following = followRequested && locationGranted;
  useEffect(() => { followingRef.current = following; });

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

      // The server's own verdict, and it is the authority: it computes the
      // relationship from the friend and Hi tables on every poll, and it is
      // what puts friends in this payload at any distance in the first place.
      //
      // Checked *before* the local sets, because those come from a separate
      // request that fails silently. When /friends/list/ blipped, `friendIds`
      // stayed empty and the last line below quietly dropped every friend who
      // happened to share no interests — the people most likely to be missed
      // being exactly the ones the map exists to show.
      if (u.relationship === 'friend' || u.relationship === 'connected') return true;
      if (friendIds.has(uid) || connectionIds.has(uid)) return true;

      // Strangers earn their place on the map by sharing something.
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

  /** The viewer's own zone outline, cut into drawable pieces.
   *
   * No mainland-China display shift here, unlike the zone-area preview: this
   * map draws markers, clusters, trails and circles from the same coordinates,
   * and shifting only the polygon would put your zone's border in the right
   * street while leaving your own dot in the wrong one. That trade is worse
   * than a uniform offset, because "am I inside it?" is the single question
   * the outline exists to answer. See services/gcj02 and `chinaOffsetNotice`. */
  const selfZoneRings = useMemo(() => {
    const id = selfZone?.zone_region_id;
    if (!selfZone?.zone_active || selfZone.zone_mode !== 'region' || !id) return [];
    const outline = regionOutlines.get(id);
    return outline ? ringsForDisplay(outline) : [];
  }, [selfZone, regionOutlines]);

  /** Set once the viewer is standing where the basemap disagrees with GPS.
   *
   * Google serves GCJ-02 tiles inside mainland China while everything Aura
   * measures is WGS-84, so the two are a few hundred metres apart. Saying so
   * beats drawing a zone that silently sits in the wrong street. */
  const chinaOffsetNotice = useMemo(
    () =>
      displayCoords &&
      isInMainlandChina(displayCoords.latitude, displayCoords.longitude),
    [displayCoords],
  );

  /** Every music zone on screen — the viewer's own, and each friend whose
   *  track they are allowed to hear. Assembled once so the faint ring, the
   *  badge that labels it and the fan constraint below can never disagree
   *  about which circles exist. */
  const musicZones = useMemo(() => {
    // `label` and `color` are what make one ring tellable from another. Drawn
    // in a single colour with only a radius on the chip, two friends
    // broadcasting near each other were two identical circles: you could see
    // that somebody's music reached here, but not whose.
    const zones: {
      key: string;
      center: GeoPoint;
      radius: number;
      mine?: boolean;
      label: string;
      color: string;
    }[] = [];
    // Your own ring, on the same terms as everyone else's: a track, a sound
    // zone switched on, and a circle that is genuinely the listening range.
    //
    // It used to require `music_zone_separate`, and that is the bug this
    // whole change came from. Turning "a separate zone for music" off is a
    // statement about *size* — earshot goes back to following the zone — but
    // the only ring on the map disappeared, so the switch read as the thing
    // that removes your zone. Now the ring survives the toggle and simply
    // becomes whichever circle is really in force.
    //
    // Still independent of `zone_active`, which removes the circle you appear
    // inside and says nothing about sound. `music_zone_active` is the mute,
    // and it does take the ring with it — there is no audible edge left to mark.
    const selfRadius = selfEarshotRing(selfZone);
    if (displayCoords && selfRadius) {
      zones.push({
        key: 'music-self',
        center: displayCoords,
        radius: selfRadius,
        mine: true,
        // Yours says how far it carries, not who it is — you know who you are,
        // and where your own music stops is the one thing you cannot check by
        // listening. Purple means "yours" everywhere else on the map.
        label: fmtRadius(selfRadius),
        color: colors.purple,
      });
    }
    for (const u of visibleNearby) {
      // `zone_audio_url` is the real switch: no track, no ring to label. The
      // server only sends it to viewers allowed to hear it, so a ring drawn
      // here is always one the viewer could walk into and play.
      if (!(u.music_zone_radius ?? 0) || !u.zone_audio_url) continue;
      if (u.latitude == null || u.longitude == null) continue;
      // Not gated on `music_zone_separate` any more. `music_zone_radius`
      // arrives already resolved — the server sends `music_radius_m`, the
      // separate dial or the zone radius inherited — so it is the right circle
      // either way, and requiring the flag meant a friend who had never opened
      // the earshot setting showed no music zone at all. That is almost
      // everybody, which made the feature look broken rather than off.
      //
      // The exception is a region-mode friend who has *not* separated earshot:
      // their listening range is the city outline, not a circle, and drawing
      // their zone radius as one would claim a boundary that is not theirs.
      if (u.zone_mode === 'region' && !u.music_zone_separate) continue;
      zones.push({
        key: `music-${u.id}`,
        center: { latitude: u.latitude, longitude: u.longitude },
        radius: u.music_zone_radius!,
        // Only friends are ever drawn here — the server withholds
        // `zone_audio_url` from everyone else — so naming them reveals nothing
        // their marker does not already caption.
        label: `@${u.username}`,
        color: zoneRingColor(u.username),
      });
    }
    return zones;
  }, [visibleNearby, displayCoords, selfZone, colors.purple]);

  /**
   * Every circle the eye can see, so the fan can be held inside them.
   *
   * This constraint exists to stop a marker being displaced out of a circle it
   * is standing in, which is only ever a lie about a boundary the viewer can
   * *see* — so the list is exactly the circles that get drawn, taken from
   * `musicZones` rather than recomputed. They used to be two independent
   * conditions and they had already drifted apart: this one asked for
   * `music_zone_separate` where the drawing asked for `zone_audio_url`, so it
   * constrained rings that were not on screen and ignored ones that were.
   *
   * Region zones are deliberately absent. The fan is capped at tens of metres
   * and no displacement that small can move anyone out of a city, so a polygon
   * has nothing to constrain here.
   */
  const zoneAreas = useMemo<ZoneArea[]>(() => {
    const areas: ZoneArea[] = [];
    if (
      displayCoords && selfZone?.zone_active &&
      selfZone.zone_mode === 'radius' && (selfZone.zone_radius ?? 0) > 0
    ) {
      areas.push({ ...displayCoords, radius: selfZone.zone_radius });
    }
    // Other people's detection zones are not drawn, so they are not here: an
    // undrawn circle has no boundary to be flung across.
    for (const { center, radius } of musicZones) {
      areas.push({ ...center, radius });
    }
    return areas;
  }, [musicZones, displayCoords, selfZone]);

  /** A badge is only worth drawing when the ring it labels is big enough on
   *  screen to read as a ring. Zoomed out, a 200m circle is a few pixels wide
   *  and its label would be a chip floating over nothing. */
  const musicBadgeVisible = useCallback((radius: number) => {
    const metersPerPx = mapH > 0 ? (zoomDelta * M_PER_DEG) / mapH : 0;
    return metersPerPx > 0 && radius / metersPerPx >= 24;
  }, [mapH, zoomDelta]);

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

  /** Badges and leader lines the map is currently holding open.
   *
   * Both come and go with the zoom, and neither may be unmounted to do it — see
   * `PARKED_MARKERS`. So each renders from a fixed run of slots, and the run
   * only ever grows: a slot with nothing to draw parks rather than leaving.
   * The high-water marks are state rather than refs: they are read back while
   * rendering to size the run, and a ref read during render is what stops the
   * compiler optimising this screen. Raising one during render re-runs this
   * component before anything is painted, and since a mark only ever grows —
   * bounded by the piles a screen can hold — it settles in one extra pass. */
  const [badgeSlots, setBadgeSlots] = useState(0);
  const [leaderSlots, setLeaderSlots] = useState(0);

  /** Badge, or nothing, for each slot. Drawable filter first, so an unusable
   *  coordinate parks its slot instead of shifting every badge after it. */
  const drawableBadges = useMemo(
    () => markerLayout.clusters.filter((c) => isDrawable(c.position)),
    [markerLayout],
  );
  if (drawableBadges.length > badgeSlots) setBadgeSlots(drawableBadges.length);
  const badges = useMemo(
    () => Array.from({ length: badgeSlots }, (_, i) => drawableBadges[i] ?? null),
    [drawableBadges, badgeSlots],
  );

  /** Leader lines: the dashes from a moved marker back to where its owner
   *  really is, and from a nudged badge back to the pile it counts. */
  const leaderLines = useMemo(
    () => [
      ...Array.from(markerLayout.placed.values()),
      ...markerLayout.clusters,
    ]
      // Both ends validated: a single bad coordinate in a Polyline is enough to
      // bring the native map down.
      .filter((item) => item.anchor && isDrawable(item.anchor) && isDrawable(item.position))
      .map((item) => [item.anchor!, item.position]),
    [markerLayout],
  );
  if (leaderLines.length > leaderSlots) setLeaderSlots(leaderLines.length);
  const leaders = useMemo(
    () => Array.from({ length: leaderSlots }, (_, i) => leaderLines[i] ?? null),
    [leaderLines, leaderSlots],
  );

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

  function handleHiSent() {
    fetchFriends();
    setHiToast(true);
    if (hiToastTimer.current) clearTimeout(hiToastTimer.current);
    hiToastTimer.current = setTimeout(() => setHiToast(false), 1500);
  }

  const fetchMapData = useCallback(async () => {
    try {
      const r = await api.get<MapNearbyResponse>('/api/map/nearby/');
      const { users, stories, meetups } = r.data;
      // Stories and meetups are ModelSerializer output, so their coordinates
      // arrive as strings and have to be coerced before they reach a Marker —
      // see services/coords.ts. `users` is hand-assembled server-side and comes
      // through numeric today; it goes through the same gate anyway so one
      // serializer changing shape can't put the redbox back.
      setNearby(withNumericCoordsList(users));
      const placedStories = normalizeStories(stories);
      setStories(placedStories);
      placedStories.forEach(s => { if (s.image) Image.prefetch(s.image); });
      const now = Date.now();
      setClubMeetups(
        withNumericCoordsList(meetups).filter((e) => new Date(e.expires_at).getTime() > now),
      );
    } catch {}
  }, []);

  function openStoryViewer(authorStories: Story[]) {
    sheetY.set(SHEET_H);
    setOpenUser(null);
    setSelectedMeetup(null);
    setOpenStories(authorStories);
  }

  async function reactToStory(storyId: number, reaction: ReactionType) {
    try {
      await api.post(`/api/stories/${storyId}/react/`, { reaction });
      const applyReaction = <T extends Story>(s: T): T => {
        if (s.id !== storyId) return s;
        const wasActive = s.user_reaction === reaction;
        const updated = { ...s.reactions };
        if (s.user_reaction) updated[s.user_reaction] = Math.max(0, updated[s.user_reaction] - 1);
        if (!wasActive) updated[reaction] = (updated[reaction] ?? 0) + 1;
        return { ...s, reactions: updated, user_reaction: wasActive ? null : reaction };
      };
      // Only the master list is patched: the open viewer reads its rows out of
      // it, so it picks the reaction up from here without a copy of its own.
      setStories((prev) => prev.map(applyReaction));
      await fetchMapData();
    } catch (error: any) {
      console.log('[Reaction] error:', error.response?.status, JSON.stringify(error.response?.data));
    }
  }

  async function createStory(text: string, photoUri: string | null) {
    const c = createStoryCoord ?? coordsRef.current;
    if (!c) throw new Error('No location');
    const lat = parseFloat(c.latitude.toFixed(6));
    const lng = parseFloat(c.longitude.toFixed(6));
    try {
      // The photo goes straight to Cloudinary; Django only ever sees the URL.
      // One hop instead of two, and no Railway worker held for the transfer.
      const imageUrl = photoUri ? await uploadImageToCloudinary(photoUri) : null;
      const response = await api.post('/api/stories/', {
        content: text,
        latitude: lat,
        longitude: lng,
        ...(imageUrl ? { image_url: imageUrl } : {}),
      });
      // The POST echoes the story back through the same serializer as the map
      // poll, so its coordinates need the same coercion — this is the one path
      // that puts a marker on screen without going through fetchMapData first.
      const [newStory] = normalizeStories([response.data]);
      if (!newStory) throw new Error('Story saved without a usable position');
      setStories(prev => [...prev, newStory]);
      recordOwnStory(newStory);
      setTimeout(() => fetchMapData(), 500);
    } catch (error: any) {
      console.log('[Story] error:', error.response?.status ?? error.message);
      throw error;
    }
  }

  // Self data is refetched on every focus: a fetch that failed right after
  // login would otherwise never retry (leaving the owner's zone invisible),
  // and changes made in Zone Setup must show up when returning to the map.
  const loadSelf = useCallback(() => {
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
          music_zone_separate: Boolean(d.music_zone_separate),
          // `music_radius_m` is the server resolving the "separate or
          // inherited" question, so the map never has to answer it twice.
          music_zone_radius:
            Number(d.music_radius_m) > 0 ? Number(d.music_radius_m) : Number(d.zone_radius) || 500,
          // `!== false`, not `Boolean(...)`: on is the server's default and an
          // older build's response has no such key. Reading a missing field as
          // "muted" would take the ring off the map for everyone who has not
          // touched the switch.
          music_zone_active: d.music_zone_active !== false,
          has_track: Boolean(d.zone_audio_url),
        };
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
      // Not asked for here — this fires on every watch (re)start, including
      // the permission-regained effect below, and re-asking on every one of
      // those would be a dialog storm. The one place that primes and requests
      // it is the mount effect, once, right after foreground is granted. This
      // call only starts the OS task if that already succeeded.
      await startBackgroundLocationUpdates();
      const init = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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
    }
    // Always reached — the `catch` only logs — so the re-entrancy guard is
    // released on both paths without a `finally`, which React Compiler cannot
    // compile and which would cost this screen its auto-memoization.
    startingWatchRef.current = false;
  }, []);

  useEffect(() => {
    (async () => {
      // Primed, not cold. The old code fired the system dialog the instant the
      // map mounted — this sheet explains first so the one shot iOS gives a
      // cold "Don't Allow" is not spent on a dialog nobody had context for.
      const granted = await ensurePermission('location');
      if (!granted) {
        const info = await checkPermission('location');
        setPermState(info.state);
        return;
      }
      setPermState('granted');
      await startWatching();
      // Background gets no primer sheet of its own — straight to the OS
      // dialog once foreground is already granted and the map is working.
      await requestPermission('locationBackground');
      await startBackgroundLocationUpdates();
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

    await Promise.allSettled([
      // Honours the Location sharing setting; sends nothing when paused.
      // Speed rides along on the same request — the server buckets it into a
      // coarse class and never stores the figure itself.
      reportLocation({ latitude: c.latitude, longitude: c.longitude }, speedRef.current),
      fetchMapData(),
    ]);
  }, [fetchMapData, loadSelf]);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start the tick when coords first arrive; stop when the component unmounts.
  useEffect(() => {
    if (!coords) return;
    tick();
    tickRef.current = setInterval(tick, POLL_MS);
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [!!coords]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause the tick when the app goes to the background and resume on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      } else if (coordsRef.current && !tickRef.current) {
        tick();
        tickRef.current = setInterval(tick, POLL_MS);
      }
    });
    return () => sub.remove();
  }, [tick]);

  // Register tick as the global refresh so other screens can trigger it
  useEffect(() => {
    registerNearbyRefresh(tick);
  }, [tick]);

  useEffect(() => {
    registerMeetupRemove((id) => {
      setClubMeetups((prev) => prev.filter((m) => m.id !== id));
    });
  }, []);



  // The sheet and the story viewer used to be re-synced here after every fetch.
  // Both now read their rows out of the live lists as they render, so there is
  // nothing left to copy across.

  function openSheet(user: NearbyUser) {
    setSelectedMeetup(null);
    setOpenUser(user);
    sheetY.set(withSpring(0, SPRING_CFG));
  }

  function closeSheet() {
    sheetY.set(withSpring(SHEET_H, SPRING_CFG, (done) => {
      if (done) scheduleOnRN(setOpenUser, null);
    }));
  }

  function openMeetupSheet(meetup: ClubMeetup) {
    setOpenStories(null);
    setOpenUser(null);
    setSelectedMeetup(meetup);
    sheetY.set(withSpring(0, SPRING_CFG));
  }

  function closeMeetupSheet() {
    sheetY.set(withSpring(SHEET_H, SPRING_CFG, (done) => {
      if (done) scheduleOnRN(setSelectedMeetup, null);
    }));
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
    setFollowRequested(false);
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
    setFollowRequested(true);
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

  // Keep last non-null selection cached so the sheets stay mounted. Caught
  // during render, not from an effect: the sheet has to have its content on the
  // first painted frame, or opening it flashes an empty panel. Both conditions
  // go false on the retry, so this settles in one extra pass.
  if (selectedUser && selectedUser !== sheetUser) setSheetUser(selectedUser);
  if (selectedMeetup && selectedMeetup !== sheetMeetup) setSheetMeetup(selectedMeetup);

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
            setMapH(e.nativeEvent.layout.height);
          }}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          customMapStyle={mapStyleFor(themeMode)}
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
          {/* Other people's detection zones are deliberately not drawn.
              A zone is a radar: it decides who *its owner* can find. Seeing a
              stranger's radar tells you nothing you can act on — you are on it
              or you are not, and either way the answer is already the fact that
              they are on your screen. What it did do was fill the map with
              overlapping teal circles, one per person, until the only thing
              legible was the circles.
              Your own zone is below, because that one is a tool: it is the
              reach you are tuning when you change its size. And music zones
              stay, because those answer a question you can act on — walk
              inside one and you can hear what is playing. */}

          {/* Earshot, wherever nothing else is already drawing it. Someone
              else's ring is drawn when the viewer is allowed to hear their
              track; the viewer's own when their zone circle is not standing in
              for it — see `selfEarshotRing`. A ring is worth the ink when it
              means "the music stops here", and is noise when it traces the
              circle already underneath it.
              A hairline and nothing else. What identifies it as *music* is the
              badge on its edge, not the stroke — the map already has circles in
              this colour, and shouting with opacity would only have made a
              louder anonymous ring. Not dashed either: `lineDashPattern` on a
              Circle is Apple-Maps-only and this map is PROVIDER_GOOGLE, so the
              dashes would silently never appear. */}
          {/* Colours come from the palette, not from literals.
              Somebody else's ring used to be a hardcoded rgba(31,199,182) —
              the *dark* theme's teal — so on the light map it stayed a pale
              teal thread over a near-white basemap and simply could not be
              seen. The light palette answers `teal` with a strong orange, the
              same colour those people's markers already use, so taking the hue
              from `colors` fixes the contrast and makes the ring match the dots
              it belongs to. Dark mode is unchanged. */}
          {musicZones.map(({ key, center, radius, color }) => (
            <Circle
              key={key}
              center={center}
              radius={radius}
              fillColor="transparent"
              strokeColor={withAlpha(color, 0.6)}
              strokeWidth={1.5}
            />
          ))}

          {/* Own zone.
              One polygon per *piece*, not per ring: a region straddling the
              ±180 meridian is cut in two there, so it draws as the island group
              it is instead of as a band stretched around the planet. Regions
              that do not cross come back as a single piece, unchanged. */}
          {selfZone?.zone_active && selfZone.zone_mode === 'region' && selfZone.zone_region_id
            ? selfZoneRings.map((piece) => (
                <Polygon
                  // Keyed on where the piece starts: the split is deterministic,
                  // so a piece keeps its identity until the region itself moves.
                  key={`self-zone-${piece[0].latitude},${piece[0].longitude}`}
                  coordinates={piece}
                  fillColor={withAlpha(colors.purple, 0.05)}
                  strokeColor={withAlpha(colors.purple, 0.35)}
                  strokeWidth={1.5}
                />
              ))
            : selfZone?.zone_active && (selfZone.zone_radius ?? 0) > 0 && (
              <Circle
                center={displayCoords}
                radius={selfZone.zone_radius}
                fillColor={withAlpha(colors.purple, 0.07)}
                strokeColor={withAlpha(colors.purple, 0.35)}
                strokeWidth={1.5}
              />
            )}

          {/* The chip that says which ring is which — literally, now: a
              friend's ring is labelled with their @name and drawn in their own
              colour, so two overlapping circles are two people rather than one
              anonymous smudge. Drawn after every circle so it sits on top of
              them, and skipped when the ring is too small on screen for a label
              to mean anything. Your own is included: where your music stops is
              the one thing you cannot check by listening. */}
          {musicZones.filter((z) => musicBadgeVisible(z.radius)).map((z) => (
            <MusicZoneBadge
              key={`${z.key}-badge`}
              center={z.center}
              radius={z.radius}
              mine={z.mine}
              label={z.label}
              color={z.color}
            />
          ))}

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
              one table are tens of metres apart. Drawn under the markers.
              Slotted, and a spare slot collapses onto the owner's own point in
              full transparency rather than unmounting — see PARKED_MARKERS. */}
          {leaders.map((line, i) => (
            <Polyline
              key={`leader-slot-${i}`}
              coordinates={line ?? [displayCoords, displayCoords]}
              strokeColor={line ? 'rgba(244,244,246,0.28)' : 'transparent'}
              strokeWidth={1}
              lineDashPattern={[3, 3]}
              zIndex={2}
            />
          ))}

          {visibleNearby.filter((u) => u.latitude != null && u.longitude != null).map((user) => {
            // Absent from `placed` means this person was folded into a headcount
            // badge. Drawing them as well would put two of them on the map — so
            // the marker parks: transparent, untappable, still mounted. The
            // unmount it replaces is the one that left a face behind under the
            // badge on every pinch. See PARKED_MARKERS.
            const layout = markerLayout.placed.get(`u-${user.id}`);
            const truePos = { latitude: user.latitude, longitude: user.longitude };
            const parked = !layout || !isDrawable(layout.position);
            // Nowhere legal to stand at all: the one case still worth skipping,
            // since a Marker needs a coordinate the native map can survive.
            if (parked && !isDrawable(truePos)) return null;
            const position = parked ? truePos : layout!.position;

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
                coordinate={position}
                parked={parked}
                uri={user.profile_picture}
                username={user.username}
                ringColor={color}
                presence={user.presence}
                motion={user.motion_class}
                // Dropped when this marker shares its spot: the fan separates
                // rings, and a name chip is wider than the ring it hangs under.
                caption={layout?.crowded ? undefined : user.username}
                // Friends and connections both have zone access. The tag
                // marks a track you can play, so it follows the track rather
                // than the map-zone switch.
                captionTag={
                  !layout?.crowded && (isFriend || isConnected) && user.zone_audio_url ? 'zone' : undefined
                }
                zIndex={Z_FRIEND}
                onPress={() => openSheet(user)}
              />
            ) : (
              <DotMarker
                key={user.id}
                coordinate={position}
                parked={parked}
                color={color}
                presence={user.presence}
                sharedInterests={user.shared_interests}
                // The interest *name* is this marker's caption and the widest
                // thing it draws — four of them stacked down a street is what
                // made the map unreadable. The glyph inside the dot still says
                // which interest it is, so only the word goes.
                showCaption={!layout?.crowded}
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
              fillColor={withAlpha(colors.purple, 0.06)}
              strokeColor={withAlpha(colors.purple, 0.22)}
              strokeWidth={1}
            />
          )}

          {/* Piles that could not be fanned apart without moving someone too far
              — which is what zooming out does to a pixel-sized fan. A number
              instead, and a tap to go in and see who.
              Slots, not badges: zooming back in empties a slot rather than
              removing it, because a removed badge is the one that stayed on the
              map on top of the faces it had been standing in for. An empty slot
              parks on the owner's own point, where it is invisible, one pixel
              wide and deaf to taps. See PARKED_MARKERS. */}
          {badges.map((cluster, i) => (
            <ClusterMarker
              key={`cluster-slot-${i}`}
              coordinate={cluster ? cluster.position : displayCoords}
              count={cluster ? cluster.count : 0}
              parked={!cluster}
              onPress={cluster ? () => zoomToCluster(cluster.anchor ?? cluster.position) : undefined}
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

          {/* `isDrawable` as well as the numeric coercion at the boundary: the
              two answer different questions. services/coords.ts guarantees a
              real coordinate; this guarantees one Google's Mercator projection
              can actually place, which stops above ±85°. People's markers have
              always been filtered this way — stories and meetups were not, and
              were the two that could reach the native map unchecked. */}
          {Array.from(storiesByAuthor.entries())
            .filter(([, authorStories]) => isDrawable(authorStories[0]))
            .map(([authorId, authorStories]) => (
              // Keyed by author *and* newest story, so a fresh story remounts
              // the marker rather than reusing a stale frozen snapshot.
              <StoryMarker
                key={`story-author-${authorId}-${authorStories[0].id}`}
                stories={authorStories}
                onPress={() => openStoryViewer(authorStories)}
              />
            ))}

          {/* Approved club meetup pins — one per event, above story bubbles. */}
          {clubMeetups.filter(isDrawable).map((meetup) => (
            <MeetupMarker
              key={`meetup-${meetup.id}`}
              meetup={meetup}
              onPress={() => openMeetupSheet(meetup)}
            />
          ))}
        </MapView>
      )}

      {/* Top bar */}
      <TopBar
        nearby={visibleNearby.length}
        onZoneMusic={() => router.push('/zone')}
        onSearch={() => router.push('/search')}
        onList={() => router.push('/nearby')}
      />

      {/* The one place the map admits it is drawing on a shifted basemap.
          Stated rather than silently corrected: everything here — your dot,
          everyone else's, the zone outline — is in true GPS coordinates and
          agrees with itself, but the tiles underneath are offset. */}
      {chinaOffsetNotice && mapVisible ? (
        <View
          style={[styles.offsetNotice, { top: topInset + 52 }]}
          accessible
          accessibilityRole="alert"
        >
          <Text style={styles.offsetNoticeText}>{MAINLAND_CHINA_NOTICE}</Text>
        </View>
      ) : null}

      {/* User detail sheet — kept mounted after first tap to avoid remount cost. */}
      {sheetUser && (
        <View
          style={[StyleSheet.absoluteFill, { opacity: selectedUser ? 1 : 0 }]}
          pointerEvents={selectedUser ? 'box-none' : 'none'}
        >
          <UserSheet
            user={sheetUser}
            sheetY={sheetY}
            onDismiss={closeSheet}
            onFriendChange={handleHiSent}
            viewerCoords={displayCoords ?? null}
            zoneRegion={
              sheetUser.zone_region_id
                ? regionOutlines.get(sheetUser.zone_region_id) ?? null
                : null
            }
          />
        </View>
      )}

      {/* Club meetup detail sheet — same pre-mount strategy. */}
      {sheetMeetup && (
        <View
          style={[StyleSheet.absoluteFill, { opacity: selectedMeetup ? 1 : 0 }]}
          pointerEvents={selectedMeetup ? 'box-none' : 'none'}
        >
          <MeetupSheet
            meetup={sheetMeetup}
            sheetY={sheetY}
            onDismiss={closeMeetupSheet}
          />
        </View>
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
            onClose={() => setOpenStories(null)}
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
      {mapVisible && !selectedUser && !selectedMeetup && !storyViewer && createStoryCoord === null && (
        <LocateButton state={locateState} bottom={locateBottom} onPress={handleLocatePress} />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
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
  /** Column so the caption sits under the halo and inside the rasterized box. */
  dotColumn: { alignItems: 'center' },
  dotWrap: {
    width: DOT_HALO,
    height: DOT_HALO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The interest glyph's core. A ringed disc rather than a filled one: the
   *  icon needs a dark field to stay legible over a light map, and the ring is
   *  what keeps it reading as the same lit-point idiom as a bare dot. */
  dotIconCore: {
    width: DOT_CORE + 12,
    height: DOT_CORE + 12,
    borderRadius: (DOT_CORE + 12) / 2,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    // The glow itself is applied inline, as a `boxShadow` built from the
    // marker's interest colour — see the `dotIconCore` call site.
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
    // The glow itself is applied inline, as a `boxShadow` built from the
    // marker's colour — see the `userDot` call site. Android still rasterizes
    // the marker and drops it, which is why the bloom above does the same job
    // structurally.
  },

  /** Presence badge, pinned to the dot's lower-right so it reads as attached
   * to that person rather than as a second pin beside them. Offset from the
   * halo box's edge, since that is what the badge is positioned against. */
  dotPresence: {
    position: 'absolute',
    right: (DOT_HALO - DOT_CORE) / 2 - 2,
    bottom: (DOT_HALO - DOT_CORE) / 2 - 2,
  },
  /** Same badge against the larger icon core, so it stays on its edge rather
   *  than floating inside it. */
  dotPresenceIcon: {
    right: (DOT_HALO_ICON - (DOT_CORE + 12)) / 2 - 2,
    bottom: (DOT_HALO_ICON - (DOT_CORE + 12)) / 2 - 2,
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
  /** What a marker draws while it is parked — see `PARKED_MARKERS`.
   *
   *  Not merely transparent: `opacity` hides the pixels but the rasterized
   *  bitmap keeps its size, and a 52 px bitmap still swallows every tap that
   *  lands on it, including the long-press that drops a story. One pixel has
   *  nothing left to swallow. */
  parkedMarker: { width: 1, height: 1 },

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

  // ── Music-zone label ──
  // Deliberately smaller and quieter than the cluster badge it borrows its
  // shape from: a cluster is something to tap, this is something to read.
  musicBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.bg,
    borderWidth: 1,
    // Overridden per zone with that person's own colour — this is the fallback
    // for a chip drawn before one is resolved.
    borderColor: colors.tealLine,
    opacity: 0.92,
    // A username has no length limit; a chip pinned to the edge of a circle
    // does. Past this the name truncates rather than growing a label wider
    // than the ring it belongs to.
    maxWidth: 120,
  },
  musicBadgeText: {
    fontFamily: fonts.body,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: colors.teal,
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
    backgroundColor: colors.bg + 'D2',
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

  // ── Basemap offset notice (mainland China only) ──
  offsetNotice: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.m,
    backgroundColor: 'rgba(10,10,11,0.86)',
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 99,
  },
  offsetNoticeText: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: '#F5F5F7',
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

  // ── Meetup marker: purple bubble pin with emblem or calendar icon ──
  meetupMarkerWrap: { alignItems: 'center' },
  meetupMarkerBubble: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(139,92,246,0.4)',
  },
  meetupMarkerImg: { width: 32, height: 32, borderRadius: 8 },
  meetupMarkerTail: {
    width: 12,
    height: 12,
    backgroundColor: colors.purple,
    transform: [{ rotate: '45deg' }],
    marginTop: -7,
    borderBottomRightRadius: 3,
  },

  // ── Meetup sheet ──
  meetupSheetEmblem: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  meetupSheetEmblemFallback: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meetupExpiryPill: {
    backgroundColor: 'rgba(139,92,246,0.15)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.3)',
  },
  meetupExpiryText: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: colors.purple,
  },
  meetupDetailBlock: { gap: 10, marginBottom: 20 },
  meetupDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meetupDetailText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
  },
  meetupDescription: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
    lineHeight: 19,
    marginTop: 4,
  },
});
