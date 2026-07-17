import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
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
const COLOR_FRIEND    = '#3b82f6';
const COLOR_CONNECTED = '#f97316';
const COLOR_STRANGER  = '#ffffff';
const COLOR_SELF      = '#8b5cf6';
const COLOR_TEAL      = '#00b4a6';

const REL_LABEL: Record<Relationship, string> = {
  stranger:  'Nearby',
  hi_sent:   'Hi Sent',
  connected: 'Connected',
  friend:    'Friend',
};

const POLL_MS       = 10_000;
const STORY_POLL_MS = 10_000;
const STORY_SHEET_H = 480;

const DARK_MAP_STYLE = [
  { elementType: 'geometry',                    stylers: [{ color: '#0a0a0a' }] },
  { elementType: 'labels.text.fill',            stylers: [{ color: '#00b4a6' }] },
  { elementType: 'labels.text.stroke',          stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'road', elementType: 'geometry',              stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'road', elementType: 'geometry.stroke',       stylers: [{ color: '#212121' }] },
  { featureType: 'road', elementType: 'labels.text.fill',      stylers: [{ color: '#00b4a6' }] },
  { featureType: 'road.highway', elementType: 'geometry',      stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'water', elementType: 'geometry',             stylers: [{ color: '#050505' }] },
  { featureType: 'water', elementType: 'labels.text.fill',     stylers: [{ color: '#00b4a6' }] },
  { featureType: 'poi', elementType: 'geometry',               stylers: [{ color: '#0d0d0d' }] },
  { featureType: 'poi', elementType: 'labels.text.fill',       stylers: [{ color: '#00b4a6' }] },
  { featureType: 'transit', elementType: 'geometry',           stylers: [{ color: '#121212' }] },
  { featureType: 'administrative', elementType: 'geometry',         stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#00b4a6' }] },
];
const SHEET_H   = 400;
const SPRING_CFG = { damping: 22, stiffness: 220, mass: 0.9 };

const AVATAR_COLORS = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#be185d', '#0284c7'];

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
        borderWidth: 2.5,
        borderColor: '#ffffff',
        shadowColor: color,
        shadowRadius: 8,
        shadowOpacity: 0.95,
        shadowOffset: { width: 0, height: 0 },
        elevation: 8,
      }}
    />
  );
}

