import { Audio } from 'expo-av';
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
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import Animated, {
    FadeInUp,
    FadeOutUp,
    ReduceMotion,
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
    IconMute,
    IconPeople,
    IconPin,
    IconSearch,
    IconShield,
    IconSound,
    type IconComponent,
} from '@/components/ui/icons';
import { colors, fonts, radius } from '@/constants/theme';
import { announce, useReduceMotion } from '@/hooks/useReduceMotion';
import { recordNearbySightings, recordStoryReactions } from '@/services/activityFeed';
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
import { recordSpeed, shouldQuietPrompts, useOwnMotion } from '@/services/ownMotion';
import { getPref } from '@/services/preferences';
import { getCachedLocationSharing, useLocationSharing } from '@/services/privacy';
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
}

// ─── Constants ────────────────────────────────────────────────────────────────
const COLOR_FRIEND    = colors.blue;
const COLOR_CONNECTED = colors.orange;
const COLOR_STRANGER  = colors.t1;

/** Matches APPROX_GRID_M on the server. */
const APPROX_RADIUS_M = 500;

/** Non-friend marker: opaque core, and the translucent disc around it. */
const DOT_CORE = 20;
const DOT_HALO = 32;

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
const Z_STORY = 7;

const REL_LABEL: Record<Relationship, string> = {
  stranger:  'Nearby',
  hi_sent:   'Hi Sent',
  connected: 'Connected',
  friend:    'Friend',
};

const POLL_MS            = 10_000;
const STORY_POLL_MS      = 10_000;

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
const SHEET_H   = 400;
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
        <View style={[styles.dotHalo, { backgroundColor: color }]} />
        <View style={[styles.userDot, { backgroundColor: color }]} />
        {/* Absent presence renders nothing — PresenceDot returns null — so a
            hidden state never becomes a visible "offline". */}
        <View style={styles.dotPresence}>
          <PresenceDot presence={presence} size={9} haloColor={colors.bg} />
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
  onPress?: () => void;
}

