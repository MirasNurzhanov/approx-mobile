import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';
import Animated, {
  FadeIn,
  FadeOut,
  type SharedValue,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Speedometer } from '@/components/Speedometer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import {
  IconCamera,
  IconChevron,
  IconClose,
  IconFunny,
  IconHi,
  IconImage,
  IconInsight,
  IconLike,
  IconMute,
  IconPeople,
  IconPin,
  IconSearch,
  IconShield,
  IconSound,
  IconStar,
  type IconComponent,
} from '@/components/ui/icons';
import { api } from '@/services/api';
import { recordNearbySightings, recordStoryReactions } from '@/services/activityFeed';
import { encodeStoryReply } from '@/services/storyReply';
import { startBackgroundLocationUpdates } from '@/services/backgroundLocation';
import { getPref } from '@/services/preferences';
import { registerNearbyRefresh } from '@/services/nearbyRefresh';
import { colors, fonts, radius } from '@/constants/theme';

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
}

interface SelfZone {
  zone_active: boolean;
  zone_radius: number;
  zone_audio_url?: string;
}

type ReactionType = 'like' | 'funny' | 'helpful' | 'interesting';

interface StoryAuthor {
  id: number;
  username: string;
  profile_picture?: string;
}

interface Story {
  id: number;
  author: StoryAuthor;
  text?: string;
  content?: string;
  image?: string;
  place_name?: string;
  latitude: number;
  longitude: number;
  created_at: string;
  expires_at: string;
  reactions: { like: number; funny: number; helpful: number; interesting: number };
  user_reaction?: ReactionType | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const COLOR_FRIEND    = colors.blue;
const COLOR_CONNECTED = colors.orange;
const COLOR_STRANGER  = colors.t1;

const REL_LABEL: Record<Relationship, string> = {
  stranger:  'Nearby',
  hi_sent:   'Hi Sent',
  connected: 'Connected',
  friend:    'Friend',
};

const POLL_MS            = 10_000;
const STORY_POLL_MS      = 10_000;
const STORY_DURATION_MS  = 7_000;

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
  { featureType: 'poi', elementType: 'labels.text.fill',       stylers: [{ color: '#5E5E68' }] },
  { featureType: 'transit', elementType: 'geometry',           stylers: [{ color: '#16161B' }] },
  { featureType: 'administrative', elementType: 'geometry',         stylers: [{ color: '#1A1A20' }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#5E5E68' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.food_and_drink', stylers: [{ visibility: 'off' }] },
];
const SHEET_H   = 400;
const SPRING_CFG = { damping: 22, stiffness: 220, mass: 0.9 };

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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function timeLeft(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 1) return `${Math.floor(diff / 60_000)}m left`;
  return `${hrs}h left`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DotMarker({ coordinate, color, onPress }: {
  coordinate: { latitude: number; longitude: number };
  color: string;
  onPress?: () => void;
}) {
  // Re-arm tracking briefly when the color changes (friend data arrives after
  // the first nearby fetch), then freeze the rasterized marker again.
  const [settling, setSettling] = useState(true);
  useEffect(() => {
    setSettling(true);
    const t = setTimeout(() => setSettling(false), 400);
    return () => clearTimeout(t);
  }, [color]);

  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={settling} onPress={onPress}>
      <View style={[styles.userDot, { backgroundColor: color }]} />
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
  onPress?: () => void;
}

function AvatarMarker({ coordinate, uri, username, ringColor, size = 32, zIndex, onPress }: AvatarMarkerProps) {
  // Markers rasterize their children: keep tracking until the remote image is
  // drawn, and re-arm briefly when the ring color changes (friend data arrives
  // after the first nearby fetch).
  const [imageReady, setImageReady] = useState(!uri);
  const [imageFailed, setImageFailed] = useState(false);
  const [ringSettling, setRingSettling] = useState(true);

  useEffect(() => { setImageReady(!uri); setImageFailed(false); }, [uri]);
  useEffect(() => {
    setRingSettling(true);
    const t = setTimeout(() => setRingSettling(false), 400);
    return () => clearTimeout(t);
  }, [ringColor]);

  const inner = size - 6;
  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={!imageReady || ringSettling}
      zIndex={zIndex}
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

// ─── Top Bar ─────────────────────────────────────────────────────────────────
function TopBar({ nearby, onPrivacy, onSearch }: { nearby: number; onPrivacy: () => void; onSearch: () => void }) {
  const { top } = useSafeAreaInsets();
  return (
    <View style={[styles.topBar, { paddingTop: top + 6 }]}>
      <Text style={styles.topLogoText}>AURA</Text>

      <View style={styles.nearbyBadge}>
        <IconPeople size={16} color={colors.t2} />
        <Text style={styles.nearbyBadgeText}>{nearby} nearby</Text>
      </View>

      <View style={styles.topSpacer} />

      <TouchableOpacity onPress={onSearch} activeOpacity={0.7} style={styles.iconBtn} hitSlop={6}>
        <IconSearch size={20} color={colors.t2} />
      </TouchableOpacity>

      <TouchableOpacity onPress={onPrivacy} activeOpacity={0.7} style={styles.iconBtn} hitSlop={6}>
        <IconShield size={20} color={colors.t2} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Zone Banner ──────────────────────────────────────────────────────────────
function ZoneBanner({
  username,
  isPlaying,
  canListen,
  isSelf,
  onTap,
  onMute,
}: {
  username: string;
  isPlaying: boolean;
  canListen: boolean;
  isSelf: boolean;
  onTap: () => void;
  onMute: () => void;
}) {
  const { top } = useSafeAreaInsets();
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={[styles.zoneBanner, { top: top + 62 }]}
    >
      <IconSound size={20} color={colors.teal} />
      <Text style={styles.zoneBannerText} numberOfLines={1}>
        {isPlaying ? 'Playing ' : "You're in "}
        <Text style={styles.zoneBannerUser}>{isSelf ? 'your' : `@${username}`}</Text>
        {isSelf ? ' zone' : "'s zone"}
      </Text>
      {isPlaying ? (
        <TouchableOpacity onPress={onMute} hitSlop={12}>
          <IconMute size={20} color={colors.teal} />
        </TouchableOpacity>
      ) : canListen ? (
        <TouchableOpacity onPress={onTap} hitSlop={12}>
          <Text style={styles.zoneBannerAction}>Listen</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.zoneBannerLocked}>Friends only</Text>
      )}
    </Animated.View>
  );
}

// ─── Story Viewer (full-screen, Instagram-style) ──────────────────────────────
const REACTIONS: { type: ReactionType; Icon: IconComponent }[] = [
  { type: 'like',        Icon: IconLike },
  { type: 'funny',       Icon: IconFunny },
  { type: 'helpful',     Icon: IconInsight },
  { type: 'interesting', Icon: IconStar },
];

function ProgressBar({ active, past, progress }: {
  active: boolean;
  past: boolean;
  progress: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const pct = active ? progress.value : past ? 1 : 0;
    return { width: `${pct * 100}%` };
  });
  return (
    <View style={styles.svTrack}>
      <Animated.View style={[styles.svFill, style]} />
    </View>
  );
}

interface StoryViewerProps {
  stories: Story[];
  onClose: () => void;
  onReact: (storyId: number, reaction: ReactionType) => void;
  /** When set (author is a friend), shows the reply bar that DMs the comment. */
  replyTo?: { id: number; username: string } | null;
}

function StoryViewer({ stories, onClose, onReact, replyTo }: StoryViewerProps) {
  const { top, bottom } = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const progress = useSharedValue(0);
  const [replyText, setReplyText] = useState('');
  const [replyFocused, setReplyFocused] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [replySent, setReplySent] = useState(false);

  function goTo(i: number) {
    if (i >= stories.length) { onClose(); return; }
    if (i < 0) return;
    indexRef.current = i;
    setIndex(i);
  }

  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  // Auto-advance, paused while the reply input is focused.
  useEffect(() => {
    if (replyFocused) {
      cancelAnimation(progress);
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: STORY_DURATION_MS });
    const timer = setTimeout(() => goToRef.current(indexRef.current + 1), STORY_DURATION_MS);
    return () => {
      cancelAnimation(progress);
      clearTimeout(timer);
    };
  }, [index, replyFocused]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -40) goToRef.current(indexRef.current + 1);
        else if (gs.dx > 40) goToRef.current(indexRef.current - 1);
      },
    })
  ).current;

  const story = stories[index];
  if (!story) return null;

  console.log('[Story viewer] current story:', story.content, 'photo:', story.image);
  console.log('[Story] full object:', JSON.stringify(story));

  const hasPhoto = !!story.image;
  const hasText  = !!(story.text || story.content);

  async function sendReply() {
    const trimmed = replyText.trim();
    if (!trimmed || !replyTo || sendingReply) return;
    setSendingReply(true);
    try {
      const context = story.content ?? story.text;
      const content = encodeStoryReply({
        image: story.image,
        excerpt: context ? `${context.slice(0, 80)}${context.length > 80 ? '…' : ''}` : undefined,
        comment: trimmed,
      });
      await api.post(`/api/friends/messages/${replyTo.id}/`, { content });
      setReplyText('');
      Keyboard.dismiss();
      setReplySent(true);
      setTimeout(() => setReplySent(false), 1600);
    } catch (e: any) {
      console.log('[Story reply] error:', e?.response?.status, JSON.stringify(e?.response?.data));
      Alert.alert('Could not send', 'Please try again.');
    } finally {
      setSendingReply(false);
    }
  }

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.svContainer} {...panResponder.panHandlers}>
        {/* Background — photo fills entire screen or solid dark for text-only */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
        {hasPhoto && (
          <Image source={{ uri: story.image! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}


        {/* Nav tap zones — cover full screen, interactive elements rendered after override them */}
        <TouchableOpacity style={styles.svNavLeft}  activeOpacity={1} onPress={() => goTo(index - 1)} />
        <TouchableOpacity style={styles.svNavRight} activeOpacity={1} onPress={() => goTo(index + 1)} />

        {/* Progress bars */}
        <View style={[styles.svProgressRow, { top: top + 8 }]} pointerEvents="none">
          {stories.map((_, i) => (
            <ProgressBar key={i} active={i === index} past={i < index} progress={progress} />
          ))}
        </View>

        {/* Header: avatar + username + time + close */}
        <View style={[styles.svHeader, { top: top + 22 }]}>
          <Avatar uri={story.author.profile_picture} name={story.author.username} size="xs" />
          <View style={styles.svAuthorInfo}>
            <Text style={styles.svAuthorName}>{story.author.username}</Text>
            <Text style={styles.svTimeAgo}>{timeAgo(story.created_at)}</Text>
          </View>
          <Text style={styles.svTimeLeft}>{timeLeft(story.expires_at)}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.svCloseBtn}>
            <IconClose size={18} color={colors.t1} />
          </TouchableOpacity>
        </View>

        {/* Story text above reactions */}
        {hasText && (
          <View style={[styles.svTextBlock, { bottom: bottom + (replyTo ? 152 : 96) }]} pointerEvents="none">
            {story.place_name ? (
              <View style={styles.svPlaceRow}>
                <IconPin size={12} color={colors.t2} />
                <Text style={styles.svPlaceName} numberOfLines={1}>{story.place_name}</Text>
              </View>
            ) : null}
            <Text style={styles.svTextLarge}>{story.content ?? story.text}</Text>
          </View>
        )}

        {/* Reply to a friend's story — the comment lands in your chat */}
        {replyTo && (
          <View style={[styles.svReplyRow, { bottom: bottom + 90 }]}>
            <TextInput
              style={styles.svReplyInput}
              value={replyText}
              onChangeText={setReplyText}
              placeholder={`Reply to ${replyTo.username}…`}
              placeholderTextColor={colors.t3}
              maxLength={500}
              onFocus={() => setReplyFocused(true)}
              onBlur={() => setReplyFocused(false)}
              onSubmitEditing={sendReply}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={[styles.svReplySend, replyText.trim().length > 0 && styles.svReplySendActive]}
              onPress={sendReply}
              disabled={replyText.trim().length === 0 || sendingReply}
              activeOpacity={0.8}
            >
              {sendingReply ? (
                <ActivityIndicator size="small" color={colors.bg} />
              ) : (
                <IconChevron size={16} color={replyText.trim() ? colors.bg : colors.t3} />
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Sent confirmation */}
        {replySent && replyTo && (
          <View style={[styles.svSentToast, { bottom: bottom + 150 }]} pointerEvents="none">
            <Text style={styles.svSentToastText}>Sent to @{replyTo.username}</Text>
          </View>
        )}

        {/* Reactions */}
        <View style={[styles.svReactions, { bottom: bottom + 20 }]}>
          {REACTIONS.map(({ type, Icon }) => {
            const count = story.reactions?.[type] ?? 0;
            const isActive = story.user_reaction === type;
            return (
              <Pressable
                key={type}
                style={[styles.svReactionBtn, isActive && styles.svReactionBtnActive]}
                onPress={() => onReact(story.id, type)}
              >
                <Icon size={20} color={isActive ? colors.teal : colors.t2} />
                {count > 0 && (
                  <Text style={[styles.svReactionCount, isActive && styles.svReactionCountActive]}>
                    {count}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
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

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow camera access to take a photo.');
      return;
    }
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
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <IconClose size={20} color={colors.t3} />
            </TouchableOpacity>
          </View>
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
            <TouchableOpacity style={styles.photoPickBtn} onPress={takePhoto} activeOpacity={0.75}>
              <IconCamera size={20} color={colors.t2} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoPickBtn} onPress={pickPhoto} activeOpacity={0.75}>
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
  const { top: topInset } = useSafeAreaInsets();
  const [coords, setCoords]           = useState<{ latitude: number; longitude: number } | null>(null);
  const [nearby, setNearby]           = useState<NearbyUser[]>([]);
  const [permError, setPermError]     = useState('');
  const [selectedUser, setSelectedUser] = useState<NearbyUser | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [friendIds, setFriendIds]     = useState<Set<number>>(new Set());
  const [connectionIds, setConnectionIds] = useState<Set<number>>(new Set());
  const [selfProfile, setSelfProfile] = useState<{ username: string; profile_picture?: string } | null>(null);
  const [activeZone, setActiveZone]   = useState<{ username: string; audioUrl?: string; isFriend: boolean; isSelf: boolean } | null>(null);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [selfZone, setSelfZone]       = useState<SelfZone | null>(null);
  const [hiToast, setHiToast]           = useState(false);
  const [locationToast, setLocationToast] = useState(false);
  const [stories, setStories]           = useState<Story[]>([]);
  const [storyViewer, setStoryViewer]   = useState<{ stories: Story[] } | null>(null);
  const [createStoryCoord, setCreateStoryCoord] = useState<{ latitude: number; longitude: number } | null>(null);

  const coordsRef          = useRef(coords);
  const hiToastTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundRef           = useRef<Audio.Sound | null>(null);
  const currentUserIdRef   = useRef<number | null>(null);
  const playingUrlRef      = useRef<string | null>(null);
  const mutedZoneRef       = useRef<string | null>(null);
  coordsRef.current = coords;
  currentUserIdRef.current = currentUserId;

  const sheetY = useSharedValue(SHEET_H);

  // Stories are friends-only: the backend returns everyone nearby, so drop
  // anything not authored by the current user or one of their friends.
  const storiesByAuthor = useMemo(() => {
    const map = new Map<number, Story[]>();
    for (const story of stories) {
      const id = Number(story.author.id);
      if (id !== currentUserId && !friendIds.has(id)) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(story);
    }
    return map;
  }, [stories, currentUserId, friendIds]);

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

  // Feed the local notification feed: friends nearby (with distance) and
  // interest matches. The feed itself dedupes with a per-user cooldown.
  useEffect(() => {
    if (visibleNearby.length === 0) return;
    recordNearbySightings(
      visibleNearby.map((u) => ({
        id: Number(u.id),
        username: u.username,
        isFriend: friendIds.has(Number(u.id)),
        sharedInterests: u.shared_interests ?? [],
        distanceKm: u.distance_km ?? (u.distance != null ? u.distance / 1000 : undefined),
      })),
    );
  }, [visibleNearby, friendIds]);

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

  // Detect which zone the banner/audio should follow.
  // Priority: a friend's zone we're standing in → the owner's own active zone
  // → a non-friend zone (shown locked, never played). The owner's zone comes
  // from /api/users/zone/, not the nearby list, so the friends-only rule can
  // never lock the owner out of their own music.
  useEffect(() => {
    // The server nulls zone_audio_url for non-friends, so presence of a URL
    // can't be the "is there a zone here" test — zone_active/radius can.
    const insideZones = visibleNearby.filter((u) =>
      u.zone_active && (u.distance_km ?? Infinity) * 1000 < (u.zone_radius ?? 500),
    );
    console.log('[Zone] zones in range:', insideZones.map((u) => u.username),
      '| self zone active:', !!selfZone?.zone_active);
    const friendZone = insideZones.find((u) => friendIds.has(Number(u.id)) && u.zone_audio_url);
    const strangerZone = insideZones.find((u) => !friendIds.has(Number(u.id)));

    let next: { username: string; audioUrl?: string; isFriend: boolean; isSelf: boolean } | null = null;
    if (friendZone) {
      next = { username: friendZone.username, audioUrl: friendZone.zone_audio_url, isFriend: true, isSelf: false };
    } else if (selfZone?.zone_active && selfZone.zone_audio_url) {
      next = { username: selfProfile?.username ?? 'you', audioUrl: selfZone.zone_audio_url, isFriend: false, isSelf: true };
    } else if (strangerZone) {
      next = { username: strangerZone.username, audioUrl: undefined, isFriend: false, isSelf: false };
    }

    if (!next) {
      setActiveZone(null);
      mutedZoneRef.current = null;
      if (playingUrlRef.current) stopZone();
      return;
    }

    setActiveZone(next);
    if (mutedZoneRef.current && mutedZoneRef.current !== next.username) mutedZoneRef.current = null;

    // Stop stale audio when the zone (or its track) changed.
    if (playingUrlRef.current && playingUrlRef.current !== next.audioUrl) stopZone();

    // Autoplay only a friend's zone, and only when nothing is playing yet and
    // the user hasn't muted it — the nearby poll re-runs this effect every
    // 10s, and an unguarded playZone() here restarts the track each time.
    if (next.isFriend && next.audioUrl && !playingUrlRef.current && mutedZoneRef.current !== next.username) {
      const { audioUrl, username } = next;
      getPref('zoneAutoplay').then((autoplay) => {
        if (autoplay && !playingUrlRef.current) playZone(audioUrl, username);
      });
    }
  }, [visibleNearby, friendIds, selfZone, selfProfile]);

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

    // The zone endpoint answers with either {zone_active, zone_radius, ...}
    // or {active, custom_audio_url, ...} and may omit the radius — normalize
    // so the owner's circle renders regardless of which shape arrives.
    api.get<Record<string, any>>('/api/users/zone/')
      .then((r) => {
        const d = r.data ?? {};
        const normalized: SelfZone = {
          zone_active: Boolean(d.zone_active ?? d.active ?? false),
          zone_radius: Number(d.zone_radius) > 0 ? Number(d.zone_radius) : 500,
          zone_audio_url: d.zone_audio_url ?? d.custom_audio_url ?? undefined,
        };
        console.log('[Zone] self zone:', JSON.stringify(normalized));
        setSelfZone(normalized);
      })
      .catch((e: any) => console.log('[Zone] self zone fetch error:', e?.response?.status));

    fetchFriends();
  }, [fetchFriends]);

  useFocusEffect(useCallback(() => { loadSelf(); }, [loadSelf]));

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      console.log('[Map] step 2: location permission requested');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermError('Location permission is required to find nearby people.');
        return;
      }
      const isExpoGo = Constants.appOwnership === 'expo';
      if (!isExpoGo) {
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        console.log('[Location] background permission status:', bgStatus);
      }
      await startBackgroundLocationUpdates();
      const init = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      console.log('[Map] step 3: location received', init.coords.latitude, init.coords.longitude);
      setCoords({ latitude: init.coords.latitude, longitude: init.coords.longitude });
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        (loc) => setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude }),
      );
    })();

    return () => { sub?.remove(); };
  }, []);

  const tick = useCallback(async () => {
    const c = coordsRef.current;
    if (!c) return;

    // Without our own id the nearby list stays hidden (we couldn't filter
    // ourselves out of it), so keep retrying the identity fetch until it lands.
    if (currentUserIdRef.current === null) loadSelf();

    const [, nearbyResult] = await Promise.allSettled([
      api.patch('/api/proximity/location/', {
        latitude: parseFloat(c.latitude.toFixed(6)),
        longitude: parseFloat(c.longitude.toFixed(6)),
      }),
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

  const region: Region | undefined = coords
    ? { latitude: coords.latitude, longitude: coords.longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }
    : undefined;

  return (
    <View style={styles.container}>
      {permError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{permError}</Text>
        </View>
      ) : !coords ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} size="large" />
          <Text style={styles.loadingText}>Locating you…</Text>
        </View>
      ) : (
        <MapView
          onLayout={() => console.log('[Map] step 5: map rendering')}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          customMapStyle={DARK_MAP_STYLE}
          initialRegion={region}
          showsUserLocation={false}
          showsMyLocationButton={false}
          rotateEnabled={false}
          pitchEnabled={false}
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
              center={coords}
              radius={selfZone.zone_radius}
              fillColor="rgba(139,92,246,0.07)"
              strokeColor="rgba(139,92,246,0.35)"
              strokeWidth={1.5}
            />
          )}

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
                onPress={() => openSheet(user)}
              />
            ) : (
              <DotMarker
                key={user.id}
                coordinate={{ latitude: user.latitude, longitude: user.longitude }}
                color={color}
                onPress={() => openSheet(user)}
              />
            );
          })}

          {selfProfile ? (
            <AvatarMarker
              coordinate={coords}
              uri={selfProfile.profile_picture}
              username={selfProfile.username}
              ringColor={colors.purple}
              size={38}
              zIndex={10}
            />
          ) : (
            <Marker
              coordinate={coords}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={styles.selfRing}>
                <View style={styles.selfDot} />
              </View>
            </Marker>
          )}

          {Array.from(storiesByAuthor.entries()).map(([authorId, authorStories]) => {
            const first = authorStories[0];
            return (
              <Marker
                key={`story-author-${authorId}`}
                coordinate={{ latitude: first.latitude, longitude: first.longitude }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
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
      />

      {/* Zone banner */}
      {activeZone && (
        <ZoneBanner
          username={activeZone.username}
          isSelf={activeZone.isSelf}
          canListen={activeZone.isFriend || activeZone.isSelf}
          isPlaying={isPlaying}
          onTap={() => {
            if (!activeZone.audioUrl) return;
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

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontFamily: fonts.body, color: colors.t3, fontSize: 14 },
  errorText: { fontFamily: fonts.body, color: colors.red, fontSize: 15, textAlign: 'center', padding: 24 },

  // ── Non-friend marker: small relationship-colored dot ──
  userDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.bg,
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
    fontSize: 12,
    color: colors.bg,
  },

  // ── Self marker: purple core, bg gap, thin purple ring — no glow ──
  selfRing: {
    width: 25,
    height: 25,
    borderRadius: 12.5,
    borderWidth: 1.5,
    borderColor: colors.purple,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.purple,
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
  zoneBannerLocked: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.t2,
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

  // ─── Full-screen story viewer (Instagram-style) ───
  svContainer: { flex: 1, backgroundColor: '#000' },
  svNavLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '30%',
  },
  svNavRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '30%',
  },
  svProgressRow: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  svTrack: {
    flex: 1,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  svFill: {
    height: '100%',
    backgroundColor: colors.t1,
    borderRadius: 1,
  },
  svHeader: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  svAuthorInfo: { flex: 1, marginLeft: 8 },
  svAuthorName: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 13,
    color: colors.t1,
  },
  svTimeAgo: { fontFamily: fonts.body, fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  svTimeLeft: { fontFamily: fonts.body, fontSize: 11, color: 'rgba(255,255,255,0.7)', marginRight: 10 },
  svCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  svTextBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 20,
  },
  svTextLarge: {
    fontFamily: fonts.body,
    fontSize: 18,
    fontWeight: '500',
    color: colors.t1,
    lineHeight: 26,
  },
  svPlaceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  svPlaceName: { fontFamily: fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  svReplyRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: 'rgba(10,10,11,0.82)',
  },
  svReplyInput: {
    flex: 1,
    height: 40,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 16,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t1,
  },
  svReplySend: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  svReplySendActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
  svSentToast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  svSentToastText: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: colors.t1,
  },
  svReactions: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 12,
  },
  svReactionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.m,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  svReactionBtnActive: {
    backgroundColor: colors.tealTint,
    borderColor: colors.tealLine,
  },
  svReactionCount: { fontFamily: fonts.body, color: colors.t3, fontSize: 13, fontWeight: '500' },
  svReactionCountActive: { color: colors.teal },

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
