import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
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
    type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GestureDetector } from 'react-native-gesture-handler';

import { ApproxNav } from '@/components/ApproxNav';
import { PinNoteEditor } from '@/components/PinNoteEditor';
import { STORY_LIKE } from '@/components/storyReactions';
import { StoryViewer } from '@/components/StoryViewer';
import { StoryTutorialOverlay } from '@/components/tutorial/StoryTutorialOverlay';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassBackdrop, GlassSurface } from '@/components/ui/GlassSurface';
import { useSheetDrag } from '@/components/ui/useSheetDrag';
import {
    IconBookmark,
    IconCalendar,
    IconCamera,
    IconCheck,
    IconChevron,
    IconClose,
    IconEyeOff,
    IconGhost,
    IconHi,
    IconImage,
    IconList,
    IconLocate,
    IconLocateFixed,
    IconLocateOff,
    IconLock,
    IconMusic,
    IconPencil,
    IconPeople,
    IconPin,
    IconSearch,
} from '@/components/ui/icons';
import { iconForInterest } from '@/components/ui/interestIcons';
import { ZonePlayer } from '@/components/ZonePlayer';
import { mapStyleFor } from '@/constants/mapStyle';
import {
    CAPTION_GAP,
    CAPTION_H,
    isDrawable,
    offsetByMeters,
    SELF_KEY,
    type ClusterResult,
    type FanResult,
    type GeoPoint,
    type MarkerLayout,
} from '@/services/markerLayout';
import { fonts, radius, type, withAlpha } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { useNavAlignedRight, useNavClearance, useNavContentPadding } from '@/hooks/useNavMetrics';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { api } from '@/services/api';
import { runBusy } from '@/services/busy';
import { DirectionsSheet } from '@/components/DirectionsSheet';
import { usePermissionPrimer } from '@/components/PermissionPrimer';
// `PermissionState` explicitly, not the DOM global of the same name — that one
// is 'granted' | 'denied' | 'prompt', so leaving it unimported makes the
// `=== 'blocked'` checks below silently type-error instead of resolving here.
import { openAppSettings, type PermissionState } from '@/services/permissions';
import { motionLabel, presenceLabel, type MotionClass, type Presence } from '@/services/presence';
import { MotionTrail } from '@/components/MotionTrail';
import { PresenceDot } from '@/components/PresenceDot';
import { useMapData } from '@/hooks/useMapData';
import { useMapLocation, type LocateState } from '@/hooks/useMapLocation';
import { useMapOverlays, type MapOverlays, type MusicZone } from '@/hooks/useMapOverlays';
import { useMapSheets, SHEET_H, SPRING_CFG } from '@/hooks/useMapSheets';
import { useMarkerSlots, type MarkerSlots } from '@/hooks/useMarkerSlots';
import { useMotionTrails } from '@/hooks/useMotionTrails';
import { useStoryComposer } from '@/hooks/useStoryComposer';
import { useStoryTutorial } from '@/hooks/useStoryTutorial';
import { useVisiblePeople } from '@/hooks/useVisiblePeople';
import {
    MAX_PINS,
    pinIdFor,
    pinMeetup,
    setPinnedNote,
    unpinPlace,
    usePinnedPlaces,
    type PinnedPlace,
} from '@/services/pinnedPlaces';
import { useSmoothedPosition } from '@/services/positionSmoothing';
import { useGhostMode } from '@/services/privacy';
import { fmtRadius, trackTitle } from '@/services/zoneAudio';
import { MAINLAND_CHINA_NOTICE } from '@/services/gcj02';
import type { ReactionType, Story } from '@/services/stories';
import type {
    ClubMeetup,
    NearbyUser,
    Relationship,
    SelfZone,
} from '@/services/mapTypes';

// ─── Types ────────────────────────────────────────────────────────────────────
// The payload shapes live in services/mapTypes so the hooks below can share
// them without importing this screen back. Everything still local is a prop
// bag for a component in this file.

// ─── Constants ────────────────────────────────────────────────────────────────
// Ring colour carries the relationship, and nothing else does: blue is a
// friend, orange is a connection, teal is a matched stranger. One colour per
// state, used on the marker, in the sheet and on the zone.
// COLOR_FRIEND / COLOR_CONNECTED / COLOR_STRANGER are computed inside
// `PeopleLayer` from the dynamic theme — see below.

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
/** Above the meetup pins it can sit on top of. A pinned place is the one thing
 *  on this map the viewer put there themselves, so when two markers land on the
 *  same spot theirs is the one that should be tappable. */
const Z_PIN     = 9;

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

// ─── Two things this screen deliberately no longer does ───────────────────────
/*
 * Both used to live in the middle of MapScreen, as notes about code that had
 * been taken out. They are here instead because they describe absences, and an
 * absence has no line to sit next to.
 *
 * **Nearby people do not generate alerts.** They used to, from this screen —
 * "@miras is nearby · 180m away", "@aisha shares your interests". Being
 * somewhere is not an event, and the map already shows who is around. The
 * markers are the whole of it now.
 *
 * **Zone audio is not the map's to play.** There is no screen-level sound, no
 * autoplay when you cross into someone's circle, and nothing to stop on
 * unmount: a friend's track is loaded by the player inside their card and
 * unloaded when that card closes. Walking into a zone is an invitation, not a
 * command to a stranger's phone speaker.
 */

const REL_LABEL: Record<Relationship, string> = {
  stranger:  'Nearby',
  hi_sent:   'Hi Sent',
  connected: 'Connected',
  friend:    'Friend',
};

// SHEET_H and SPRING_CFG describe the sheet animation and live with it, in
// hooks/useMapSheets. Imported above; the drag handles below share them so a
// flick and a programmatic dismiss settle identically.
/** Travel for the story composer, which is its own `Modal` rather than one of
 *  the two sheets `SHEET_H` describes — see `CreateStoryModal`. Taller,
 *  because it holds a photo well and a keyboard-avoiding text field. */
const STORY_SHEET_H = 620;

// ── Locate control ──
// FOCUS_DELTA, RECENTER_MS and STALE_FIX_MS moved with the camera they drive,
// into hooks/useMapLocation. What is left here is what the button *looks* like.
const LOCATE_SIZE = 48;   // ≥ 44pt target
/** Edge inset, used on the wheel. On the tab bar the button tracks the last
 *  tab instead — see `useNavAlignedRight`. Matches the top bar's padding. */
const LOCATE_INSET = 20;
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
/**
 * The word under a marker, with an optional coloured suffix.
 *
 * Shared by the dot and the avatar because they render the same thing for
 * different reasons — "+2 more shared interests" on one, "· zone" on the other
 * — and the caption has to keep the same height in both or a mixed map reads
 * as two different kinds of pin.
 */
function MarkerCaption({ text, tag, tagColor }: {
  text?: string;
  tag?: string;
  tagColor: string;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  if (!text) return null;
  return (
    <View style={styles.markerCaption}>
      <Text style={styles.markerCaptionText} numberOfLines={1}>
        {text}
        {tag ? <Text style={[styles.markerCaptionTag, { color: tagColor }]}>{tag}</Text> : null}
      </Text>
    </View>
  );
}

/**
 * The picture inside an avatar marker's ring, or the coloured initial that
 * stands in for it.
 *
 * `uri` arrives already blanked when a load has failed, so the fallback here is
 * the single "no picture to show" path — a missing uri and a broken one look
 * the same to the person reading the map.
 */
function AvatarFace({ uri, username, inner, onLoaded, onFailed }: {
  uri?: string;
  username: string;
  inner: number;
  onLoaded: (uri: string) => void;
  onFailed: (uri: string) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const round = { width: inner, height: inner, borderRadius: inner / 2 };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={round}
        onLoad={() => onLoaded(uri)}
        onError={() => onFailed(uri)}
      />
    );
  }

  return (
    <View style={[styles.avatarMarkerFallback, round, { backgroundColor: avatarBgColor(username) }]}>
      <Text style={styles.avatarMarkerInitial}>
        {username ? username.charAt(0).toUpperCase() : '?'}
      </Text>
    </View>
  );
}

/** What a stranger's dot announces to a screen reader. */
function dotAccessibilityLabel(primary?: string, extra = 0): string {
  if (!primary) return 'Someone nearby with a shared interest';
  const more = extra > 0 ? `, and ${extra} more shared` : '';
  return `Someone nearby who also likes ${primary}${more}`;
}

/**
 * The lit disc itself: bloom, core and presence pip.
 *
 * Split from `DotMarker` so that component is only about where the marker sits
 * and when it re-rasterizes, while this one is only about what it looks like.
 */