function AvatarMarker({ coordinate, uri, username, ringColor, size = 40, zIndex, presence, motion, onPress }: AvatarMarkerProps) {
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
  const label = [username, presenceLabel(presence), motionLabel(motion)]
    .filter(Boolean)
    .join(', ');

  const inner = size - 6;
  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={!imageReady || ringSettling}
      zIndex={zIndex}
      accessibilityLabel={label}
      onPress={onPress}
    >
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
        <View style={styles.storyAvatarWrap}>
          {story.author.profile_picture ? (
            <Image source={{ uri: story.author.profile_picture }} style={styles.storyCardAvatarImg} />
          ) : (
            <View style={[styles.storyCardAvatar, { backgroundColor: avatarBg }]}>
              <Text style={styles.storyCardAvatarText}>{story.author.username.charAt(0).toUpperCase()}</Text>
            </View>
          )}
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

// ─── Zone Banner ──────────────────────────────────────────────────────────────
/**
 * Only ever a friend's zone — see the zone-detection effect. There is no
 * locked state and no self state left to render, because a banner you cannot
 * listen to is just a notification that you are not allowed to do something.
 */
function ZoneBanner({
  username,
  isPlaying,
  onTap,
  onMute,
}: {
  username: string;
  isPlaying: boolean;
  onTap: () => void;
  onMute: () => void;
}) {
  const { top } = useSafeAreaInsets();
  return (
    <Animated.View
      // Drops in from under the top bar rather than materialising in place, so
      // it reads as arriving. `reduceMotion` is reanimated's own system-setting
      // check, which drops the slide on the UI thread when it's on.
      entering={FadeInUp.duration(260).reduceMotion(ReduceMotion.System)}
      exiting={FadeOutUp.duration(200).reduceMotion(ReduceMotion.System)}
      style={[styles.zoneBanner, { top: top + 62 }]}
    >
      <IconSound size={20} color={colors.teal} />
      <Text style={styles.zoneBannerText} numberOfLines={1}>
        {isPlaying ? 'Playing ' : 'You are in '}
        <Text style={styles.zoneBannerUser}>@{username}</Text>
        {"'s zone"}
      </Text>
      {isPlaying ? (
        <TouchableOpacity
          onPress={onMute}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Mute ${username}'s zone music`}
        >
          <IconMute size={20} color={colors.teal} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={onTap}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Listen to ${username}'s zone music`}
        >
          <Text style={styles.zoneBannerAction}>Listen</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

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
}

function UserSheet({ user, sheetY, onDismiss, onFriendChange }: SheetProps) {
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

  return (
    <>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onDismiss} />
      <Animated.View style={[styles.sheet, { paddingBottom: bottom + 20 }, animStyle]}>
        <View style={styles.sheetHandle} />

        <Pressable onPress={onDismiss} hitSlop={14} style={styles.closeBtn}>
          <IconClose size={16} color={colors.t3} />
        </Pressable>

        <View style={styles.sheetHero}>
          <Avatar
            uri={user.profile_picture}
            name={user.username}
            size="lg"
            ringColor={relRingColor}
          />
          <Text style={styles.sheetName}>{user.username}</Text>
          <View style={styles.sheetMetaRow}>
            <View style={styles.relBadge}>
              <Text style={[styles.relBadgeText, { color: relLabelColor }]}>
                {REL_LABEL[rel] ?? 'Nearby'}
              </Text>
            </View>
            {dist && (
              <View style={styles.relBadge}>
                <Text style={styles.relBadgeText}>{dist}</Text>
              </View>
            )}
            {/* Absent presence renders nothing, so a viewer who is not in the
                audience sees no badge rather than a false "offline". */}
            {user.presence && (
              <View style={styles.relBadge}>
                <PresenceDot presence={user.presence} size={8} withText />
              </View>
            )}
            {/* The trail on the map is decorative and hidden from screen
                readers, so the state it conveys is also stated in words. */}
            {motionLabel(user.motion_class) && (
              <View style={styles.relBadge} accessible accessibilityLabel={motionLabel(user.motion_class)!}>
                <Text style={[styles.relBadgeText, { color: colors.teal }]} importantForAccessibility="no">
                  {user.motion_class === 'fast' ? 'Moving fast' : 'On the move'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {user.shared_interests && user.shared_interests.length > 0 && (
          <View style={styles.interestsSection}>
            <Text style={styles.sectionLabel}>Shared Interests</Text>
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

        <View style={styles.actions}>
          <View style={styles.actionBtn}>
            {isStranger && (
              <Button label="Send Hi" variant="primary" size="md" fullWidth onPress={sendHi} />
            )}
            {isHiSent && (
              <Button label="Hi Sent ✓" variant="secondary" size="md" fullWidth disabled />
            )}
            {(isFriend || isConnected) && (
              <Button
                label="Message"
                variant={isConnected ? 'secondary' : 'primary'}
                size="md"
                fullWidth
                onPress={goToMessages}
              />
            )}
          </View>
          <View style={styles.actionBtn}>
            <Button label="View Profile" variant="ghost" size="md" fullWidth onPress={goToProfile} />
          </View>
        </View>
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
  /** Always a friend's zone with playable audio, or null. */
  const [activeZone, setActiveZone]   = useState<{ username: string; audioUrl: string } | null>(null);
  const [isPlaying, setIsPlaying]     = useState(false);
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
  const soundRef           = useRef<Audio.Sound | null>(null);
  const currentUserIdRef   = useRef<number | null>(null);
  const playingUrlRef      = useRef<string | null>(null);
  const mutedZoneRef       = useRef<string | null>(null);
  const announcedZoneRef   = useRef<string | null>(null);
  const mapRef             = useRef<MapView | null>(null);
  /** Last region the map settled on, so recentering can keep the user's zoom
   * instead of snapping back to the default every time they move. */
  const regionRef          = useRef<Region | null>(null);
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

  // Feed the local notification feed: friends nearby (with distance) and
  // interest matches. The feed itself dedupes with a per-user cooldown.
  //
  // Held back entirely while the user is moving at vehicle speed. Someone doing
  // 40km/h is driving or being driven, and we cannot tell which — telling a
  // driver that a stranger with shared interests is 200m away is asking them to
  // look at their phone. Deferred rather than dropped: this effect re-runs on
  // the next poll, so whatever is still nearby when they stop is recorded then.
  const ownMotion = useOwnMotion();
  useEffect(() => {
    if (visibleNearby.length === 0) return;
    if (shouldQuietPrompts()) return;
    recordNearbySightings(
      visibleNearby.map((u) => ({
        id: Number(u.id),
        username: u.username,
        isFriend: friendIds.has(Number(u.id)),
        sharedInterests: u.shared_interests ?? [],
        distanceKm: u.distance_km ?? (u.distance != null ? u.distance / 1000 : undefined),
      })),
    );
    // `ownMotion` is a dependency so the deferred batch lands as soon as the
    // user comes to a stop, rather than waiting for the next position change.
  }, [visibleNearby, friendIds, ownMotion]);

  // Detect new reactions on the current user's own stories.
  useEffect(() => {
    if (currentUserId == null || stories.length === 0) return;
    recordStoryReactions(
      stories.map((s) => ({ id: s.id, authorId: s.author.id, reactions: s.reactions ?? {} })),
      currentUserId,
    );
  }, [stories, currentUserId]);

  const fetchFriends = useCallback(async () => {
    try {
      const r = await api.get<{ friends: { id: number }[]; connections: { id: number }[] }>('/api/friends/list/');
      setFriendIds(new Set(r.data.friends.map((u) => Number(u.id))));
      setConnectionIds(new Set(r.data.connections.map((u) => Number(u.id))));
    } catch {}
  }, []);

  async function stopZone() {
    playingUrlRef.current = null;
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setIsPlaying(false);
  }

  async function playZone(url: string, username: string) {
    await stopZone();
    console.log('[Zone] attempting to play audio:', url);
    try {
      await Audio.setAudioModeAsync({
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
      });
      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true, isLooping: true },
      );
      soundRef.current = sound;
      playingUrlRef.current = url;
      setIsPlaying(true);
      console.log('[Zone] audio playing successfully');
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) setIsPlaying(false);
      });
    } catch (e: any) {
      console.log('[Zone] audio play error:', e.message);
      setIsPlaying(false);
    }
  }

  // Detect the zone the banner and audio follow.
  //
  // A friend's zone, or nothing. The banner exists to offer you music you can
  // actually play, so the two cases that used to reach it no longer do:
  //
  //   A stranger's or connection's zone — including an interest match, which
  //   is the only kind of stranger the map draws at all — used to appear as a
  //   locked "Friends only" row. That is a banner announcing something you
  //   can't do, in the one place you can't act on it.
  //
  //   The owner's own zone used to appear too, captioned "You are in no one's
  //   zone". It is your own music, you already know it's there, and it was
  //   never autoplayed anyway.
  useEffect(() => {
    // The server omits zone_audio_url for anyone the owner's Zone audio
    // setting excludes, so a friend without a URL is a friend whose audio we
    // are not allowed to play — that's a no-banner case too, not a locked one.
    const friendZone = visibleNearby.find((u) =>
      u.zone_active &&
      friendIds.has(Number(u.id)) &&
      u.zone_audio_url &&
      (u.distance_km ?? Infinity) * 1000 < (u.zone_radius ?? 500),
    );
    console.log('[Zone] friend zone in range:', friendZone?.username ?? 'none');

    if (!friendZone?.zone_audio_url) {
      setActiveZone(null);
      mutedZoneRef.current = null;
      announcedZoneRef.current = null;
      if (playingUrlRef.current) stopZone();
      return;
    }

    const next = { username: friendZone.username, audioUrl: friendZone.zone_audio_url };
    setActiveZone(next);

    // The banner slides in on its own as you walk into a zone, with no focus
    // change to hint at it. Announced from here rather than via
    // accessibilityLiveRegion, which is Android-only — and guarded, because
    // this effect re-runs on every 10s poll.
    if (announcedZoneRef.current !== next.username) {
      announcedZoneRef.current = next.username;
      announce(`You are in ${next.username}'s zone. Their music is available.`);
    }
    if (mutedZoneRef.current && mutedZoneRef.current !== next.username) mutedZoneRef.current = null;

    // Stop stale audio when the zone (or its track) changed.
    if (playingUrlRef.current && playingUrlRef.current !== next.audioUrl) stopZone();

    // Only when nothing is playing yet and the user hasn't muted it — the
    // nearby poll re-runs this effect every 10s, and an unguarded playZone()
    // here restarts the track each time.
    if (!playingUrlRef.current && mutedZoneRef.current !== next.username) {
      const { audioUrl, username } = next;
      getPref('zoneAutoplay').then((autoplay) => {
        if (autoplay && !playingUrlRef.current) playZone(audioUrl, username);
      });
    }
  }, [visibleNearby, friendIds]);

  // Stop audio on unmount
  useEffect(() => {
    return () => { stopZone(); };
  }, []);

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
          onLayout={() => console.log('[Map] step 5: map rendering')}
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
          onRegionChangeComplete={(r) => { regionRef.current = r; }}
          onLongPress={() => {
            if (!coords) return;
            setCreateStoryCoord(coords);
            setLocationToast(true);
            if (locationToastTimer.current) clearTimeout(locationToastTimer.current);
            locationToastTimer.current = setTimeout(() => setLocationToast(false), 2000);
          }}
        >
          {/* Zone circles for nearby users */}
          {visibleNearby
            .filter((u) => u.zone_active && (u.zone_radius ?? 0) > 0 && u.latitude != null && u.longitude != null)
            .map((u) => {
              console.log('[Map] drawing zone for:', u.username, 'active:', u.zone_active, 'lat:', u.latitude, 'lng:', u.longitude, 'radius:', u.zone_radius);
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

          {/* Zone circle for self */}
          {selfZone?.zone_active && (selfZone.zone_radius ?? 0) > 0 && (
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

          {visibleNearby.filter((u) => u.latitude != null && u.longitude != null).map((user) => {
            const uid = Number(user.id);
            const isFriend = friendIds.has(uid);
            const color = isFriend ? COLOR_FRIEND : connectionIds.has(uid) ? COLOR_CONNECTED : COLOR_STRANGER;
            // Only friends reveal their avatar on the map; everyone else stays a dot.
            return isFriend ? (
              <AvatarMarker
                key={user.id}
                coordinate={{ latitude: user.latitude, longitude: user.longitude }}
                uri={user.profile_picture}
                username={user.username}
                ringColor={color}
                presence={user.presence}
                motion={user.motion_class}
                zIndex={Z_FRIEND}
                onPress={() => openSheet(user)}
              />
            ) : (
              <DotMarker
                key={user.id}
                coordinate={{ latitude: user.latitude, longitude: user.longitude }}
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

          <SelfMarker
            coordinate={displayCoords}
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

      {/* Zone banner */}
      {activeZone && (
        <ZoneBanner
          username={activeZone.username}
          isPlaying={isPlaying}
          onTap={() => {
            mutedZoneRef.current = null;
            playZone(activeZone.audioUrl, activeZone.username);
          }}
          onMute={() => {
            mutedZoneRef.current = activeZone.username;
            stopZone();
          }}
        />
      )}


      {/* User detail sheet */}
      {selectedUser && (
        <UserSheet
          user={selectedUser}
          sheetY={sheetY}
          onDismiss={closeSheet}
          onFriendChange={handleHiSent}
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

  // ── Non-friend marker: relationship-colored dot in a soft halo ──
  //
  // Sized against the default viewport, not against how it looks in isolation.
  // At latitudeDelta 0.012 the map shows roughly 2 m per pixel, so a person
  // standing 30 m away lands ~15 px from you — the old 14 px dot was both easy
  // to miss and small enough to disappear under a neighbouring marker.
  dotWrap: {
    width: DOT_HALO,
    height: DOT_HALO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Widens the target without inflating the dot itself: the marker keeps
   * reading as a point, but one with enough presence to catch the eye against
   * map texture. */
  dotHalo: {
    position: 'absolute',
    width: DOT_HALO,
    height: DOT_HALO,
    borderRadius: DOT_HALO / 2,
    opacity: 0.22,
  },
  userDot: {
    width: DOT_CORE,
    height: DOT_CORE,
    borderRadius: DOT_CORE / 2,
    borderWidth: 2.5,
    borderColor: colors.bg,
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
  avatarMarkerRing: {
    borderWidth: 2,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
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

  // ── Zone banner (solid card) ──
  zoneBanner: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 90,
  },
  zoneBannerText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t1,
  },
  zoneBannerUser: { fontWeight: '600' },
  zoneBannerAction: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.teal,
  },


  // ── Sheet ──
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 150 },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_H,
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
    marginBottom: 20,
  },
  sheetHero: {
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  sheetName: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 17,
    color: colors.t1,
  },
  sheetMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  relBadge: {
    backgroundColor: colors.surface2,
    borderRadius: radius.s,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  relBadgeText: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: colors.t2,
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 20,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
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
  actions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1 },
  addFriendRow: { marginBottom: 10 },

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
  storyCountBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(10,10,11,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  storyCountText: {
    fontFamily: fonts.body,
    fontSize: 9,
    fontWeight: '700',
    color: colors.t1,
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
