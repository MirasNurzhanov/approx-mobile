import * as Location from 'expo-location';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Speedometer } from '@/components/Speedometer';
import { api } from '@/services/api';

// ─── Types ────────────────────────────────────────────────────────────────────
type Relationship = 'stranger' | 'connected' | 'friend';

interface NearbyUser {
  id: number;
  username: string;
  latitude: number;
  longitude: number;
  relationship: Relationship;
  distance?: number;
  shared_interests?: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const COLOR_FRIEND    = '#3b82f6';
const COLOR_CONNECTED = '#f97316';
const COLOR_STRANGER  = '#ffffff';
const COLOR_SELF      = '#8b5cf6';

const REL_LABEL: Record<Relationship, string> = {
  stranger: 'Nearby',
  connected: 'Connected',
  friend: 'Friend',
};

const POLL_MS = 30_000;
const SHEET_H = 360;
const SPRING_CFG = { damping: 22, stiffness: 220, mass: 0.9 };

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
        borderWidth: 2,
        borderColor: '#0a0a0a',
        shadowColor: color,
        shadowRadius: 6,
        shadowOpacity: 0.9,
        shadowOffset: { width: 0, height: 0 },
        elevation: 6,
      }}
    />
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

interface SheetProps {
  user: NearbyUser;
  sheetY: Animated.SharedValue<number>;
  onDismiss: () => void;
  friendIds: Set<number>;
  connectionIds: Set<number>;
}

