import * as Location from 'expo-location';
import { Audio } from 'expo-av';
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
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Circle, Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Speedometer } from '@/components/Speedometer';
import { api } from '@/services/api';
import { registerNearbyRefresh } from '@/services/nearbyRefresh';

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

const POLL_MS   = 10_000;
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
  const dist = fmtDistance(user.distance);

  const rel         = user.relationship ?? 'stranger';
  const isFriend    = rel === 'friend';
  const isConnected = rel === 'connected';
  const isHiSent    = rel === 'hi_sent';
  const isStranger  = rel === 'stranger';

  const glowColor     = isFriend ? COLOR_FRIEND : isConnected ? COLOR_CONNECTED : COLOR_TEAL;
  const relLabel      = REL_LABEL[rel] ?? 'Nearby';
  const relBadgeColor = isFriend ? '#1e3a5f' : isConnected ? '#3d1f0a' : '#0d1f1e';
  const relTextColor  = isFriend ? COLOR_FRIEND : isConnected ? COLOR_CONNECTED : COLOR_TEAL;
  const avatarBg      = avatarBgColor(user.username);

  function sendHi() {
    const url = '/api/friends/hi/';
    console.log('[Hi] sending to URL:', url, 'body:', { receiver_id: user.id });
    api.post(url, { receiver_id: user.id })
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
        {/* Glassmorphism background */}
        <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill, styles.sheetBlur]} />

        <View style={styles.sheetHandle} />

        {/* Dismiss button — absolute so it doesn't affect hero centering */}
        <Pressable onPress={onDismiss} hitSlop={14} style={styles.closeBtn}>
          <Ionicons name="close" size={16} color="#666" />
        </Pressable>

        {/* Hero: avatar centered, name + badge below */}
        <View style={styles.sheetHero}>
          <View style={[styles.sheetAvatarGlow, { shadowColor: glowColor }]}>
            <View style={[styles.sheetAvatarRing, { borderColor: glowColor }]}>
              <View style={[styles.sheetAvatar, { backgroundColor: avatarBg }]}>
                {user.profile_picture ? (
                  <Image source={{ uri: user.profile_picture }} style={styles.sheetAvatarImage} />
                ) : (
                  <Text style={styles.sheetAvatarText}>
                    {user.username.charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
            </View>
          </View>

          <Text style={styles.sheetName}>{user.username}</Text>

          <View style={styles.sheetMetaRow}>
            <View style={[styles.relBadge, { backgroundColor: relBadgeColor }]}>
              <Text style={[styles.relBadgeText, { color: relTextColor }]}>{relLabel}</Text>
            </View>
            {dist && <Text style={styles.sheetDist}>{dist}</Text>}
          </View>
        </View>

        {/* Shared interests */}
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

        {/* Actions */}
        <View style={styles.actions}>
          {isStranger && (
            <TouchableOpacity style={styles.btnPrimary} activeOpacity={0.8} onPress={sendHi}>
              <Text style={styles.btnPrimaryText}>👋  Send Hi</Text>
            </TouchableOpacity>
          )}
          {isHiSent && (
            <TouchableOpacity style={[styles.btnPrimary, styles.btnSent]} activeOpacity={1} disabled>
              <Text style={styles.btnSentText}>Hi Sent ✓</Text>
            </TouchableOpacity>
          )}
          {(isFriend || isConnected) && (
            <TouchableOpacity style={styles.btnPrimary} activeOpacity={0.8} onPress={goToMessages}>
              <Text style={styles.btnPrimaryText}>💬  Message</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.btnSecondary} activeOpacity={0.8} onPress={goToProfile}>
            <Text style={styles.btnSecondaryText}>👤  View Profile</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function MapScreen() {
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
  const [hiToast, setHiToast]         = useState(false);

  const coordsRef      = useRef(coords);
  const hiToastTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundRef       = useRef<Audio.Sound | null>(null);
  coordsRef.current = coords;

  const sheetY = useSharedValue(SHEET_H);

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

  async function playZone(url: string) {
    await stopZone();
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true, isLooping: true },
      );
      soundRef.current = sound;
      setIsPlaying(true);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) setIsPlaying(false);
      });
    } catch (e) {
      console.log('[Zone] audio playback error:', e);
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
    const entered = nearbyUsers.find((u) =>
      u.zone_active && u.zone_audio_url && (u.distance_km ?? Infinity) * 1000 < (u.zone_radius ?? 500),
    );
    if (entered) {
      setActiveZone({ username: entered.username, audioUrl: entered.zone_audio_url });
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

  useEffect(() => {
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
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermError('Location permission is required to find nearby people.');
        return;
      }
      const init = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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
      api.patch('/api/proximity/location/', { latitude: c.latitude, longitude: c.longitude }),
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

  // Keep the open sheet in sync with the latest nearby fetch
  useEffect(() => {
    if (!selectedUser) return;
    const fresh = nearby.find((u) => u.id === selectedUser.id);
    if (fresh) setSelectedUser(fresh);
  }, [nearby]);

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
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          initialRegion={region}
          showsUserLocation={false}
          showsMyLocationButton={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          {/* Zone circles for nearby users */}
          {visibleNearby
            .filter((u) => u.zone_active && (u.zone_radius ?? 0) > 0)
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

          {visibleNearby.map((user) => {
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
          onTap={() => activeZone.audioUrl && playZone(activeZone.audioUrl)}
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
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 20,
    paddingTop: 10,
    zIndex: 200,
    elevation: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(12,12,12,0.7)',
  },
  sheetBlur: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  // Centered hero block
  sheetHero: {
    alignItems: 'center',
    marginBottom: 20,
  },

  // Avatar glow system — 64px inner / 78px outer ring
  sheetAvatarGlow: {
    shadowRadius: 22,
    shadowOpacity: 0.75,
    shadowOffset: { width: 0, height: 0 },
    elevation: 14,
    marginBottom: 14,
  },
  sheetAvatarRing: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 2.5,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sheetAvatarText: { color: '#fff', fontSize: 26, fontWeight: '700' },
  sheetAvatarImage: { width: 64, height: 64, borderRadius: 32 },

  sheetName: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  sheetMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  relBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  relBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  sheetDist: { color: '#555', fontSize: 12 },

  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 20,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  interestsSection: { marginBottom: 20 },
  sectionLabel: {
    color: '#444',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  chipRow: { gap: 8 },
  chip: {
    backgroundColor: '#0d1f1e',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: `${COLOR_TEAL}30`,
  },
  chipText: { color: COLOR_TEAL, fontSize: 12, fontWeight: '500' },

  actions: { gap: 10 },
  btnPrimary: {
    backgroundColor: COLOR_TEAL,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#0a0a0a', fontSize: 15, fontWeight: '700' },
  btnSecondary: {
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  btnSecondaryText: { color: '#888', fontSize: 14, fontWeight: '600' },
  btnSent: { backgroundColor: '#0d1f1e', borderWidth: 1, borderColor: `${COLOR_TEAL}40` },
  btnSentText: { color: COLOR_TEAL, fontSize: 15, fontWeight: '600', opacity: 0.7 },

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