function DotGlyph({ color, haloH, presence, InterestIcon }: {
  color: string;
  haloH: number;
  presence?: Presence;
  InterestIcon: ReturnType<typeof iconForInterest> | null;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.dotWrap, { width: haloH, height: haloH }]}>
      {/* Two discs, not one: a wide faint bloom and a tighter brighter one,
          which is what makes the dot read as lit from within rather than as
          a flat circle sitting on the map. */}
      <View style={[styles.dotBloom, { width: haloH, height: haloH, borderRadius: haloH / 2, backgroundColor: color }]} />
      {InterestIcon ? (
        <View style={[styles.dotIconCore, { borderColor: color, boxShadow: `0 0 5px ${withAlpha(color, 0.9)}` }]}>
          {InterestIcon({ size: 13, color })}
        </View>
      ) : (
        <>
          <View style={[styles.dotGlow, { backgroundColor: color }]} />
          <View style={[styles.userDot, { backgroundColor: color, boxShadow: `0 0 5px ${withAlpha(color, 0.9)}` }]} />
        </>
      )}
      {/* Absent presence renders nothing — PresenceDot returns null — so a
          hidden state never becomes a visible "offline". */}
      <View style={[styles.dotPresence, InterestIcon && styles.dotPresenceIcon]}>
        <PresenceDot presence={presence} size={8} haloColor={colors.bg} />
      </View>
    </View>
  );
}

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
  const styles = makeStyles(colors);
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
      accessibilityLabel={parked ? undefined : dotAccessibilityLabel(primary, extra)}
      onPress={parked ? undefined : onPress}
    >
      {parked ? <View style={styles.parkedMarker} /> : (
      /* Android clips marker children to their parent box when it rasterizes,
         so the halo and the caption both have to live inside this column. */
      <View style={styles.dotColumn}>
        <DotGlyph
          color={color}
          haloH={haloH}
          presence={presence}
          InterestIcon={InterestIcon}
        />
        <MarkerCaption
          text={captionText}
          tag={extra > 0 ? ` +${extra}` : undefined}
          tagColor={color}
        />
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

  // Safety valve. `tracksViewChanges` below is `!imageReady` — true, and the
  // marker re-rasterizing every frame, for as long as this stays false. A uri
  // whose fetch neither loads nor errors (a stalled CDN, a host that hangs
  // rather than 404s) would otherwise leave that running forever, which is
  // the exact "re-rasterizing until it runs out of memory" crash the fan
  // logic elsewhere in this file already has scars from — see the badgeKey
  // comment in services/markerLayout.ts. Giving up after a few seconds trades
  // a permanently-blank avatar for an app that stays open.
  useEffect(() => {
    if (imageReady) return;
    const timer = setTimeout(() => setLoad({ uri, ready: true, failed: true }), 8000);
    return () => clearTimeout(timer);
  }, [uri, imageReady]);

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
          <AvatarFace
            uri={imageFailed ? undefined : uri}
            username={username}
            inner={inner}
            onLoaded={(loadedUri) => {
              loadedAvatars.add(loadedUri);
              setTimeout(() => setLoad({ uri: loadedUri, ready: true, failed: false }), 250);
            }}
            onFailed={(failedUri) => setLoad({ uri: failedUri, ready: true, failed: true })}
          />
          <View style={styles.markerPresence}>
            <PresenceDot presence={presence} size={10} haloColor={colors.bg} />
          </View>
        </View>

        <MarkerCaption
          text={caption}
          tag={captionTag ? ` · ${captionTag}` : undefined}
          tagColor={ringColor}
        />
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
function SelfMarker({ coordinate, uri, username, hidden = false }: {
  coordinate: { latitude: number; longitude: number };
  uri?: string;
  username: string;
  /** True while sharing is Paused — nobody else has this marker on their map. */
  hidden?: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  // Where the dot is drawn: the smoothed position when there is one, and the
  // laid-out coordinate until the first fix has been through the smoother.
  // Falling back rather than waiting matters on the very first frame, when a
  // cached position can put the marker on screen before any fix has landed.
  const smoothed = useSmoothedPosition();
  const drawnAt = smoothed ?? coordinate;
  // Same shape as AvatarMarker: the load state carries the uri it belongs to,
  // so changing your own picture is not a reset an effect has to perform.
  // Seeded from `loadedAvatars`, same as AvatarMarker — without it, a remount
  // (e.g. the map view remounting after a screen pushed on top of it, such as
  // Zone Size, is popped) forgets the picture was already decoded and blanks
  // the ring until it loads again, which read as the avatar vanishing.
  const [load, setLoad] = useState<{ uri?: string; ready: boolean; failed: boolean }>(
    () => ({ uri, ready: !uri || loadedAvatars.has(uri), failed: false }),
  );
  const loadIsCurrent = load.uri === uri;
  const imageReady  = loadIsCurrent ? load.ready  : !uri || loadedAvatars.has(uri);
  const imageFailed = loadIsCurrent ? load.failed : false;

  // Safety valve, same as AvatarMarker: a uri that never resolves (loads or
  // errors) would otherwise leave `tracksViewChanges` true — and this marker
  // re-rasterizing every frame — forever, which is the exact "runs out of
  // memory" crash shape services/markerLayout.ts already documents scars
  // from. This is the owner's own marker, on screen every time the map is
  // open, so it is the one most exposed to a hung fetch running indefinitely.
  useEffect(() => {
    if (imageReady) return;
    const timer = setTimeout(() => setLoad({ uri, ready: true, failed: true }), 8000);
    return () => clearTimeout(timer);
  }, [uri, imageReady]);

  // Pausing mutes the halo and the core, and react-native-maps caches this
  // marker as a bitmap — so the change has to re-arm tracking or the old frame
  // stays on screen and the halo never changes colour.
  //
  // This used to be done by flipping the `key` between 'self-hidden' and
  // 'self-visible'. That does not re-rasterize anything; it unmounts the marker
  // and mounts a new one, and per `PARKED_MARKERS` an unmounted marker is never
  // removed from the native map. Checking in left the paused avatar sitting
  // there next to the live one — two of you, one greyed out. Same fix as every
  // other marker here: keep one Marker mounted and let `tracksViewChanges`
  // redraw it.
  const { settling } = useMarkerSettle(`${hidden}`);

  return (
    <Marker
      coordinate={drawnAt}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={Z_SELF}
      // Unchanged by the smoothing, and worth saying why: this is what the
      // marker *looks like*, not where it is. Moving a Marker's coordinate
      // does not re-rasterize its view, so a position arriving fifteen times a
      // second costs a native coordinate update and nothing else. Flipping
      // this to true for the movement would redraw the avatar every frame —
      // the memory shape services/markerLayout.ts has scars from.
      tracksViewChanges={!imageReady || settling}
    >
      <View style={[styles.selfHalo, hidden && styles.selfHaloHidden]}>
        <View style={[styles.selfCore, hidden && styles.selfCoreHidden]}>
          {uri && !imageFailed ? (
            <Image
              source={{ uri }}
              style={styles.selfAvatar}
              onLoad={() => {
                loadedAvatars.add(uri);
                setTimeout(() => setLoad({ uri, ready: true, failed: false }), 250);
              }}
              onError={(e) => {
                console.log('[Map] self avatar Image failed to load:', uri, e?.error);
                setLoad({ uri, ready: true, failed: true });
              }}
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
function MusicZoneBadge({ center, radius, mine, label, color, parked }: {
  center: GeoPoint;
  radius: number;
  mine?: boolean;
  /** What the chip says: a friend's @name, or your own reach. */
  label: string;
  /** The ring's colour, repeated here so the chip and the circle it labels are
   *  visibly one thing when several overlap. */
  color: string;
  /** Slot currently standing in for no music zone — see `PARKED_MARKERS`. The
   *  ring beside it is a Circle and removes itself cleanly; this chip is a
   *  Marker with a custom child, which is exactly the thing Fabric strands on
   *  the native map. Switching a music zone off has to take the label with the
   *  circle, so the slot parks rather than unmounting. */
  parked?: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // Same reason as ClusterMarker: let it draw, then freeze the raster — and
  // re-arm on every input that changes what the chip says, or a zone resized or
  // recoloured mid-session keeps drawing the label it first froze. Parking is
  // in the key for the same reason it is in ClusterMarker's: a slot that goes
  // quiet has to redraw as the empty spacer or it keeps drawing the last chip.
  const { settling } = useMarkerSettle(`${radius}|${label}|${color}|${parked}`);

  return (
    <Marker
      coordinate={offsetByMeters(center, radius, 0)}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={settling}
      opacity={parked ? 0 : 1}
      zIndex={Z_MUSIC}
      accessibilityLabel={
        parked
          ? undefined
          : mine
            ? `Your music carries ${fmtRadius(radius)}`
            // The name goes first: a screen reader arriving at this chip is
            // answering "whose zone is this", same as the colour does visually.
            : `${label}'s music zone, ${fmtRadius(radius)} across`
      }
    >
      {parked ? (
        <View style={styles.parkedMarker} />
      ) : (
        <View style={[styles.musicBadge, { borderColor: withAlpha(color, 0.55) }]}>
          <IconMusic size={10} color={color} />
          <Text style={[styles.musicBadgeText, { color }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
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

  const likeCount = story.reactions?.like ?? 0;

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
      {likeCount > 0 && (
        <View style={styles.storyReactionPill}>
          {/* Through `STORY_LIKE` rather than naming an icon here, so the
              badge and the viewer's own button cannot end up showing two
              different symbols for the same act. Solid: at 11px an outline
              heart closes up into a blob. */}
          <STORY_LIKE.Icon size={11} color={colors.t2} filled />
          <Text style={styles.storyReactionText}>{likeCount}</Text>
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
// `LocateState` itself lives with the camera it describes, in
// hooks/useMapLocation — this is only what the button draws for each state.

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
  unavailable: 'Approx does not have permission to use your location',
};

function LocateButton({
  state,
  bottom,
  right,
  onPress,
}: {
  state: LocateState;
  bottom: number;
  /** Set by the screen, because where it lands depends on which nav is on —
   *  see `useNavAlignedRight`. */
  right: number;
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
        { bottom, right },
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
      <GlassBackdrop />
      {following && <View style={[StyleSheet.absoluteFill, styles.locateTint]} />}
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
  pinCount,
  onPinned,
  onZoneMusic,
  onSearch,
  onList,
}: {
  /** How many places this viewer has pinned. The bookmark button is drawn only
   *  when there is at least one: an empty list behind a permanent button is a
   *  fourth control on a bar that already has three, bought with nothing. */
  pinCount: number;
  onPinned: () => void;
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
      <Text style={styles.topLogoText} accessibilityRole="header">APPROX</Text>

      {/* The count is the only part of the map a screen reader can reach, so
          it carries the plural and the unit rather than a bare number. */}
      <GlassSurface
        style={styles.nearbyBadge}
        accessible
        accessibilityLabel={`${nearby} ${nearby === 1 ? 'person' : 'people'} nearby`}
      >
        <IconPeople size={16} color={colors.t2} />
        <Text style={styles.nearbyBadgeText} importantForAccessibility="no">
          {nearby} nearby
        </Text>
      </GlassSurface>

      <View style={styles.topSpacer} />

      {pinCount > 0 && (
        <Pressable
          onPress={onPinned}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Pinned places, ${pinCount} saved`}
          accessibilityHint="Opens the places you saved from Swifts and meetups"
        >
          <GlassBackdrop />
          <IconBookmark size={20} color={colors.t2} filled />
        </Pressable>
      )}

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
        <GlassBackdrop />
        <IconList size={20} color={colors.t2} />
      </Pressable>

      <Pressable
        onPress={onSearch}
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Search for people"
      >
        <GlassBackdrop />
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
        <GlassBackdrop />
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
  /** True while location sharing is paused — the story posts, without a pin. */
  locationless?: boolean;
  onClose: () => void;
  onPost: (text: string, photoUri: string | null) => Promise<void>;
}

function CreateStoryModal({ visible, locationless, onClose, onPost }: CreateStoryModalProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const { ensure: ensurePermission, primer } = usePermissionPrimer();

  // This sheet is a `Modal` rather than one of the map's two `sheetY` sheets,
  // so it carries its own offset. Reset whenever it opens: a drag that was
  // released short of the dismiss threshold leaves the value part-way down,
  // and without this the next open would start there.
  const storyY = useSharedValue(0);
  useEffect(() => {
    if (visible) storyY.set(0);
  }, [visible, storyY]);
  const storyAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: storyY.get() }],
  }));
  const drag = useSheetDrag({
    sheetY: storyY,
    height: STORY_SHEET_H,
    onDismiss: onClose,
    // Not draggable mid-post: the request is already in flight and closing the
    // sheet under it would leave the spinner's owner unmounted.
    enabled: !posting,
  });

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

  // A photo on its own is a story; so is a line of text. Only nothing at all
  // is not one. The caption used to be required, which made the commonest
  // story of all — a picture, posted without commentary — impossible.
  const canPost = !!photoUri || text.trim().length > 0;

  async function handlePost() {
    if (!canPost) {
      Alert.alert('Nothing to post', 'Add a photo or write something first.');
      return;
    }
    setPosting(true);
    await runBusy(async () => {
      await onPost(text.trim(), photoUri);
      setText('');
      setPhotoUri(null);
      onClose();
    }, () => setPosting(false))
      // Nothing here about location any more. Posting used to be refused while
      // sharing was paused and this is where that refusal was explained; the
      // story now posts either way, without a pin, and the line above the
      // Post button says so before it happens rather than after.
      //
      // What *is* still explained here is a refusal by the content filter. A
      // story rejected under the Community Guidelines has to say so — "Failed
      // to post, please try again" would send somebody round the loop retrying
      // a post that will never be accepted.
      .catch((e: any) => {
        if (e?.response?.data?.code === 'objectionable_content') {
          Alert.alert('This can’t be posted', e.response.data.detail);
          return;
        }
        Alert.alert('Failed to post', 'Please try again.');
      });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.createModalBackdrop} onPress={onClose} />
        <Animated.View
          style={[styles.createModalSheet, { paddingBottom: bottom + 20 }, storyAnimStyle]}
        >
          <GestureDetector gesture={drag}>
            <View style={styles.sheetGrab}>
              <View style={styles.sheetHandle} />
            </View>
          </GestureDetector>
          <View style={styles.createModalHeader}>
            <View style={styles.createModalTitleWrap}>
              <Text style={styles.createModalTitle}>Drop a Story</Text>
              {/* Both facts a poster wants before typing, and neither was on
                  screen before: who sees it, and for how long. 24 hours is
                  `stories.models.Story.save`, not a guess. */}
              <Text style={styles.createModalSubtitle}>Friends only · gone in 24 hours</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [styles.createModalClose, pressed && { opacity: 0.5 }]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <IconClose size={16} color={colors.t2} />
            </Pressable>
          </View>
          {primer}

          {/* The picture leads, the way it does in the story it becomes. The
              two sources used to be unlabelled icon squares below the caption,
              after the thing they filled in. */}
          {photoUri ? (
            <View style={styles.photoPreviewContainer}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} contentFit="cover" />
              <Pressable
                style={({ pressed }) => [styles.removePhotoBtn, pressed && { opacity: 0.5 }]}
                onPress={() => setPhotoUri(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
              >
                <IconClose size={14} color={colors.t1} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.mediaRow}>
              <Pressable
                style={({ pressed }) => [styles.mediaCard, pressed && styles.mediaCardPressed]}
                onPress={takePhoto}
                accessibilityRole="button"
                accessibilityLabel="Take a photo"
              >
                <IconCamera size={20} color={colors.teal} />
                <Text style={styles.mediaCardLabel}>Camera</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.mediaCard, pressed && styles.mediaCardPressed]}
                onPress={pickPhoto}
                accessibilityRole="button"
                accessibilityLabel="Choose a photo from your library"
              >
                <IconImage size={20} color={colors.teal} />
                <Text style={styles.mediaCardLabel}>Library</Text>
              </Pressable>
            </View>
          )}

          {/* Counter inside the field rather than floating under it, so the
              caption reads as one object instead of a box with a stray number
              beneath it. */}
          <View style={styles.captionWrap}>
            <TextInput
              style={styles.storyInput}
              placeholder={photoUri ? 'Add a caption (optional)' : "What's happening here?"}
              // Was a hardcoded '#444', which is nearly body-text dark on the
              // light theme's surface — the placeholder read as typed text.
              placeholderTextColor={colors.t3}
              value={text}
              onChangeText={(t) => setText(t.slice(0, 280))}
              multiline
              maxLength={280}
              autoFocus
            />
            <Text style={[styles.charCount, text.length > 240 && styles.charCountNear]}>
              {text.length}/280
            </Text>
          </View>

          {locationless ? (
            // Stated once, quietly, and only when it applies. Not a warning:
            // nothing is going wrong, and the story is about to reach exactly
            // the people it was always going to reach.
            <View style={styles.storyNoteRow}>
              <IconEyeOff size={13} color={colors.t2} />
              <Text style={styles.storyNote}>
                Location sharing is off — friends will see this story, the map won&apos;t.
              </Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.postBtn,
              (!canPost || posting) && styles.postBtnDisabled,
              pressed && { opacity: 0.85 },
            ]}
            onPress={handlePost}
            disabled={!canPost || posting}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canPost || posting }}
          >
            {posting ? (
              <ActivityIndicator color={colors.bg} size="small" />
            ) : (
              <Text style={styles.postBtnText}>Post Story</Text>
            )}
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Meetup Marker ────────────────────────────────────────────────────────────
function MeetupMarker({ meetup, pinned, onPress }: {
  meetup: ClubMeetup;
  /** The viewer said they are going. Drawn as a corner on the pin rather than
   *  a second marker at the same coordinate — see `PinnedLayer`, which leaves
   *  a pinned meetup to this marker for as long as the event is still on the
   *  map at all. */
  pinned?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // The corner is part of the frozen bitmap, so pinning has to re-arm tracking
  // or the marker keeps drawing the picture it took before the press.
  const { settling } = useMarkerSettle(`${meetup.id}|${pinned}`);
  return (
    <Marker
      coordinate={{ latitude: meetup.latitude, longitude: meetup.longitude }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={settling}
      zIndex={Z_MEETUP}
      onPress={onPress}
      accessibilityLabel={
        pinned ? `${meetup.title}. You are going.` : meetup.title
      }
    >
      <View style={styles.meetupMarkerWrap}>
        <View style={styles.meetupMarkerBubble}>
          {meetup.club_emblem ? (
            <Image source={{ uri: meetup.club_emblem }} style={styles.meetupMarkerImg} />
          ) : (
            <IconCalendar size={18} color="#fff" />
          )}
          {pinned ? (
            <View style={styles.goingCorner}>
              <IconBookmark size={10} color={colors.purple} filled />
            </View>
          ) : null}
        </View>
        <View style={styles.meetupMarkerTail} />
      </View>
    </Marker>
  );
}

// ─── Meetup Sheet ─────────────────────────────────────────────────────────────
function MeetupSheet({
  meetup,
  pinned,
  onToggleGoing,
  sheetY,
  onDismiss,
}: {
  meetup: ClubMeetup;
  pinned: boolean;
  onToggleGoing: (meetup: ClubMeetup) => Promise<void>;
  sheetY: SharedValue<number>;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const navPad = useNavContentPadding(16);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.get() }] }));
  // `onDismiss` is the screen's own `closeMeetupSheet`, so a dragged dismiss
  // and a backdrop tap run the same teardown — see `useSheetDrag`.
  const drag = useSheetDrag({ sheetY, height: SHEET_H, onDismiss, spring: SPRING_CFG });
  const [saving, setSaving] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);

  function toggleGoing() {
    if (saving) return;
    setSaving(true);
    void runBusy(() => onToggleGoing(meetup), () => setSaving(false));
  }

  return (
    <>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onDismiss} />
      <Animated.View style={[styles.sheet, { paddingBottom: navPad }, animStyle]}>
        {/* The whole grab area, not just the 36x4 bar: a 4pt-tall drag target
            is unusable, so the detector wraps a padded row and the bar inside
            it is what you see. */}
        <GestureDetector gesture={drag}>
          <View style={styles.sheetGrab}>
            <View style={styles.sheetHandle} />
          </View>
        </GestureDetector>

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

        {/* Going first, directions second: the decision comes before the
            journey, and it is the one of the two that leaves something behind
            on the map. */}
        <View style={styles.sheetActionRow}>
          <View style={styles.sheetActionCell}>
            <Button
              label={pinned ? 'Going' : "I'm going"}
              variant={pinned ? 'secondary' : 'primary'}
              size="md"
              fullWidth
              loading={saving}
              icon={pinned ? IconCheck : IconBookmark}
              onPress={toggleGoing}
              accessibilityLabel={
                pinned
                  ? 'Going. Tap to remove this meetup from your map.'
                  : 'I am going. Pins this meetup to your map.'
              }
            />
          </View>
          <View style={styles.sheetActionCell}>
            <Button
              label="Directions"
              variant="secondary"
              size="md"
              fullWidth
              onPress={() => setDirectionsOpen(true)}
              accessibilityLabel={
                `Directions to ${meetup.title}. Travel times by car, on foot, by bike and on transit.`
              }
            />
          </View>
        </View>
      </Animated.View>

      <DirectionsSheet
        visible={directionsOpen}
        target={{
          latitude: meetup.latitude,
          longitude: meetup.longitude,
          title: meetup.title,
          placeName: meetup.location_name ?? undefined,
        }}
        onClose={() => setDirectionsOpen(false)}
      />
    </>
  );
}


// ─── Pinned places ────────────────────────────────────────────────────────────
/*
 * The places the viewer saved for themselves — see services/pinnedPlaces.
 *
 * Two sources, one marker: where a Swift was made, and a meetup they said they
 * are going to. They are drawn together because on a map they are the same
 * thing — somewhere you decided you want to be able to find again — and are
 * told apart by tint and glyph rather than by shape, so the map does not grow
 * a third pin silhouette.
 */

/** Teal for a place off a Swift, purple for a meetup — each keeping the colour
 *  its source already has on this map, so a pin never introduces a hue that
 *  means nothing anywhere else. */
function pinTint(place: PinnedPlace, colors: ColorPalette): string {
  return place.kind === 'meetup' ? colors.purple : colors.teal;
}

function PinnedMarker({ place, parkedAt, parked, onPress }: {
  place: PinnedPlace | null;
  /** Where an empty slot sits: the viewer's own position, the same as every
   *  other parked slot on this map. Somewhere real and on screen, rather than
   *  the null island a `{ 0, 0 }` fallback would strand it at. */
  parkedAt: GeoPoint;
  /** Nothing to draw in this slot. Parked rather than unmounted — see
   *  PARKED_MARKERS. Unpinning is rare, but it is exactly the case Fabric
   *  strands: a custom view inside a Marker, removed while the map is alive,
   *  which would leave the pin on screen after the user deleted it. */
  parked: boolean;
  onPress: (place: PinnedPlace) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { settling } = useMarkerSettle(`${place?.id ?? 'none'}|${parked}`);
  const tint = place ? pinTint(place, colors) : colors.teal;

  // A parked slot still needs somewhere to be: the position it held went with
  // the pin, so it sits on the viewer under a transparent, untappable, 1pt
  // view.
  const coordinate = place
    ? { latitude: place.latitude, longitude: place.longitude }
    : parkedAt;

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={settling}
      zIndex={Z_PIN}
      opacity={parked ? 0 : 1}
      onPress={parked || !place ? undefined : () => onPress(place)}
      accessibilityLabel={parked || !place ? undefined : `Pinned: ${place.title}`}
    >
      {parked || !place ? (
        <View style={styles.parkedMarker} />
      ) : (
        <View style={styles.pinnedMarkerWrap}>
          <View style={[styles.pinnedMarkerBubble, { borderColor: tint }]}>
            {place.kind === 'meetup'
              ? <IconCalendar size={16} color={tint} />
              : <IconBookmark size={16} color={tint} filled />}
          </View>
          <View style={[styles.pinnedMarkerTail, { borderColor: tint }]} />
        </View>
      )}
    </Marker>
  );
}

/**
 * Every pin, out of a slot pool that grows and never shrinks.
 *
 * `liveMeetupIds` is what stops a meetup the viewer is going to being drawn
 * twice while it is still on the map in its own right: `MeetupMarker` keeps
 * that one and wears the bookmark corner. The pin appears here the moment the
 * event drops out of the nearby feed — which is the case this feature is for,
 * since a meetup you are travelling to is by definition not near you yet.
 */
function PinnedLayer({ places, liveMeetupIds, parkedAt, onOpenPin }: {
  places: PinnedPlace[];
  liveMeetupIds: Set<number>;
  parkedAt: GeoPoint;
  onOpenPin: (place: PinnedPlace) => void;
}) {
  const [slotCount, setSlotCount] = useState(0);

  const drawable = useMemo(
    () => places.filter(
      (p) => isDrawable(p) && !(p.kind === 'meetup' && liveMeetupIds.has(p.source_id)),
    ),
    [places, liveMeetupIds],
  );
  if (drawable.length > slotCount) setSlotCount(drawable.length);

  const slots = useMemo(
    () => Array.from({ length: slotCount }, (_, i) => drawable[i] ?? null),
    [drawable, slotCount],
  );
  // Slot identity, not content: slot 3 is "pin-slot-3" for the life of the
  // screen, whichever pin (or none) is currently in it. Same rule as the
  // headcount badges — see hooks/useMarkerSlots.
  const slotIds = useMemo(
    () => Array.from({ length: slotCount }, (_, i) => `pin-slot-${i}`),
    [slotCount],
  );

  return (
    <>
      {/* A Swift whose creator shares an approximate position was snapped to a
          ~500m cell before it was ever stored, so the pin marks a cell and the
          circle says so. Circles leave the native map cleanly, unlike the
          markers above them, so these are not pooled. */}
      {drawable.reduce<ReactNode[]>((circles, place) => {
        if (place.precision === 'approximate') {
          circles.push(
            <Circle
              key={`pin-approx-${place.id}`}
              center={{ latitude: place.latitude, longitude: place.longitude }}
              radius={APPROX_RADIUS_M}
              fillColor="rgba(31,199,182,0.10)"
              strokeColor="rgba(31,199,182,0.45)"
              strokeWidth={1}
            />,
          );
        }
        return circles;
      }, [])}

      {slots.map((place, i) => (
        <PinnedMarker
          key={slotIds[i]}
          place={place}
          parkedAt={parkedAt}
          parked={!place}
          onPress={onOpenPin}
        />
      ))}
    </>
  );
}

/** What the card calls the pin. Both halves are worth saying: where it came
 *  from, and — for a meetup — that pinning it was a decision to go. */
function pinKindLabel(place: PinnedPlace): string {
  return place.kind === 'meetup' ? 'MEETUP · GOING' : 'FROM A SWIFT';
}

function PinnedSheet({ place, sheetY, onDismiss, onUnpin }: {
  place: PinnedPlace;
  sheetY: SharedValue<number>;
  onDismiss: () => void;
  onUnpin: (place: PinnedPlace) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const navPad = useNavContentPadding(16);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.get() }] }));
  const drag = useSheetDrag({ sheetY, height: SHEET_H, onDismiss, spring: SPRING_CFG });
  const tint = pinTint(place, colors);
  const [noteOpen, setNoteOpen] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);

  return (
    <>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onDismiss} />
      <Animated.View style={[styles.sheet, { paddingBottom: navPad }, animStyle]}>
        <GestureDetector gesture={drag}>
          <View style={styles.sheetGrab}>
            <View style={styles.sheetHandle} />
          </View>
        </GestureDetector>

        <View style={styles.sheetHead}>
          <View style={[styles.pinnedSheetGlyph, { borderColor: tint }]}>
            {place.kind === 'meetup'
              ? <IconCalendar size={22} color={tint} />
              : <IconBookmark size={22} color={tint} filled />}
          </View>
          <View style={styles.sheetHeadBody}>
            <Text style={styles.sheetName} numberOfLines={2}>{place.title}</Text>
            <Text style={[styles.pinnedKindLabel, { color: tint }]} numberOfLines={1}>
              {pinKindLabel(place)}
            </Text>
          </View>
        </View>

        <View style={styles.meetupDetailBlock}>
          {place.subtitle ? (
            <View style={styles.meetupDetailRow}>
              <IconPeople size={14} color={colors.t3} />
              <Text style={styles.meetupDetailText} numberOfLines={1}>{place.subtitle}</Text>
            </View>
          ) : null}
          {place.event_datetime ? (
            <View style={styles.meetupDetailRow}>
              <IconCalendar size={14} color={colors.t3} />
              <Text style={styles.meetupDetailText}>{fmtDateTime(place.event_datetime)}</Text>
            </View>
          ) : null}
          {place.place_name ? (
            <View style={styles.meetupDetailRow}>
              <IconPin size={14} color={colors.t3} />
              <Text style={styles.meetupDetailText} numberOfLines={2}>{place.place_name}</Text>
            </View>
          ) : null}
          {place.precision === 'approximate' ? (
            <Text style={styles.meetupDescription}>
              This creator shares their location approximately, so the circle is
              the area rather than an exact spot.
            </Text>
          ) : null}
        </View>

        {/* The note sits between what the place *is* and what you can do with
            it, because that is what it answers: why this one was worth
            keeping. Tapping it opens the editor either way — an empty block
            that only invites writing would be a control that changes meaning
            once used. */}
        <Pressable
          style={({ pressed }) => [
            styles.pinNoteBlock,
            !place.note && styles.pinNoteEmpty,
            pressed && { opacity: 0.7 },
          ]}
          onPress={() => setNoteOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            place.note
              ? `Your note: ${place.note}. Tap to edit or remove it.`
              : `Add a note about ${place.title}`
          }
        >
          <IconPencil size={14} color={place.note ? colors.t3 : colors.teal} />
          <Text
            style={[styles.pinNoteText, !place.note && styles.pinNoteAddText]}
            numberOfLines={4}
          >
            {place.note || 'Add a note'}
          </Text>
        </Pressable>

        <View style={styles.sheetActionRow}>
          <View style={styles.sheetActionCell}>
            <Button
              label="Directions"
              variant="primary"
              size="md"
              fullWidth
              onPress={() => setDirectionsOpen(true)}
              accessibilityLabel={
                `Directions to ${place.title}. Travel times by car, on foot, by bike and on transit.`
              }
            />
          </View>
          <View style={styles.sheetActionCell}>
            <Button
              label="Remove pin"
              variant="secondary"
              size="md"
              fullWidth
              onPress={() => onUnpin(place)}
              accessibilityLabel={`Remove ${place.title} from your map`}
            />
          </View>
        </View>
      </Animated.View>

      <DirectionsSheet
        visible={directionsOpen}
        target={{
          latitude: place.latitude,
          longitude: place.longitude,
          title: place.title,
          placeName: place.place_name,
          approximate: place.precision === 'approximate',
        }}
        onClose={() => setDirectionsOpen(false)}
      />

      <PinNoteEditor
        visible={noteOpen}
        placeTitle={place.title}
        note={place.note}
        onClose={() => setNoteOpen(false)}
        onSave={(text) => { void setPinnedNote(place.id, text); }}
      />
    </>
  );
}

// ─── User Sheet ───────────────────────────────────────────────────────────────
interface SheetProps {
  user: NearbyUser;
  sheetY: SharedValue<number>;
  onDismiss: () => void;
  onFriendChange: () => void;
}

// The viewer's coordinates and this user's region outline used to be props: a
// music zone could be a city border, so "are you inside it" was a
// point-in-polygon question. A music zone is always a circle now, and a scalar
// distance answers it.
/**
 * What the viewer is to this person, and what that entitles them to see.
 *
 * `identified` is the load-bearing one: below a mutual Hi there is no name and
 * no face on the card, because the map showed a point and the card has to agree
 * with the map or the point was never really anonymous.
 */
function describeRelationship(rel: Relationship, colors: ColorPalette) {
  const isFriend = rel === 'friend';
  const isConnected = rel === 'connected';
  return {
    isFriend,
    isConnected,
    isHiSent: rel === 'hi_sent',
    isStranger: rel === 'stranger',
    identified: isFriend || isConnected,
    ringColor: isFriend ? colors.blue : isConnected ? colors.orange : colors.t3,
    labelColor: isFriend ? colors.blue : isConnected ? colors.orange : colors.t2,
  };
}

type RelationshipInfo = ReturnType<typeof describeRelationship>;

/**
 * Identity row: who, how far, and what they are to you — one line of each, read
 * left to right. The old sheet stacked this centred over 400px, which pushed
 * the actions below the fold on small screens.
 */
function UserSheetHead({ user, rel, info, metaLine }: {
  user: NearbyUser;
  rel: Relationship;
  info: RelationshipInfo;
  metaLine: string;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.sheetHead}>
      {info.identified ? (
        <Avatar
          uri={user.profile_picture}
          name={user.username}
          size="md"
          ringColor={info.ringColor}
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
          {info.identified ? user.username : 'Someone nearby'}
        </Text>
        {metaLine ? (
          <Text style={styles.sheetMeta} numberOfLines={1}>{metaLine}</Text>
        ) : null}
      </View>

      <View style={[styles.relPill, { borderColor: info.ringColor }]}>
        <Text style={[styles.relPillText, { color: info.labelColor }]}>
          {REL_LABEL[rel] ?? 'Nearby'}
        </Text>
      </View>
    </View>
  );
}

/**
 * Presence and motion were badges in the meta row and are now a single quiet
 * line — still spelled out in words, because the trail on the map is decorative
 * and hidden from assistive tech.
 */
function UserSheetStatus({ user }: { user: NearbyUser }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const motion = motionLabel(user.motion_class);

  if (!user.presence && !motion) return null;
  return (
    <View style={styles.statusRow}>
      {user.presence && <PresenceDot presence={user.presence} size={8} withText />}
      {motion && (
        <Text style={styles.statusMotion} accessible accessibilityLabel={motion}>
          {user.motion_class === 'fast' ? 'Moving fast' : 'On the move'}
        </Text>
      )}
    </View>
  );
}

/**
 * Their zone track, on the person it belongs to — the map used to float this
 * over everything as a banner, which is how it ended up playing to people who
 * had never asked for it.
 */
function UserSheetZone({ user, zoneUrl }: { user: NearbyUser; zoneUrl: string }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const distanceM = user.distance ?? (user.distance_km != null ? user.distance_km * 1000 : null);
  // Their music zone, which is always a circle — never the city border their
  // *map* zone might be. A region is a shape, not a distance, and comparing a
  // radius against one was wrong in both directions: someone 3km away can be
  // well inside a city while someone 300m away across the boundary is outside.
  // The music zone having its own radius is what removed that problem.
  const musicRadius = user.music_zone_radius && user.music_zone_radius > 0
    ? user.music_zone_radius
    : 200;
  const zoneLabel = fmtRadius(musicRadius);
  // Unknown position is not "out of range" — a card that refuses to play with
  // no reason it can name is worse than one that plays a track you can hear.
  const insideZone = distanceM == null || distanceM < musicRadius;

  return (
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
            insideZone
              ? `inside their ${zoneLabel} music zone`
              : `${zoneLabel} music zone`,
          ].join(' · ')
        }
        blockedReason={
          insideZone
            ? null
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
  );
}

/**
 * One decision, then a way out of it. The primary action is wide and the
 * dismiss is a square beside it, so the choice a stranger card offers reads as
 * "yes, or nothing".
 */
function UserSheetActions({ info, requestSent, onAddFriend, onHi, onMessage, onProfile, onDismiss }: {
  info: RelationshipInfo;
  requestSent: boolean;
  onAddFriend: () => void;
  onHi: () => void;
  onMessage: () => void;
  onProfile: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <>
      {/* Connections can be promoted to friends right from the map; the
          server rejects friend requests to anyone not connected yet. */}
      {info.isConnected && (
        <View style={styles.addFriendRow}>
          <Button
            label={requestSent ? 'Friend Request Sent ✓' : 'Add Friend'}
            variant={requestSent ? 'secondary' : 'primary'}
            size="md"
            fullWidth
            disabled={requestSent}
            onPress={onAddFriend}
          />
        </View>
      )}

      <View style={styles.actions}>
        <View style={styles.actionPrimary}>
          {info.isStranger && (
            <Button label="Say Hi" variant="primary" size="md" fullWidth onPress={onHi} />
          )}
          {info.isHiSent && (
            <Button label="Hi Sent ✓" variant="secondary" size="md" fullWidth disabled />
          )}
          {info.identified && (
            <Button label="Message" variant="primary" size="md" fullWidth onPress={onMessage} />
          )}
        </View>
        <View style={styles.actionSecondary}>
          <Button label="Profile" variant="ghost" size="md" fullWidth onPress={onProfile} />
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
    </>
  );
}

function UserSheet({
  user, sheetY, onDismiss, onFriendChange,
}: SheetProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const navPad = useNavContentPadding(16);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.get() }],
  }));
  const drag = useSheetDrag({ sheetY, height: SHEET_H, onDismiss, spring: SPRING_CFG });

  const rel  = user.relationship ?? 'stranger';
  const info = describeRelationship(rel, colors);
  const dist = fmtDistance(user.distance);

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

  // Friends and connections get the real number; a stranger gets a band.
  const distLine = info.identified ? dist : distanceBand(user.distance);
  const zoneLine = info.identified && user.zone_audio_url ? 'has a music zone' : null;
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
  const zoneUrl = info.identified ? user.zone_audio_url : undefined;

  return (
    <>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onDismiss} />
      <Animated.View style={[styles.sheet, { paddingBottom: navPad }, animStyle]}>
        <GestureDetector gesture={drag}>
          <View style={styles.sheetGrab}>
            <View style={styles.sheetHandle} />
          </View>
        </GestureDetector>

        <UserSheetHead user={user} rel={rel} info={info} metaLine={metaLine} />

        <UserSheetStatus user={user} />

        {zoneUrl && <UserSheetZone user={user} zoneUrl={zoneUrl} />}

        {user.shared_interests && user.shared_interests.length > 0 && (
          <View style={styles.interestsSection}>
            <Text style={styles.sectionLabel}>
              {info.identified ? 'Shared interests' : 'You both like'}
            </Text>
            <FlatList
              horizontal
              data={user.shared_interests}
              keyExtractor={(tag) => tag}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
              renderItem={({ item: tag }) => (
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{tag}</Text>
                </View>
              )}
            />
          </View>
        )}

        <UserSheetActions
          info={info}
          requestSent={requestSent}
          onAddFriend={sendFriendRequest}
          onHi={sendHi}
          onMessage={goToMessages}
          onProfile={goToProfile}
          onDismiss={onDismiss}
        />

        {/* Says out loud what the card is already doing. Someone deciding
            whether to send a Hi is deciding how much of themselves it costs. */}
        {info.isStranger && (
          <Text style={styles.sheetFootnote}>
            They see the same shared interests — and nothing else about you.
          </Text>
        )}
      </Animated.View>
    </>
  );
}

// ─── Map layers ───────────────────────────────────────────────────────────────
/*
 * The three groups of children the map draws, in draw order: the circles
 * underneath, the people standing in them, and the pins for things rather than
 * people. Split out of the screen's own `return` because that return had grown
 * past the point where the order was legible — which is the one property this
 * JSX has to make obvious, since every z-index on this map is decided by it.
 *
 * Each is a plain function returning a fragment, so the children the native map
 * receives are exactly the ones it received before: same elements, same keys,
 * same order. That matters more here than anywhere else in the app — see
 * PARKED_MARKERS.
 */

type MapStyles = ReturnType<typeof makeStyles>;

/** Circles: music rings, the viewer's own zone, and the chips that name them. */
function ZoneLayer({
  musicZones, musicBadges, musicBadgeSlotIds, selfZone, selfZoneRings, displayCoords, colors,
}: {
  musicZones: MusicZone[];
  musicBadges: (MusicZone | null)[];
  musicBadgeSlotIds: string[];
  selfZone: SelfZone | null;
  selfZoneRings: GeoPoint[][];
  displayCoords: GeoPoint;
  colors: ColorPalette;
}) {
  return (
    <>
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

      {/* Music zones. Someone else's ring is drawn when the viewer is
          allowed to hear their track; the viewer's own whenever they have
          a music zone switched on — see `selfMusicZoneRing`. A ring means
          "the music stops here", so a zone that has been switched off has
          no ring, on the owner's map or anyone else's.
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
          the one thing you cannot check by listening.
          Slotted, and a spare slot goes transparent rather than unmounting
          — see PARKED_MARKERS. A zone switched off has to take its chip
          with its circle, and an unmounted Marker does not reliably go. */}
      {musicBadges.map((z, i) => (
        <MusicZoneBadge
          key={musicBadgeSlotIds[i]}
          center={z?.center ?? displayCoords}
          radius={z?.radius ?? 0}
          mine={z?.mine}
          label={z?.label ?? ''}
          color={z?.color ?? colors.purple}
          parked={!z}
        />
      ))}
    </>
  );
}

/**
 * One person on the map, as either a face or a lit point.
 *
 * Anyone you have a name for gets a face and a name plate — blue ring for a
 * friend, orange for a connection. Strangers stay a lit point: no photo, no
 * name, nothing to screenshot, until the Hi is mutual and they cross into the
 * row above.
 */
function PersonMarker({ user, layout, isFriend, isConnected, color, onPress }: {
  user: NearbyUser;
  /** Absent means this person was folded into a headcount badge. */
  layout: FanResult | undefined;
  isFriend: boolean;
  isConnected: boolean;
  color: string;
  onPress: () => void;
}) {
  // Absent from `placed` means this person was folded into a headcount
  // badge. Drawing them as well would put two of them on the map — so
  // the marker parks: transparent, untappable, still mounted. The
  // unmount it replaces is the one that left a face behind under the
  // badge on every pinch. See PARKED_MARKERS.
  const truePos = { latitude: user.latitude, longitude: user.longitude };
  const parked = !layout || !isDrawable(layout.position);
  // Nowhere legal to stand at all: the one case still worth skipping,
  // since a Marker needs a coordinate the native map can survive.
  if (parked && !isDrawable(truePos)) return null;
  const position = parked ? truePos : layout!.position;

  return isFriend || isConnected ? (
    <AvatarMarker
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
      captionTag={!layout?.crowded && user.zone_audio_url ? 'zone' : undefined}
      zIndex={Z_FRIEND}
      onPress={onPress}
    />
  ) : (
    <DotMarker
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
      onPress={onPress}
    />
  );
}

/** People: the approximate haze, their trails, the fan's leader lines, the
 *  markers themselves, the headcounts that stand in for a pile, and you. */
function PeopleLayer({
  visibleNearby, motionTrails, reduceMotion, leaders, leaderSlotIds, markerLayout,
  badges, badgeSlotIds, friendIds, connectionIds, colors, displayCoords, selfProfile,
  ghost, posFor, onOpenSheet, onZoomToCluster,
}: {
  visibleNearby: NearbyUser[];
  motionTrails: ReturnType<typeof useMotionTrails>;
  reduceMotion: boolean;
  leaders: ([GeoPoint, GeoPoint] | null)[];
  leaderSlotIds: string[];
  markerLayout: MarkerLayout;
  badges: (ClusterResult | null)[];
  badgeSlotIds: string[];
  friendIds: Set<number>;
  connectionIds: Set<number>;
  colors: ColorPalette;
  displayCoords: GeoPoint;
  selfProfile: { username: string; profile_picture?: string } | null;
  ghost: boolean | null | undefined;
  posFor: (key: string, fallback: GeoPoint) => GeoPoint;
  onOpenSheet: (user: NearbyUser) => void;
  onZoomToCluster: (center: GeoPoint) => void;
}) {
  // Ring colour carries the relationship, and nothing else does.
  const COLOR_FRIEND    = colors.blue;
  const COLOR_CONNECTED = colors.orange;
  const COLOR_STRANGER  = colors.teal;

  return (
    <>
      {/* Approximate sharers get a haze instead of a precise-looking pin —
          the marker would otherwise imply accuracy the data doesn't have. */}
      {visibleNearby.reduce<ReactNode[]>((circles, u) => {
        if (u.location_precision === 'approximate' && u.latitude != null && u.longitude != null) {
          circles.push(
            <Circle
              key={`approx-${u.id}`}
              center={{ latitude: u.latitude, longitude: u.longitude }}
              radius={APPROX_RADIUS_M}
              fillColor="rgba(244,244,246,0.06)"
              strokeColor="rgba(244,244,246,0.18)"
              strokeWidth={1}
            />,
          );
        }
        return circles;
      }, [])}

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
          key={leaderSlotIds[i]}
          coordinates={line ?? [displayCoords, displayCoords]}
          strokeColor={line ? 'rgba(244,244,246,0.28)' : 'transparent'}
          strokeWidth={1}
          lineDashPattern={[3, 3]}
          zIndex={2}
        />
      ))}

      {visibleNearby.filter((u) => u.latitude != null && u.longitude != null).map((user) => {
        const uid = Number(user.id);
        const isFriend = friendIds.has(uid);
        const isConnected = connectionIds.has(uid);
        return (
          <PersonMarker
            key={user.id}
            user={user}
            layout={markerLayout.placed.get(`u-${user.id}`)}
            isFriend={isFriend}
            isConnected={isConnected}
            color={isFriend ? COLOR_FRIEND : isConnected ? COLOR_CONNECTED : COLOR_STRANGER}
            onPress={() => onOpenSheet(user)}
          />
        );
      })}

      {/* No self-fuzz circle any more. It existed to stop an Approximate
          sharer being shown a precise dot they had asked us not to publish;
          precision is the viewer's relationship now, the owner is always on
          the precise side of it, and a circle here would describe a
          blurring that no longer applies to them. What a stranger sees is
          drawn on the stranger's map, from the cell the server sends. */}

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
          key={badgeSlotIds[i]}
          coordinate={cluster ? cluster.position : displayCoords}
          count={cluster ? cluster.count : 0}
          parked={!cluster}
          onPress={cluster ? () => onZoomToCluster(cluster.anchor ?? cluster.position) : undefined}
        />
      ))}

      {/* Never moved, and never folded into a count. When someone stands
          where you stand, they are the one who gets fanned aside — so this
          marker, and the zone centred on it, stay exactly where you are. */}
      <SelfMarker
        coordinate={posFor(SELF_KEY, displayCoords)}
        // The same point, moved continuously rather than in ten-metre hops —
        // see services/positionSmoothing. Passed alongside the laid-out
        // coordinate rather than replacing it so that the layout stays the
        // authority on *where* this marker belongs (it is the one marker that
        // is never fanned aside) while the smoother decides only how it gets
        // there. Subscribed inside SelfMarker, so a new interpolated position
        // re-renders one marker and not this whole layer.
        uri={selfProfile?.profile_picture}
        username={selfProfile?.username ?? ''}
        // Drawn muted while Paused, because the owner's own marker is the
        // only thing on this screen that could be read as "this is what
        // everyone else sees". While paused it is not — nobody sees it —
        // and the map should say so where the question is being asked.
        hidden={ghost === true}
      />
    </>
  );
}

/** Pins for things rather than people: story bubbles, club meetups, and the
 *  places the viewer saved for themselves. */
function PinsLayer({
  storiesByAuthor, clubMeetups, pinnedPlaces, displayCoords,
  onOpenStories, onOpenMeetup, onOpenPin,
}: {
  storiesByAuthor: Map<number, Story[]>;
  clubMeetups: ClubMeetup[];
  pinnedPlaces: PinnedPlace[];
  /** Where an empty pin slot parks — see `PinnedMarker`. */
  displayCoords: GeoPoint;
  onOpenStories: (stories: Story[]) => void;
  onOpenMeetup: (meetup: ClubMeetup) => void;
  onOpenPin: (place: PinnedPlace) => void;
}) {
  /** Which meetups are on the map in their own right, so `PinnedLayer` can
   *  leave those to `MeetupMarker` instead of stacking a second pin on them. */
  const liveMeetupIds = useMemo(
    () => new Set(clubMeetups.map((m) => m.id)),
    [clubMeetups],
  );
  /** And which of them the viewer is going to, which is what puts the bookmark
   *  corner on the meetup's own marker. */
  const goingMeetupIds = useMemo(
    () => new Set(
      pinnedPlaces.reduce<number[]>((ids, p) => {
        if (p.kind === 'meetup') ids.push(p.source_id);
        return ids;
      }, []),
    ),
    [pinnedPlaces],
  );

  return (
    <>
      {/* `isDrawable` as well as the numeric coercion at the boundary: the
          two answer different questions. services/coords.ts guarantees a
          real coordinate; this guarantees one Google's Mercator projection
          can actually place, which stops above ±85°. People's markers have
          always been filtered this way — stories and meetups were not, and
          were the two that could reach the native map unchecked. */}
      {Array.from(storiesByAuthor).reduce<ReactNode[]>((markers, [authorId, authorStories]) => {
        if (isDrawable(authorStories[0])) {
          // Keyed by author alone. It used to include the newest story id
          // as well, to force a remount so a fresh story could not reuse a
          // stale frozen snapshot — but StoryMarker already re-arms
          // `tracksViewChanges` off that same id, so the remount bought
          // nothing and cost a ghost: an unmounted marker never leaves the
          // native map (see `PARKED_MARKERS`), so posting a story left the
          // previous bubble behind next to the new one.
          markers.push(
            <StoryMarker
              key={`story-author-${authorId}`}
              stories={authorStories}
              onPress={() => onOpenStories(authorStories)}
            />,
          );
        }
        return markers;
      }, [])}

      {/* Approved club meetup pins — one per event, above story bubbles. */}
      {clubMeetups.reduce<ReactNode[]>((markers, meetup) => {
        if (isDrawable(meetup)) {
          markers.push(
            <MeetupMarker
              key={`meetup-${meetup.id}`}
              meetup={meetup}
              pinned={goingMeetupIds.has(meetup.id)}
              onPress={() => onOpenMeetup(meetup)}
            />,
          );
        }
        return markers;
      }, [])}

      <PinnedLayer
        places={pinnedPlaces}
        liveMeetupIds={liveMeetupIds}
        parkedAt={displayCoords}
        onOpenPin={onOpenPin}
      />
    </>
  );
}

// ─── Map surface ──────────────────────────────────────────────────────────────
/**
 * The map itself and everything drawn on it, as opposed to over it.
 *
 * `overlays` and `slots` arrive as whole hook results rather than unpacked into
 * twenty props. That is not just brevity: the slot pools only mean anything as
 * a set — a badge and its id come from the same run, and splitting them across
 * a prop list is how they get to disagree. See PARKED_MARKERS.
 */
function MapCanvas({
  mapRef, styles, themeMode, region, displayCoords, colors,
  overlays, slots, visibleNearby, motionTrails, reduceMotion,
  friendIds, connectionIds, selfProfile, selfZone, ghost,
  storiesByAuthor, clubMeetups, pinnedPlaces,
  onMapLayout, onRegionChangeComplete, onPanDrag, onLongPress,
  onOpenSheet, onZoomToCluster, onOpenStories, onOpenMeetup, onOpenPin,
}: {
  mapRef: React.RefObject<MapView | null>;
  styles: MapStyles;
  themeMode: string;
  region: Region | undefined;
  displayCoords: GeoPoint;
  colors: ColorPalette;
  overlays: MapOverlays;
  slots: MarkerSlots;
  visibleNearby: NearbyUser[];
  motionTrails: ReturnType<typeof useMotionTrails>;
  reduceMotion: boolean;
  friendIds: Set<number>;
  connectionIds: Set<number>;
  selfProfile: { username: string; profile_picture?: string } | null;
  selfZone: SelfZone | null;
  ghost: boolean | null | undefined;
  storiesByAuthor: Map<number, Story[]>;
  clubMeetups: ClubMeetup[];
  pinnedPlaces: PinnedPlace[];
  onMapLayout: (height: number) => void;
  onRegionChangeComplete: (region: Region) => void;
  onPanDrag: () => void;
  onLongPress: () => void;
  onOpenSheet: (user: NearbyUser) => void;
  onZoomToCluster: (center: GeoPoint) => void;
  onOpenStories: (stories: Story[]) => void;
  onOpenMeetup: (meetup: ClubMeetup) => void;
  onOpenPin: (place: PinnedPlace) => void;
}) {
  return (
    <MapView
      ref={mapRef}
      onLayout={(e) => onMapLayout(e.nativeEvent.layout.height)}
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
      onPanDrag={onPanDrag}
      onRegionChangeComplete={onRegionChangeComplete}
      onLongPress={onLongPress}
    >
      <ZoneLayer
        musicZones={overlays.musicZones}
        musicBadges={slots.musicBadges}
        musicBadgeSlotIds={slots.musicBadgeSlotIds}
        selfZone={selfZone}
        selfZoneRings={overlays.selfZoneRings}
        displayCoords={displayCoords}
        colors={colors}
      />

      <PeopleLayer
        visibleNearby={visibleNearby}
        motionTrails={motionTrails}
        reduceMotion={reduceMotion}
        leaders={slots.leaders}
        leaderSlotIds={slots.leaderSlotIds}
        markerLayout={slots.markerLayout}
        badges={slots.badges}
        badgeSlotIds={slots.badgeSlotIds}
        friendIds={friendIds}
        connectionIds={connectionIds}
        colors={colors}
        displayCoords={displayCoords}
        selfProfile={selfProfile}
        ghost={ghost}
        posFor={slots.posFor}
        onOpenSheet={onOpenSheet}
        onZoomToCluster={onZoomToCluster}
      />

      <PinsLayer
        storiesByAuthor={storiesByAuthor}
        clubMeetups={clubMeetups}
        pinnedPlaces={pinnedPlaces}
        displayCoords={displayCoords}
        onOpenStories={onOpenStories}
        onOpenMeetup={onOpenMeetup}
        onOpenPin={onOpenPin}
      />
    </MapView>
  );
}

// ─── Screen chrome ────────────────────────────────────────────────────────────
/*
 * The things drawn over the map rather than on it: the dead end that replaces
 * it, the notices strung under the top bar, the sheets, and the two toasts.
 *
 * Kept in three pieces rather than one because the tree order between them is
 * load-bearing — every one of these is absolutely positioned, so what is
 * written later sits on top. The toasts are last on purpose; folding them in
 * with the notices would put them under the sheets.
 */

/** No permission, and an explicit dead end with a way out — rather than a
 *  spinner that never resolves or a sentence with no action attached. */
function MapPermissionGate({ permState, styles, onAllow, onList }: {
  permState: PermissionState;
  styles: MapStyles;
  onAllow: () => void;
  onList: () => void;
}) {
  const blocked = permState === 'blocked';
  return (
    <View style={styles.center} accessible accessibilityRole="alert">
      <Text style={styles.emptyTitle}>The map needs location access</Text>
      <Text style={styles.errorText}>
        {blocked
          ? 'Location is turned off for Approx in system settings. The map can’t show anyone nearby until it’s back on.'
          : 'Approx shows people with shared interests near you right now. Without location there’s nothing to show.'}
      </Text>
      <Pressable
        onPress={onAllow}
        style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={blocked ? 'Open system settings' : 'Allow location access'}
      >
        <Text style={styles.emptyBtnText}>{blocked ? 'Open Settings' : 'Allow location'}</Text>
      </Pressable>
      <Pressable
        onPress={onList}
        style={({ pressed }) => [styles.emptyLink, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel="Open the nearby people list instead"
      >
        <Text style={styles.emptyLinkText}>See nearby people as a list</Text>
      </Pressable>
    </View>
  );
}

/** The strip under the top bar, where the map explains itself. */
function MapNotices({
  styles, colors, topInset, overlayTop, noticeTop,
  pending, ghostNotice, offsetNotice, onOpenPrivacy,
}: {
  styles: MapStyles;
  colors: ColorPalette;
  topInset: number;
  overlayTop: number;
  noticeTop: number;
  pending: boolean;
  ghostNotice: boolean;
  offsetNotice: boolean;
  onOpenPrivacy: () => void;
}) {
  return (
    <>
      {/* Sharing is on, the first position has not landed, and the map is
          therefore empty for a reason that has nothing to do with who is
          around. Stated, because an unexplained empty map reads as a broken
          one — and because the honest answer is "not yet", not "nobody". */}
      {pending ? (
        <View
          style={[styles.pendingChip, { top: topInset + 52 }]}
          accessible
          accessibilityRole="alert"
        >
          <ActivityIndicator size="small" color={colors.t2} />
          <Text style={styles.pendingChipText}>Getting your location…</Text>
        </View>
      ) : null}

      {/* Ghost Mode, which is the reason this map is empty in *both*
          directions — and the one the screen would otherwise leave the user to
          work out for themselves. The muted self marker says it too, but only
          to somebody already looking at their own dot and already knowing what
          muted means.

          A route, not a write. Ghost Mode is a setting on the privacy screen,
          and keeping the write there rather than here means one screen owns it
          and the map cannot flip somebody's visibility as a side effect of
          drawing itself. */}
      {ghostNotice ? (
        <Pressable
          onPress={onOpenPrivacy}
          style={({ pressed }) => [
            styles.pausedNotice,
            { top: overlayTop },
            pressed && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Ghost Mode is on. Nobody can see you and you cannot see anyone. Opens privacy settings, where you can turn it off."
        >
          <IconGhost size={18} color={colors.t2} />
          <View style={styles.pausedNoticeText}>
            <Text style={styles.pausedNoticeTitle}>Ghost Mode is on</Text>
            <Text style={styles.pausedNoticeSub}>
              Nobody can see you, and you can’t see anyone. Tap to turn it off.
            </Text>
          </View>
          <IconChevron size={18} color={colors.t3} />
        </Pressable>
      ) : null}

      {/* The one place the map admits it is drawing on a shifted basemap.
          Stated rather than silently corrected: everything here — your dot,
          everyone else's, the zone outline — is in true GPS coordinates and
          agrees with itself, but the tiles underneath are offset. */}
      {offsetNotice ? (
        <View
          style={[styles.offsetNotice, { top: noticeTop }]}
          accessible
          accessibilityRole="alert"
        >
          <Text style={styles.offsetNoticeText}>{MAINLAND_CHINA_NOTICE}</Text>
        </View>
      ) : null}
    </>
  );
}

/** The two panels and the full-screen viewer that can cover the map. */
function MapSheets({
  sheetUser, selectedUser, sheetMeetup, selectedMeetup, sheetPin, selectedPin, sheetY,
  storyViewer, currentUserId, friendIds, goingToMeetup,
  onCloseSheet, onCloseMeetupSheet, onClosePinSheet, onToggleGoing, onUnpin,
  onFriendChange, onCloseStories, onReact,
}: {
  sheetUser: NearbyUser | null;
  selectedUser: NearbyUser | null;
  sheetMeetup: ClubMeetup | null;
  selectedMeetup: ClubMeetup | null;
  sheetPin: PinnedPlace | null;
  selectedPin: PinnedPlace | null;
  sheetY: SharedValue<number>;
  storyViewer: { stories: Story[] } | null;
  currentUserId: number | null;
  friendIds: Set<number>;
  /** Whether the meetup in the open card is one the viewer said they are
   *  going to. Passed in rather than read here so the sheet and the marker
   *  answer it from the same list. */
  goingToMeetup: boolean;
  onCloseSheet: () => void;
  onCloseMeetupSheet: () => void;
  onClosePinSheet: () => void;
  onToggleGoing: (meetup: ClubMeetup) => Promise<void>;
  onUnpin: (place: PinnedPlace) => void;
  onFriendChange: () => void;
  onCloseStories: () => void;
  onReact: (storyId: number, reaction: ReactionType) => Promise<void>;
}) {
  // Who a reply would go to, or nobody: the author has to be a friend, and
  // replying to yourself is not a thing.
  const author = storyViewer?.stories[0]?.author;
  const authorId = author ? Number(author.id) : null;
  const replyTo =
    author && authorId !== null && authorId !== currentUserId && friendIds.has(authorId)
      ? { id: authorId, username: author.username }
      : null;

  return (
    <>
      {/* User detail sheet — kept mounted after first tap to avoid remount cost. */}
      {sheetUser && (
        <View
          style={[StyleSheet.absoluteFill, { opacity: selectedUser ? 1 : 0 }]}
          pointerEvents={selectedUser ? 'box-none' : 'none'}
        >
          <UserSheet
            user={sheetUser}
            sheetY={sheetY}
            onDismiss={onCloseSheet}
            onFriendChange={onFriendChange}
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
            pinned={goingToMeetup}
            onToggleGoing={onToggleGoing}
            sheetY={sheetY}
            onDismiss={onCloseMeetupSheet}
          />
        </View>
      )}

      {/* Pinned place card — same pre-mount strategy again. */}
      {sheetPin && (
        <View
          style={[StyleSheet.absoluteFill, { opacity: selectedPin ? 1 : 0 }]}
          pointerEvents={selectedPin ? 'box-none' : 'none'}
        >
          <PinnedSheet
            place={sheetPin}
            sheetY={sheetY}
            onDismiss={onClosePinSheet}
            onUnpin={onUnpin}
          />
        </View>
      )}

      {/* Full-screen story viewer */}
      {storyViewer && (
        <StoryViewer
          stories={storyViewer.stories}
          onClose={onCloseStories}
          onReact={onReact}
          replyTo={replyTo}
          currentUserId={currentUserId}
        />
      )}
    </>
  );
}

/** Momentary confirmations, drawn above everything so a sheet cannot bury one. */
function MapToasts({ styles, colors, top, hiToast, locationToast, locationless }: {
  styles: MapStyles;
  colors: ColorPalette;
  top: number;
  hiToast: boolean;
  locationToast: boolean;
  /** Whether the story being written will carry a pin. */
  locationless: boolean;
}) {
  return (
    <>
      {/* Hi sent toast */}
      {hiToast && (
        <View style={[styles.hiToast, { top }]} pointerEvents="none">
          <IconHi size={16} color={colors.teal} />
          <Text style={styles.hiToastText}>Hi sent</Text>
        </View>
      )}

      {/* Story location toast */}
      {locationToast && (
        <View style={[styles.hiToast, { top }]} pointerEvents="none">
          <IconPin size={16} color={colors.teal} />
          <Text style={styles.hiToastText}>
            {locationless
              ? 'Story will be shared with friends, without a map location'
              : 'Story will be posted at your current location'}
          </Text>
        </View>
      )}
    </>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function MapScreen() {
  const { colors, themeMode } = useTheme();
  // No wrapper: now that the screen's compile-blocking code has moved into
  // `useMapData`, React Compiler caches this and every `styles.*` read off it
  // by itself — emit is byte-identical with and without a `useMemo`.
  const styles = makeStyles(colors);
  const router = useRouter();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
  const { ensure: ensurePermission, primer } = usePermissionPrimer();

  // The device's own position, the permission behind it, and the camera that
  // follows it — see hooks/useMapLocation. Called before every hook that reads
  // `coordsRef`, so its mirror effect lands first on any commit where both run.
  const {
    mapRef, coords, coordsRef, displayCoords, speedRef,
    permState, setPermState,
    locateState, handleLocatePress, stopFollowing, zoomToCluster,
    zoomDelta, mapH, onMapLayout, onRegionChangeComplete,
  } = useMapLocation(ensurePermission);

  // Everyone else, and the poll that keeps them true — see hooks/useMapData.
  // It reads `coordsRef`, so it is called after the hook that owns it.
  const {
    nearby, currentUserId, friendIds, connectionIds, selfProfile, selfZone,
    stories, clubMeetups, awaitingFix, fetchFriends, reactToStory, createStory,
  } = useMapData(coordsRef, speedRef, !!coords);

  // The places this viewer saved — where a Swift was made, and the meetups
  // they said they are going to. On-device and account-scoped; see
  // services/pinnedPlaces for why they are not on the server.
  const pinnedPlaces = usePinnedPlaces();

  // Which panel is open over the map, and the spring that opens it — see
  // hooks/useMapSheets. Given the live lists so an open sheet follows each poll.
  const {
    sheetY, selectedUser, selectedMeetup, selectedPin, storyViewer,
    sheetUser, sheetMeetup, sheetPin,
    openSheet, closeSheet, openMeetupSheet, closeMeetupSheet,
    openPinSheet, closePinSheet, openStoryViewer, closeStoryViewer,
  } = useMapSheets(nearby, stories, pinnedPlaces);

  // The story composer and the left-edge swipe that opens it.
  const { composerOpen, createStoryCoord, composeEdge, openComposerAt, closeComposer } =
    useStoryComposer(coordsRef);

  const { showStoryTutorial, dismissStoryTutorial } = useStoryTutorial(currentUserId);
  const [hiToast, setHiToast]           = useState(false);
  const [locationToast, setLocationToast] = useState(false);
  const hiToastTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUserIdRef   = useRef<number | null>(null);
  // Mirrors state for the polling callbacks further down. Declared above every
  // effect that reads it, so on any commit where both run this one lands first.
  // `coordsRef` is the same arrangement one level up, in useMapLocation.
  useEffect(() => { currentUserIdRef.current = currentUserId; });

  const reduceMotion = useReduceMotion();

  // Who is allowed on this map at all, and whose stories may pin to it — see
  // hooks/useVisiblePeople. Policy, not plumbing.
  const { visibleNearby, storiesByAuthor } = useVisiblePeople(
    nearby, stories, currentUserId, friendIds, connectionIds,
  );

  // Ghost Mode: nobody sees the viewer and the viewer sees nobody. Drawn in
  // three places here — the muted self marker, the notice, and what the story
  // composer says it will do. The rounding that keeps the owner's own view
  // honest lives with the position itself, in hooks/useMapLocation.
  const ghost = useGhostMode();

  // Speed trails. Fed from the same list the markers render, so a person who
  // disappears from `visibleNearby` takes their trail history with them.
  const motionTrails = useMotionTrails(visibleNearby);

  // Zone outlines, music rings and the basemap-offset notice — see
  // hooks/useMapOverlays. The purple is passed in rather than imported there
  // so the ring follows the live palette, the same as every other colour on
  // this screen.
  const overlays = useMapOverlays(visibleNearby, selfZone, displayCoords, colors.purple);

  // Where each marker lands, and the pooled slots the badges and leader lines
  // are drawn from. The pools are why nothing here is ever unmounted — see
  // PARKED_MARKERS above and hooks/useMarkerSlots.
  const slots = useMarkerSlots(
    visibleNearby, displayCoords, overlays.musicZones, overlays.zoneAreas, zoomDelta, mapH,
  );

  /** Whether the meetup whose card is open is one the viewer is going to.
   *  Read off the same list the markers use, so the card and the pin on the
   *  map can never disagree about it. */
  const goingToMeetup = !!sheetMeetup
    && pinnedPlaces.some((p) => p.kind === 'meetup' && p.source_id === sheetMeetup.id);

  /** "I'm going", and its undo.
   *
   *  Lives on the screen rather than inside the sheet so the meetup card and
   *  anything else that grows the same button later share one implementation
   *  of what going means — a pin, and nothing sent anywhere. */
  async function toggleGoing(meetup: ClubMeetup) {
    const pinned = pinnedPlaces.some(
      (p) => p.kind === 'meetup' && p.source_id === meetup.id,
    );
    if (pinned) {
      await unpinPlace(pinIdFor('meetup', meetup.id));
      return;
    }
    const result = await pinMeetup({
      meetupId: meetup.id,
      latitude: meetup.latitude,
      longitude: meetup.longitude,
      title: meetup.title,
      clubName: meetup.club_name,
      locationName: meetup.location_name,
      eventDatetime: meetup.event_datetime,
      expiresAt: meetup.expires_at,
    });
    if (!result.ok && result.reason === 'limit') {
      Alert.alert(
        'Your map is full',
        `You can keep ${MAX_PINS} pinned places. Remove one to add this meetup.`,
      );
    }
  }

  /** Dismiss first, then remove. The card is read back out of the pin list, so
   *  removing it while it is still on screen would blank the panel mid-slide —
   *  `useMapSheets` keeps the opened row for exactly this reason. */
  function handleUnpin(place: PinnedPlace) {
    closePinSheet();
    void unpinPlace(place.id);
  }

  function handleHiSent() {
    fetchFriends();
    setHiToast(true);
    if (hiToastTimer.current) clearTimeout(hiToastTimer.current);
    hiToastTimer.current = setTimeout(() => setHiToast(false), 1500);
  }

  /** Long-press writes a story where the finger landed.
   *
   *  No `if (!coords) return` guard: not having a fix — because Ghost Mode is
   *  on, or the permission was never granted — is no longer a reason a story
   *  cannot be written. It only means the story will not be a pin, which the
   *  toast then says out loud. */
  function openComposerHere() {
    openComposerAt(coords ?? null);
    setLocationToast(true);
    if (locationToastTimer.current) clearTimeout(locationToastTimer.current);
    locationToastTimer.current = setTimeout(() => setLocationToast(false), 2000);
  }

  /** The dead end's own way out. `blocked` has spent its one dialog, so the
   *  only thing left to offer is Settings; anything else may still ask. */
  async function allowLocation() {
    if (permState === 'blocked') {
      openAppSettings();
      return;
    }
    if (await ensurePermission('location')) setPermState('granted');
  }


  // The sheet and the story viewer used to be re-synced here after every fetch.
  // Both now read their rows out of the live lists as they render, so there is
  // nothing left to copy across.

  /** The control belongs to the map, not to the states that replace it: over
   * the permission dead end it duplicates the Allow button, and over the
   * full-screen "Locating you…" it is a spinner on top of a spinner. */
  const mapVisible = !(permState && permState !== 'granted') && !!displayCoords;

  // Parked directly over the Settings tab rather than in the corner, so it
  // reads as one column of controls with the nav instead of a stray button.
  // Derived before the clearance below, which measures from wherever it lands.
  const locateRight = useNavAlignedRight(LOCATE_SIZE, LOCATE_INSET);

  // Both navs span nearly the full width, so there is no free bottom corner:
  // the button clears whatever height the nav reaches across its own footprint.
  // The 8 is the gap above the nav — small, because sitting just clear of the
  // Settings tab is what makes the two read as related.
  const navClearance = useNavClearance(locateRight, LOCATE_SIZE);
  const locateBottom = bottomInset + navClearance + 8;

  // Whether the map's own controls are reachable at all. A sheet or a
  // full-screen viewer covers them with a backdrop, so anything left drawn
  // underneath is visible-but-dead rather than merely hidden.
  const chromeVisible =
    mapVisible && !selectedUser && !selectedMeetup && !selectedPin
    && !storyViewer && !composerOpen;

  // The strip directly under the top bar, where the map's notices sit.
  const overlayTop = topInset + 52 + (awaitingFix ? 46 : 0);

  // Paused takes the top of that strip, so anything else drawn there stacks
  // below it rather than on top of it — the basemap-offset notice is pinned to
  // the same line and the two would otherwise land exactly on each other.
  const ghostNoticeVisible = chromeVisible && ghost === true;
  const noticeTop = overlayTop + (ghostNoticeVisible ? 56 : 0);

  const region: Region | undefined = displayCoords
    ? { ...displayCoords, latitudeDelta: 0.012, longitudeDelta: 0.012 }
    : undefined;

  return (
    <View style={styles.container}>
      {permState && permState !== 'granted' ? (
        <MapPermissionGate
          permState={permState}
          styles={styles}
          onAllow={allowLocation}
          onList={() => router.push('/nearby')}
        />
      ) : !displayCoords ? (
        <View style={styles.center} accessible accessibilityLabel="Finding your location">
          <ActivityIndicator color={colors.teal} size="large" />
          <Text style={styles.loadingText}>Locating you…</Text>
        </View>
      ) : (
        <MapCanvas
          mapRef={mapRef}
          styles={styles}
          themeMode={themeMode}
          region={region}
          displayCoords={displayCoords}
          colors={colors}
          overlays={overlays}
          slots={slots}
          visibleNearby={visibleNearby}
          motionTrails={motionTrails}
          reduceMotion={reduceMotion}
          friendIds={friendIds}
          connectionIds={connectionIds}
          selfProfile={selfProfile}
          selfZone={selfZone}
          ghost={ghost}
          storiesByAuthor={storiesByAuthor}
          clubMeetups={clubMeetups}
          pinnedPlaces={pinnedPlaces}
          onMapLayout={onMapLayout}
          onRegionChangeComplete={onRegionChangeComplete}
          onPanDrag={() => stopFollowing('gesture')}
          onLongPress={openComposerHere}
          onOpenSheet={openSheet}
          onZoomToCluster={zoomToCluster}
          onOpenStories={openStoryViewer}
          onOpenMeetup={openMeetupSheet}
          onOpenPin={openPinSheet}
        />
      )}

      {/* Swipe right from the left edge to open the composer.
          A narrow strip rather than the whole map, because the map wants
          horizontal drags too — panning east would otherwise be indisting-
          uishable from asking to post something. This is the same edge the
          system's own back gesture used to occupy here, which is what the
          swipe already felt like reaching for; that one is off now (it was
          popping signed-in users out to the sign-up screen — see the
          `(tabs)` entry in app/_layout).
          Rendered directly after the map so every control below still takes
          the touch ahead of it. */}
      <GestureDetector gesture={composeEdge}>
        <View style={styles.composeEdge} />
      </GestureDetector>

      {/* Top bar */}
      <TopBar
        nearby={visibleNearby.length}
        pinCount={pinnedPlaces.length}
        onPinned={() => router.push('/pinned')}
        onZoneMusic={() => router.push('/zone')}
        onSearch={() => router.push('/search')}
        onList={() => router.push('/nearby')}
      />

      <MapNotices
        styles={styles}
        colors={colors}
        topInset={topInset}
        overlayTop={overlayTop}
        noticeTop={noticeTop}
        pending={chromeVisible && awaitingFix}
        ghostNotice={ghostNoticeVisible}
        offsetNotice={!!overlays.chinaOffsetNotice && mapVisible}
        onOpenPrivacy={() => router.push('/privacy')}
      />

      <MapSheets
        sheetUser={sheetUser}
        selectedUser={selectedUser}
        sheetMeetup={sheetMeetup}
        selectedMeetup={selectedMeetup}
        sheetPin={sheetPin}
        selectedPin={selectedPin}
        sheetY={sheetY}
        storyViewer={storyViewer}
        currentUserId={currentUserId}
        friendIds={friendIds}
        goingToMeetup={goingToMeetup}
        onCloseSheet={closeSheet}
        onCloseMeetupSheet={closeMeetupSheet}
        onClosePinSheet={closePinSheet}
        onToggleGoing={toggleGoing}
        onUnpin={handleUnpin}
        onFriendChange={handleHiSent}
        onCloseStories={closeStoryViewer}
        onReact={reactToStory}
      />

      <CreateStoryModal
        visible={composerOpen}
        locationless={ghost === true || (!createStoryCoord && !coords)}
        onClose={closeComposer}
        onPost={(text, photoUri) => createStory(text, photoUri, createStoryCoord)}
      />

      <MapToasts
        styles={styles}
        colors={colors}
        top={overlayTop + 52}
        hiToast={hiToast}
        locationToast={locationToast}
        locationless={ghost === true || !coords}
      />

      {primer}

      <ApproxNav />

      {/* Locate / follow control.
          Rendered after the nav on purpose. The wheel's root is a full-width
          absolutely-positioned View with default pointerEvents and elevation
          10, so it swallows every touch inside its ~200pt-tall rectangle that
          doesn't land on one of its own tabs — anything drawn behind it there
          is visible but dead. It has to absorb those touches (otherwise drags
          on the opaque arc would pan the map underneath), so the button sits
          above it instead.

          Hidden while a sheet or full-screen overlay owns the screen: the user
          sheet reaches 400pt up with a backdrop over everything below it, so a
          button left there is both covered and unreachable. */}
      {chromeVisible && (
        <LocateButton
          state={locateState}
          bottom={locateBottom}
          right={locateRight}
          onPress={handleLocatePress}
        />
      )}

      {mapVisible && showStoryTutorial && (
        <StoryTutorialOverlay onDismiss={dismissStoryTutorial} />
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

  //: Checked out. Grey rather than purple, and no lit halo — the marker still
  //: has to be findable by its owner, so this dims it rather than hiding it.
  selfHaloHidden: { backgroundColor: 'rgba(140,140,150,0.14)' },
  selfCoreHidden: { borderColor: colors.t3 },

  // ── "Getting your location" chip ──
  // Invisible, and narrow enough that the map keeps almost all of its width
  // for panning. It claims nothing until a drag turns out to be a rightward
  // horizontal one — see `composeEdge`.
  composeEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 22,
  },
  pendingChip: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.m,
    backgroundColor: withAlpha(colors.bg, 0.92),
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 99,
  },
  pendingChipText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.t2,
  },

  // Wider than `pendingChip` and pinned to the margins rather than centred:
  // this one is a control, and a tap target the width of its own text is a
  // tap target that gets missed.
  pausedNotice: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.m,
    backgroundColor: withAlpha(colors.bg, 0.94),
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 99,
  },
  pausedNoticeText: { flex: 1, gap: 1 },
  pausedNoticeTitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: colors.t1,
  },
  pausedNoticeSub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.t2,
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
  // ── Glass chrome ──
  // No `backgroundColor` on any of the three below: the fill is drawn by
  // `GlassBackdrop` behind the content, and a background here would sit on top
  // of the blur and hide it. `overflow: hidden` is what keeps the blur inside
  // the corner radius — without it the blur is a rectangle behind a rounded
  // button and the corners show as four grey nicks.
  nearbyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 100,
    overflow: 'hidden',
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
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Locate control (tonal surface, teal tint while following) ──
  locateBtn: {
    position: 'absolute',
    // `right` is set inline — it tracks the nav's last tab, not the screen edge.
    width: LOCATE_SIZE,
    height: LOCATE_SIZE,
    borderRadius: radius.m,
    overflow: 'hidden',
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
  /** Following. The tint is a *translucent* layer over the glass rather than a
   *  replacement fill: an opaque one would cover the blur, so the control
   *  would be glass when idle and a flat chip when active — the state change
   *  would read as the button being a different button. */
  locateTint: {
    backgroundColor: withAlpha(colors.tealLine, 0.35),
  },
  locateBtnActive: {
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
  //
  // Both of these sit *below* the nav (zIndex 100 / elevation 10), which is the
  // rule everywhere: nothing covers the bar. They used to be 150 and 200, which
  // put the scrim and the card over it.
  //
  // Android orders siblings by `elevation` independently of `zIndex`, so a
  // layer that must stay under the nav has to lose on both — see LocateButton,
  // which has the same note for the opposite reason.
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 60, elevation: 6 },
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
    zIndex: 70,
    elevation: 7,
    backgroundColor: colors.surface,
  },
  /** The draggable strip across the top of a sheet.
   *
   *  A 4pt-tall bar is not a drag target — a finger covers it several times
   *  over — so the gesture is attached to this padded row instead and the bar
   *  is only what makes it visible. The 16pt that used to be `marginBottom` on
   *  the handle is `paddingBottom` here, so the spacing below the handle is
   *  the same as before and is now also part of what you can grab. */
  sheetGrab: {
    alignSelf: 'stretch',
    paddingTop: 4,
    paddingBottom: 16,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
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
    // Top-aligned, not centred: the title block is two lines now and the close
    // button belongs beside the first of them.
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
    marginTop: 2,
  },
  createModalTitleWrap: { flex: 1, gap: 2 },
  createModalTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    // 22, not 17. The sheet has one job and this is the only heading in it.
    fontSize: 22,
    color: colors.t1,
  },
  createModalSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: colors.t3,
  },
  createModalClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Camera / Library, as two equal cards rather than two bare icon squares.
  mediaRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  mediaCard: {
    flex: 1,
    height: 74,
    borderRadius: radius.m,
    borderWidth: 1,
    // Deliberately solid rather than dashed, which is the obvious choice for
    // an empty slot: Android drops the dash pattern as soon as the border is
    // rounded, so a dashed style here would be dashed on iOS only.
    borderColor: colors.tealLine,
    backgroundColor: colors.tealTint,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mediaCardPressed: { opacity: 0.7 },
  mediaCardLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: colors.t2,
  },

  captionWrap: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingBottom: 8,
    marginBottom: 14,
  },
  storyInput: {
    fontFamily: fonts.body,
    color: colors.t1,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 88,
    textAlignVertical: 'top',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  charCount: {
    fontFamily: fonts.body,
    color: colors.t3,
    fontSize: 11,
    textAlign: 'right',
    paddingHorizontal: 14,
  },
  // Full-contrast rather than a warm accent: this is the one moment the count
  // matters, and an 11pt coral on a coral-tinted surface is not a signal.
  charCountNear: { color: colors.t1, fontWeight: '700' },

  storyNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.m,
    backgroundColor: colors.surface2,
  },
  storyNote: {
    flex: 1,
    fontFamily: fonts.body,
    color: colors.t2,
    fontSize: 12,
    lineHeight: 16,
  },
  photoPreviewContainer: {
    marginBottom: 14,
    position: 'relative',
  },
  photoPreview: {
    width: '100%',
    height: 190,
    borderRadius: radius.m,
  },
  removePhotoBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    // `surface`, not `surface2`: this one sits on the photo rather than on the
    // sheet, and needs to hold its own against whatever is behind it.
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postBtn: {
    // Full width now that the two photo buttons have moved up out of this row.
    backgroundColor: colors.teal,
    borderRadius: radius.m,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postBtnDisabled: { opacity: 0.45 },
  postBtnText: {
    fontFamily: fonts.body,
    color: colors.bg,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

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

  /** The "you are going" corner on a meetup's own marker. Overlaps the bubble's
   *  top-right rather than sitting beside it, so the marker keeps its width and
   *  the fan-out arithmetic in services/markerLayout still holds. */
  goingCorner: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Pinned places ──
  pinnedMarkerWrap: { alignItems: 'center' },
  /** A held place, not a person and not an event: the surface colour with the
   *  source's tint as an outline, so a pin reads as something the viewer put
   *  there rather than as another thing the map found. */
  pinnedMarkerBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  /** The point of the teardrop: a rotated square showing two of its sides, so
   *  the outline runs unbroken around the whole marker. */
  pinnedMarkerTail: {
    width: 10,
    height: 10,
    backgroundColor: colors.surface,
    transform: [{ rotate: '45deg' }],
    marginTop: -6,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderBottomRightRadius: 2,
  },
  pinnedSheetGlyph: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinnedKindLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 3,
  },
  /** What the viewer wrote about this place. Quiet by design — it is their
   *  own handwriting on somebody else's map, not a second title. */
  pinNoteBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    marginBottom: 14,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  /** Empty, it is an invitation rather than content: dashed, and in the accent
   *  the rest of the app uses for "you can do something here". */
  pinNoteEmpty: {
    borderStyle: 'dashed',
    borderColor: colors.tealLine,
    backgroundColor: 'transparent',
  },
  pinNoteText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.t1,
  },
  pinNoteAddText: { color: colors.teal, fontWeight: '600' },

  /** Two buttons on one line. `Button` takes no style of its own, so each one
   *  is full-width inside a flexed cell rather than flexed itself. */
  sheetActionRow: { flexDirection: 'row', gap: 10 },
  sheetActionCell: { flex: 1 },

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
