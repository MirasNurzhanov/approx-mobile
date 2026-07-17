import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';
import Animated, {
  FadeIn,
  FadeOut,
  type SharedValue,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
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
import * as ImagePicker from 'expo-image-picker';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Speedometer } from '@/components/Speedometer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import {
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
import { startBackgroundLocationUpdates } from '@/services/backgroundLocation';
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
  photo?: string;
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

const POLL_MS       = 10_000;
const STORY_POLL_MS = 10_000;
const STORY_SHEET_H = 480;

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

function UserDot({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: 2,
        borderColor: colors.bg,
      }}
    />
  );
}

function StoryBubble({ story }: { story: Story }) {
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
        {story.author.profile_picture ? (
          <Image source={{ uri: story.author.profile_picture }} style={styles.storyCardAvatarImg} />
        ) : (
          <View style={[styles.storyCardAvatar, { backgroundColor: avatarBg }]}>
            <Text style={styles.storyCardAvatarText}>{story.author.username.charAt(0).toUpperCase()}</Text>
          </View>
        )}
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
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={[styles.zoneBanner, { top: top + 62 }]}
    >
      <IconSound size={20} color={colors.teal} />
      <Text style={styles.zoneBannerText} numberOfLines={1}>
        {isPlaying ? 'Playing ' : "You're in "}
        <Text style={styles.zoneBannerUser}>@{username}</Text>
        {"'s zone"}
      </Text>
      {isPlaying ? (
        <TouchableOpacity onPress={onMute} hitSlop={12}>
          <IconMute size={20} color={colors.teal} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={onTap} hitSlop={12}>
          <Text style={styles.zoneBannerAction}>Listen</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

// ─── Story Sheet ──────────────────────────────────────────────────────────────
const REACTIONS: { type: ReactionType; Icon: IconComponent }[] = [
  { type: 'like',        Icon: IconLike },
  { type: 'funny',       Icon: IconFunny },
  { type: 'helpful',     Icon: IconInsight },
  { type: 'interesting', Icon: IconStar },
];

interface StorySheetProps {
  story: Story;
  storySheetY: SharedValue<number>;
  onDismiss: () => void;
  onReact: (reaction: ReactionType) => void;
}

function StorySheet({ story, storySheetY, onDismiss, onReact }: StorySheetProps) {
  const { bottom } = useSafeAreaInsets();
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: storySheetY.value }],
  }));

  return (
    <>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onDismiss} />
      <Animated.View style={[styles.storySheet, { paddingBottom: bottom + 20 }, animStyle]}>
        <View style={styles.sheetHandle} />

        <Pressable onPress={onDismiss} hitSlop={14} style={styles.closeBtn}>
          <IconClose size={16} color={colors.t3} />
        </Pressable>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.storyScroll}>
          {/* Header row */}
          <View style={styles.storyAuthorRow}>
            <Avatar uri={story.author.profile_picture} name={story.author.username} size="sm" />
            <View style={styles.storyAuthorInfo}>
              <Text style={styles.storyAuthorName}>{story.author.username}</Text>
              {story.place_name ? (
                <View style={styles.storyMetaRow}>
                  <IconPin size={13} color={colors.t3} />
                  <Text style={styles.storyMeta} numberOfLines={1}>{story.place_name}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.storyExpiryBadge}>
              <Text style={styles.storyExpiryText}>{timeLeft(story.expires_at)}</Text>
            </View>
          </View>

          {/* Content */}
          <Text style={styles.storyText}>{story.content ?? story.text}</Text>

          {story.photo ? (
            <Image source={{ uri: story.photo }} style={styles.storyPhoto} resizeMode="cover" />
          ) : null}

          {/* Divider */}
          <View style={styles.storyDivider} />

          {/* Reaction row */}
          <View style={styles.reactionsRow}>
            {REACTIONS.map(({ type, Icon }) => {
              const count = story.reactions?.[type] ?? 0;
              const isActive = story.user_reaction === type;
              return (
                <Pressable
                  key={type}
                  style={[styles.reactionBtn, isActive && styles.reactionBtnActive]}
                  onPress={() => onReact(type)}
                >
                  <Icon size={20} color={isActive ? colors.teal : colors.t3} />
                  {count > 0 && (
                    <Text style={[styles.reactionCount, isActive && styles.reactionCountActive]}>
                      {count}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </Animated.View>
    </>
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
            <TouchableOpacity style={styles.photoPickBtn} onPress={pickPhoto} activeOpacity={0.75}>
              <IconImage size={20} color={colors.t2} />
              <Text style={styles.photoPickText}>Photo</Text>
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

        <View style={styles.actions}>
          <View style={styles.actionBtn}>
            {isStranger && (
              <Button label="Send Hi" variant="primary" size="md" fullWidth onPress={sendHi} />
            )}
            {isHiSent && (
              <Button label="Hi Sent ✓" variant="secondary" size="md" fullWidth disabled />
            )}
            {(isFriend || isConnected) && (
              <Button label="Message" variant="primary" size="md" fullWidth onPress={goToMessages} />
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
  const [friendsReady, setFriendsReady] = useState(false);
  const [activeZone, setActiveZone]   = useState<{ username: string; audioUrl?: string } | null>(null);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [selfZone, setSelfZone]       = useState<SelfZone | null>(null);
  const [hiToast, setHiToast]           = useState(false);
  const [stories, setStories]           = useState<Story[]>([]);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createStoryCoord, setCreateStoryCoord] = useState<{ latitude: number; longitude: number } | null>(null);

  const coordsRef      = useRef(coords);
  const hiToastTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundRef       = useRef<Audio.Sound | null>(null);
  coordsRef.current = coords;

  const sheetY      = useSharedValue(SHEET_H);
  const storySheetY = useSharedValue(STORY_SHEET_H);

  const fetchFriends = useCallback(async () => {
    try {
      const r = await api.get<{ friends: { id: number }[]; connections: { id: number }[] }>('/api/friends/list/');
      setFriendIds(new Set(r.data.friends.map((u) => Number(u.id))));
      setConnectionIds(new Set(r.data.connections.map((u) => Number(u.id))));
    } catch {}
  }, []);

  async function stopZone() {
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

  // Detect when current user enters or leaves a zone
  useEffect(() => {
    const nearbyUsers = nearby.filter((u) => currentUserId === null || Number(u.id) !== currentUserId);
    console.log('[Zone] checking nearby:', nearbyUsers.map((u) => ({
      username: u.username,
      zone_active: u.zone_active,
      zone_audio_url: u.zone_audio_url,
      distance_km: u.distance_km,
      zone_radius: u.zone_radius,
    })));
    console.log('[Zone] active zones check:', nearbyUsers
      .filter(u => u.zone_active)
      .map(u => ({
        username: u.username,
        audio: u.zone_audio_url,
        distance_m: ((u.distance_km ?? 0) * 1000).toFixed(0),
        radius: u.zone_radius,
        inZone: (u.distance_km ?? Infinity) * 1000 < (u.zone_radius ?? 500),
      })));
    const entered = nearbyUsers.find((u) =>
      u.zone_active && u.zone_audio_url && (u.distance_km ?? Infinity) * 1000 < (u.zone_radius ?? 500),
    );
    if (entered) {
      setActiveZone({ username: entered.username, audioUrl: entered.zone_audio_url });
      playZone(entered.zone_audio_url!, entered.username);
    } else {
      setActiveZone(null);
      stopZone();
    }
  }, [nearby, currentUserId]);

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

  function openStorySheet(story: Story) {
    sheetY.value = SHEET_H;
    setSelectedUser(null);
    setSelectedStory(story);
    storySheetY.value = withSpring(0, SPRING_CFG);
  }

  function closeStorySheet() {
    storySheetY.value = withSpring(STORY_SHEET_H, SPRING_CFG, (done) => {
      if (done) runOnJS(setSelectedStory)(null);
    });
  }

  async function reactToStory(storyId: number, reaction: ReactionType) {
    try {
      const response = await api.post(`/api/stories/${storyId}/react/`, { reaction: reaction });
      console.log('[Reaction] success:', response.data);
      console.log('[Reaction] response data:', JSON.stringify(response.data));
      const applyReaction = <T extends Story>(s: T): T => {
        if (s.id !== storyId) return s;
        const wasActive = s.user_reaction === reaction;
        const updated = { ...s.reactions };
        if (s.user_reaction) updated[s.user_reaction] = Math.max(0, updated[s.user_reaction] - 1);
        if (!wasActive) updated[reaction] = (updated[reaction] ?? 0) + 1;
        return { ...s, reactions: updated, user_reaction: wasActive ? null : reaction };
      };
      setSelectedStory((prev) => prev ? applyReaction(prev) : prev);
      setStories((prev) => prev.map(applyReaction));
      console.log('[Reaction] story after update:', JSON.stringify(selectedStory));
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
      formData.append('photo', { uri: photoUri, name: 'photo.jpg', type: 'image/jpeg' } as any);
    }
    try {
      const response = await api.post('/api/stories/', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      console.log('[Story] success:', response.data);
      await fetchStories();
    } catch (error: any) {
      console.log('[Story] error:', error.response?.status, JSON.stringify(error.response?.data));
      throw error;
    }
  }

  useEffect(() => {
    console.log('[Map] step 4: first API calls made');
    api.get<{ id: number; username: string }>('/api/users/me/')
      .then((r) => setCurrentUserId(r.data.id))
      .catch(() => {});

    api.get<SelfZone>('/api/users/zone/')
      .then((r) => setSelfZone(r.data))
      .catch(() => {});

    fetchFriends().finally(() => setFriendsReady(true));
  }, []);

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
  }, [fetchFriends]);

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

  // Keep the open story sheet in sync with the latest stories fetch
  useEffect(() => {
    if (!selectedStory) return;
    const fresh = stories.find((s) => s.id === selectedStory.id);
    if (fresh) setSelectedStory(fresh);
  }, [stories]);

  function openSheet(user: NearbyUser) {
    storySheetY.value = STORY_SHEET_H;
    setSelectedStory(null);
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

  const visibleNearby = nearby.filter((u) => currentUserId === null || Number(u.id) !== currentUserId);

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
          onLongPress={(e) => setCreateStoryCoord(e.nativeEvent.coordinate)}
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
            const color = friendIds.has(uid) ? COLOR_FRIEND : connectionIds.has(uid) ? COLOR_CONNECTED : COLOR_STRANGER;
            return (
              <Marker
                key={user.id}
                coordinate={{ latitude: user.latitude, longitude: user.longitude }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={!friendsReady}
                onPress={() => openSheet(user)}
              >
                <UserDot color={color} />
              </Marker>
            );
          })}

          <Marker
            coordinate={coords}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <View style={styles.selfRing}>
              <View style={styles.selfDot} />
            </View>
          </Marker>

          {stories.map((story) => (
            <Marker
              key={`story-${story.id}`}
              coordinate={{ latitude: story.latitude, longitude: story.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={false}
              onPress={() => openStorySheet(story)}
            >
              <StoryBubble story={story} />
            </Marker>
          ))}
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
          isPlaying={isPlaying}
          onTap={() => activeZone.audioUrl && playZone(activeZone.audioUrl, activeZone.username)}
          onMute={stopZone}
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

      {/* Story detail sheet */}
      {selectedStory && (
        <StorySheet
          story={selectedStory}
          storySheetY={storySheetY}
          onDismiss={closeStorySheet}
          onReact={(reaction) => reactToStory(selectedStory.id, reaction)}
        />
      )}

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

  // ─── Story marker: surface card + tail + reaction pill (no gold, no shadows) ───
  storyCard: {
    padding: 5,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
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

  // ─── Story sheet ───
  storySheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: STORY_SHEET_H,
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
  storyScroll: { paddingBottom: 8 },
  storyAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    marginTop: 4,
  },
  storyAuthorInfo: { flex: 1, gap: 2 },
  storyAuthorName: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 15,
    color: colors.t1,
  },
  storyMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  storyMeta: { fontFamily: fonts.body, color: colors.t3, fontSize: 12 },
  storyExpiryBadge: {
    backgroundColor: colors.surface2,
    borderRadius: radius.s,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  storyExpiryText: { fontFamily: fonts.body, color: colors.t3, fontSize: 11, fontWeight: '500' },
  storyText: {
    fontFamily: fonts.body,
    color: colors.t1,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  storyPhoto: {
    width: '100%',
    height: 200,
    borderRadius: radius.m,
    marginBottom: 16,
  },
  storyDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  reactionsRow: { flexDirection: 'row', gap: 8 },
  reactionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radius.m,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reactionBtnActive: {
    backgroundColor: colors.tealTint,
    borderColor: colors.tealLine,
  },
  reactionCount: { fontFamily: fonts.body, color: colors.t3, fontSize: 13, fontWeight: '500' },
  reactionCountActive: { color: colors.teal },

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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.m,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoPickText: { fontFamily: fonts.body, color: colors.t1, fontSize: 14, fontWeight: '600' },
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