function UserSheet({ user, sheetY, onDismiss, friendIds, connectionIds }: SheetProps) {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));
  const dist = fmtDistance(user.distance);

  const uid = Number(user.id);
  const isFriend    = friendIds.has(uid);
  const isConnected = !isFriend && connectionIds.has(uid);
  const isStranger  = !isFriend && !isConnected;

  const avatarBorderColor = isFriend ? COLOR_FRIEND : isConnected ? COLOR_CONNECTED : COLOR_STRANGER;
  const relLabel = isFriend ? 'Friend' : isConnected ? 'Connected' : REL_LABEL[user.relationship] ?? 'Nearby';

  function sendHi() {
    api.post('/api/proximity/wave/', { target_id: user.id }).catch(() => {});
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
      <Animated.View style={[styles.sheet, { paddingBottom: bottom + 16 }, animStyle]}>
        <View style={styles.sheetHandle} />

        {/* Header */}
        <View style={styles.sheetHeader}>
          <View style={[styles.sheetAvatar, { borderColor: avatarBorderColor }]}>
            <Text style={styles.sheetAvatarText}>
              {user.username.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.sheetName}>{user.username}</Text>
            <Text style={styles.sheetMeta}>
              {relLabel}{dist ? ` · ${dist}` : ''}
            </Text>
          </View>
          <Pressable onPress={onDismiss} hitSlop={14} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
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

        {/* Actions — context-aware per relationship */}
        <View style={styles.actions}>
          {isStranger && (
            <TouchableOpacity style={styles.btnPrimary} activeOpacity={0.8} onPress={sendHi}>
              <Text style={styles.btnPrimaryText}>👋  Send Hi</Text>
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
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [nearby, setNearby] = useState<NearbyUser[]>([]);
  const [permError, setPermError] = useState('');
  const [selectedUser, setSelectedUser] = useState<NearbyUser | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [friendIds, setFriendIds] = useState<Set<number>>(new Set());
  const [connectionIds, setConnectionIds] = useState<Set<number>>(new Set());
  const [friendsReady, setFriendsReady] = useState(false);

  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  const sheetY = useSharedValue(SHEET_H);

  // Fetch current user ID + friends list for marker colouring
  useEffect(() => {
    api.get<{ id: number; username: string }>('/api/users/me/')
      .then((r) => {
        console.log('[Map] current user id:', r.data.id, r.data.username);
        setCurrentUserId(r.data.id);
      })
      .catch((e) => console.log('[Map] /api/users/me/ failed:', e?.response?.status));

    api.get<{ friends: { id: number }[]; connections: { id: number }[] }>('/api/friends/list/')
      .then((r) => {
        setFriendIds(new Set(r.data.friends.map((u) => Number(u.id))));
        setConnectionIds(new Set(r.data.connections.map((u) => Number(u.id))));
        setFriendsReady(true);
      })
      .catch((e) => {
        console.log('[Map] friends list failed:', e?.response?.status);
        setFriendsReady(true); // render markers even if friends list fails
      });
  }, []);

  // Watch GPS position
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermError('Location permission is required to find nearby people.');
        return;
      }
      const init = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const c = { latitude: init.coords.latitude, longitude: init.coords.longitude };
      console.log('[Map] initial location:', c);
      setCoords(c);
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        (loc) => setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude }),
      );
    })();

    return () => { sub?.remove(); };
  }, []);

  // Poll nearby users + push location every 30 s
  useEffect(() => {
    if (!coords) return;

    async function tick() {
      const c = coordsRef.current;
      if (!c) return;

      const payload = { latitude: c.latitude, longitude: c.longitude };
      console.log('[Map] PATCH /api/proximity/location/ payload:', JSON.stringify(payload));

      const [locationResult, nearbyResult] = await Promise.allSettled([
        api.patch('/api/proximity/location/', payload),
        api.get<NearbyUser[]>('/api/proximity/nearby/'),
      ]);

      if (locationResult.status === 'rejected') {
        const err = locationResult.reason;
        console.log(
          '[Map] location PATCH error:',
          err?.response?.status,
          JSON.stringify(err?.response?.data),
        );
      } else {
        console.log('[Map] location PATCH ok:', locationResult.value?.status);
      }

      if (nearbyResult.status === 'fulfilled') {
        const users = nearbyResult.value.data;
        console.log('[Map] nearby users raw:', JSON.stringify(users));
        setNearby(users);
      } else {
        const err = nearbyResult.reason;
        console.log(
          '[Map] nearby fetch error:',
          err?.response?.status,
          JSON.stringify(err?.response?.data),
        );
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [!!coords]); // eslint-disable-line react-hooks/exhaustive-deps

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
    ? {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      }
    : undefined;

  return (
    <View style={styles.container}>
      {permError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{permError}</Text>
        </View>
      ) : !coords ? (
        <View style={styles.center}>
          <ActivityIndicator color="#00b4a6" size="large" />
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
          {/* Nearby users — exclude self; rendered first so self marker sits on top */}
          {nearby
            .filter((u) => currentUserId === null || Number(u.id) !== currentUserId)
            .map((user) => {
              const uid = Number(user.id);
              const color = friendIds.has(uid)
                ? COLOR_FRIEND
                : connectionIds.has(uid)
                  ? COLOR_CONNECTED
                  : COLOR_STRANGER;
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

          {/* Self — rendered last so it's always on top */}
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

      {/* Legend */}
      <View style={styles.legend}>
        <LegendItem color={COLOR_SELF}      label="You" />
        <LegendItem color={COLOR_STRANGER}  label="Nearby" />
        <LegendItem color={COLOR_CONNECTED} label="Connected" />
        <LegendItem color={COLOR_FRIEND}    label="Friend" />
      </View>

      {/* User detail sheet */}
      {selectedUser && (
        <UserSheet
          user={selectedUser}
          sheetY={sheetY}
          onDismiss={closeSheet}
          friendIds={friendIds}
          connectionIds={connectionIds}
        />
      )}

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  map: { flex: 1, backgroundColor: '#0a0a0a' },
  center: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: { color: '#555', fontSize: 14 },
  errorText: { color: '#ff4d4d', fontSize: 15, textAlign: 'center', padding: 24 },
  selfRing: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#8b5cf640',
    alignItems: 'center',
    justifyContent: 'center',
  },
  legend: {
    position: 'absolute',
    bottom: 80,
    right: 16,
    backgroundColor: '#0a0a0acc',
    borderRadius: 12,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: '#333' },
  legendLabel: { color: '#aaa', fontSize: 11, fontWeight: '500' },

  // ── Sheet ──
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 150 },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_H,
    backgroundColor: '#111111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: '#1e1e1e',
    paddingHorizontal: 20,
    paddingTop: 10,
    zIndex: 200,
    elevation: 20,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#2e2e2e',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  sheetAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetAvatarText: { color: '#fff', fontSize: 19, fontWeight: '700' },
  sheetName: { color: '#fff', fontSize: 17, fontWeight: '700' },
  sheetMeta: { color: '#555', fontSize: 12, marginTop: 3 },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1e1e1e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#555', fontSize: 13 },
  interestsSection: { marginBottom: 20 },
  sectionLabel: {
    color: '#444',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  chipRow: { gap: 8 },
  chip: {
    backgroundColor: '#0d1f1e',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#00b4a630',
  },
  chipText: { color: '#00b4a6', fontSize: 12, fontWeight: '500' },
  actions: { gap: 10 },
  btnPrimary: {
    backgroundColor: '#00b4a6',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#0a0a0a', fontSize: 15, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 10 },
  btnSecondary: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#252525',
  },
  btnSecondaryText: { color: '#888', fontSize: 14, fontWeight: '600' },
});