function StoryBubble({ story }: { story: Story }) {
  const body = story.content ?? story.text ?? '';
  const preview = body.length > 20 ? body.slice(0, 20) + '…' : body;
  const avatarBg = avatarBgColor(story.author.username);

  const reactions = story.reactions ?? {};
  const topReaction = REACTIONS.reduce<{ type: ReactionType; emoji: string; count: number } | null>(
    (best, { type, emoji }) => {
      const count = reactions[type] ?? 0;
      return count > 0 && (!best || count > best.count) ? { type, emoji, count } : best;
    },
    null,
  );

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={[styles.storyBubbleAvatar, { backgroundColor: avatarBg }]}>
        {story.author.profile_picture ? (
          <Image source={{ uri: story.author.profile_picture }} style={styles.storyBubbleAvatarImg} />
        ) : (
          <Text style={styles.storyBubbleAvatarText}>{story.author.username.charAt(0).toUpperCase()}</Text>
        )}
      </View>
      <View style={styles.storyBubble}>
        <Text style={styles.storyBubbleText} numberOfLines={1}>{preview}</Text>
      </View>
      <View style={styles.storyBubbleTail} />
      {topReaction && (
        <View style={styles.storyBubbleReactionPill}>
          <Text style={styles.storyBubbleReactionText}>{topReaction.emoji} {topReaction.count}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Top Bar ─────────────────────────────────────────────────────────────────
function TopBar({ nearby, onPrivacy, onSearch }: { nearby: number; onPrivacy: () => void; onSearch: () => void }) {
  const { top } = useSafeAreaInsets();
  return (
    <View style={[styles.topBar, { paddingTop: top + 10 }]}>
      <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
      {/* AURA logo */}
      <View style={styles.topLogo}>
        <Text style={styles.topLogoText}>AURA</Text>
        <View style={styles.topLogoDot} />
      </View>

      {/* Nearby badge */}
      <View style={styles.nearbyBadge}>
        <View style={styles.nearbyBadgeInner}>
          <Text style={styles.nearbyBadgeText}>👥 {nearby} nearby</Text>
        </View>
      </View>

      {/* Search icon */}
      <TouchableOpacity onPress={onSearch} activeOpacity={0.7} style={styles.privacyBtn} hitSlop={10}>
        <Ionicons name="search-outline" size={22} color={COLOR_TEAL} />
      </TouchableOpacity>

      {/* Privacy icon */}
      <TouchableOpacity onPress={onPrivacy} activeOpacity={0.7} style={styles.privacyBtn} hitSlop={10}>
        <Ionicons name="shield-checkmark-outline" size={22} color={COLOR_TEAL} />
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
      entering={FadeIn.duration(350)}
      exiting={FadeOut.duration(250)}
      style={[styles.zoneBanner, { top: top + 64 }]}
    >
      <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      <TouchableOpacity
        style={styles.zoneBannerInner}
        onPress={onTap}
        activeOpacity={0.75}
      >
        <Text style={styles.zoneBannerText}>
          {isPlaying
            ? `🎵 Playing @${username}'s zone`
            : `🎵 You're in @${username}'s zone · Tap to listen`}
        </Text>
      </TouchableOpacity>
      {isPlaying && (
        <TouchableOpacity onPress={onMute} hitSlop={12} style={styles.zoneMuteBtn}>
          <Ionicons name="volume-mute" size={18} color={COLOR_TEAL} />
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

// ─── Story Sheet ──────────────────────────────────────────────────────────────
type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const REACTIONS: { type: ReactionType; icon: IoniconsName }[] = [
  { type: 'like',        icon: 'heart-outline' },
  { type: 'funny',       icon: 'happy-outline' },
  { type: 'helpful',     icon: 'bulb-outline' },
  { type: 'interesting', icon: 'star-outline' },
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
          <Ionicons name="close" size={16} color={colors.t3} />
        </Pressable>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.storyScroll}>
          {/* Header row */}
          <View style={styles.storyAuthorRow}>
            <Avatar uri={story.author.profile_picture} name={story.author.username} size="sm" />
            <View style={styles.storyAuthorInfo}>
              <Text style={styles.storyAuthorName}>{story.author.username}</Text>
              {story.place_name ? (
                <Text style={styles.storyMeta} numberOfLines={1}>📍 {story.place_name}</Text>
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
            {REACTIONS.map(({ type, icon }) => {
              const count = story.reactions?.[type] ?? 0;
              const isActive = story.user_reaction === type;
              return (
                <Pressable
                  key={type}
                  style={[styles.reactionBtn, isActive && styles.reactionBtnActive]}
                  onPress={() => onReact(type)}
                >
                  <Ionicons
                    name={isActive ? (icon.replace('-outline', '') as IoniconsName) : icon}
                    size={20}
                    color={isActive ? colors.teal : colors.t3}
                  />
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
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.sheetHandle} />
          <View style={styles.createModalHeader}>
            <Text style={styles.createModalTitle}>Drop a Story</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color="#666" />
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
                <Ionicons name="close-circle" size={22} color="#ff4d4d" />
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.createModalActions}>
            <TouchableOpacity style={styles.photoPickBtn} onPress={pickPhoto} activeOpacity={0.75}>
              <Ionicons name="image-outline" size={20} color={COLOR_TEAL} />
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
          <Ionicons name="close" size={16} color={colors.t3} />
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
          <ActivityIndicator color={COLOR_TEAL} size="large" />
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
                  fillColor="rgba(0,180,166,0.2)"
                  strokeColor="rgba(0,180,166,0.35)"
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
              <UserDot color={COLOR_SELF} size={18} />
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
        <View style={styles.hiToast} pointerEvents="none">
          <Text style={styles.hiToastText}>Hi sent! 👋</Text>
        </View>
      )}

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  map: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: '#555', fontSize: 14 },
  errorText: { color: '#ff4d4d', fontSize: 15, textAlign: 'center', padding: 24 },

  // ── Self marker ──
  selfRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#8b5cf640',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Top bar ──
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    zIndex: 100,
  },
  topLogo: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topLogoText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 3,
  },
  topLogoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLOR_TEAL,
  },
  nearbyBadge: {
    flex: 1,
    alignItems: 'center',
  },
  nearbyBadgeInner: {
    backgroundColor: 'rgba(0, 180, 166, 0.15)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(0, 180, 166, 0.3)',
  },
  nearbyBadgeText: {
    color: COLOR_TEAL,
    fontSize: 13,
    fontWeight: '600',
  },
  privacyBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,180,166,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,180,166,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Zone banner ──
  zoneBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,180,166,0.25)',
    zIndex: 90,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
  zoneBannerInner: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  zoneBannerText: {
    color: COLOR_TEAL,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  zoneMuteBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,180,166,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,180,166,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
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

  // ─── Story bubble marker ───
  storyBubbleAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#FFD700',
    marginBottom: -8,
    zIndex: 1,
  },
  storyBubbleAvatarImg: { width: 26, height: 26, borderRadius: 13 },
  storyBubbleAvatarText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  storyBubble: {
    backgroundColor: '#FFD700',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
    maxWidth: 140,
    shadowColor: '#000',
    shadowRadius: 6,
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  storyBubbleText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '600',
  },
  storyBubbleTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFD700',
    marginTop: -1,
  },
  storyBubbleReactionPill: {
    marginTop: 4,
    backgroundColor: '#FFD700',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    shadowColor: '#000',
    shadowRadius: 3,
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  storyBubbleReactionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#000',
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
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: `${COLOR_TEAL}30`,
    paddingHorizontal: 20,
    paddingTop: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(8,18,18,0.98)',
  },
  createModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
    marginTop: 6,
  },
  createModalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  storyInput: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 4,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: `${COLOR_TEAL}35`,
    borderRadius: 12,
  },
  charCount: {
    color: '#444',
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
    borderRadius: 14,
  },
  removePhotoBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
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
    borderRadius: 14,
    backgroundColor: 'rgba(0,180,166,0.1)',
    borderWidth: 1,
    borderColor: `${COLOR_TEAL}30`,
  },
  photoPickText: { color: COLOR_TEAL, fontSize: 14, fontWeight: '600' },
  postBtn: {
    flex: 1,
    backgroundColor: COLOR_TEAL,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  postBtnText: { color: '#0a0a0a', fontSize: 15, fontWeight: '700' },

  // ── Hi toast ──
  hiToast: {
    position: 'absolute',
    alignSelf: 'center',
    top: '46%',
    backgroundColor: '#071a19',
    borderWidth: 1,
    borderColor: `${COLOR_TEAL}55`,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 11,
    zIndex: 200,
  },
  hiToastText: { color: COLOR_TEAL, fontSize: 15, fontWeight: '600' },
});
