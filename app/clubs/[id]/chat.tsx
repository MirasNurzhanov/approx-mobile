import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { clubsApi } from '@/services/clubs';
import { removeMeetupFromMap } from '@/services/nearbyRefresh';
import { usePermissionPrimer } from '@/components/PermissionPrimer';
import { Avatar } from '@/components/ui/Avatar';
import { colors, fonts, radius } from '@/constants/theme';

const WS_BASE = 'wss://project-x-production-3261.up.railway.app';

// ─── Types ────────────────────────────────────────────────────────────────────
type ProposalStatus = 'pending' | 'approved' | 'rejected';

interface MeetupProposal {
  id: number;
  title: string;
  description?: string;
  event_datetime: string;
  location_name?: string;
  latitude?: number;
  longitude?: number;
  status: ProposalStatus;
}

interface ClubMessage {
  id: string;
  text?: string;
  image?: string;
  message_type?: string;
  proposal?: MeetupProposal;
  sender_id: number;
  sender_username?: string;
  sender_avatar?: string;
  created_at: string;
  pending?: boolean;
}

interface RawMsg {
  id?: string | number;
  message?: string;
  text?: string;
  content?: string;
  body?: string;
  image?: string;
  message_type?: string;
  event?: unknown;   // ClubMessageSerializer nests the ClubEvent here
  proposal?: unknown;
  sender_id?: number | string;
  sender?: number | string | { id: number | string; username?: string; profile_picture?: string };
  timestamp?: string;
  created_at?: string;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString([], {
      weekday: 'short', month: 'short', day: 'numeric',
      year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function fmtPickerDate(d: Date) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtPickerTime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function normalise(raw: RawMsg, fallbackId?: string): ClubMessage {
  let sender_id = -1;
  let sender_username: string | undefined;
  let sender_avatar: string | undefined;

  if (raw.sender_id != null) sender_id = Number(raw.sender_id);
  if (raw.sender != null) {
    if (typeof raw.sender === 'number' || typeof raw.sender === 'string') {
      sender_id = Number(raw.sender);
    } else {
      sender_id = Number(raw.sender.id);
      sender_username = raw.sender.username;
      sender_avatar = raw.sender.profile_picture;
    }
  }

  const textVal = raw.content ?? raw.message ?? raw.text ?? raw.body;
  return {
    id:           String(raw.id ?? fallbackId ?? Date.now()),
    text:         textVal != null ? String(textVal) : undefined,
    image:        raw.image as string | undefined,
    message_type: raw.message_type,
    proposal:     (raw.event ?? raw.proposal) as MeetupProposal | undefined,
    sender_id,
    sender_username,
    sender_avatar,
    created_at:   (raw.timestamp as string) ?? (raw.created_at as string) ?? new Date().toISOString(),
  };
}

function defaultProposalDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(12, 0, 0, 0);
  return d;
}

const DEFAULT_REGION: Region = { latitude: 43.238, longitude: 76.889, latitudeDelta: 0.05, longitudeDelta: 0.05 };

// ─── DateTimePicker ───────────────────────────────────────────────────────────
function DateTimePicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  function adj(field: 'day' | 'hour' | 'minute', delta: number) {
    const d = new Date(value);
    if (field === 'day') d.setDate(d.getDate() + delta);
    else if (field === 'hour') d.setHours(d.getHours() + delta);
    else d.setMinutes(Math.round(d.getMinutes() / 15) * 15 + delta * 15);
    onChange(d);
  }

  return (
    <View style={dtStyles.wrap}>
      {/* Date row */}
      <View style={dtStyles.row}>
        <Text style={dtStyles.label}>Date</Text>
        <Pressable onPress={() => adj('day', -1)} hitSlop={10} style={dtStyles.arrow}>
          <Ionicons name="chevron-back" size={18} color={colors.t2} />
        </Pressable>
        <Text style={dtStyles.value}>{fmtPickerDate(value)}</Text>
        <Pressable onPress={() => adj('day', 1)} hitSlop={10} style={dtStyles.arrow}>
          <Ionicons name="chevron-forward" size={18} color={colors.t2} />
        </Pressable>
      </View>

      {/* Time row */}
      <View style={dtStyles.row}>
        <Text style={dtStyles.label}>Time</Text>
        <Pressable onPress={() => adj('hour', -1)} hitSlop={10} style={dtStyles.arrow}>
          <Ionicons name="chevron-back" size={18} color={colors.t2} />
        </Pressable>
        <Pressable onPress={() => adj('minute', -1)} hitSlop={10} style={dtStyles.minusBtn}>
          <Ionicons name="remove" size={14} color={colors.t3} />
        </Pressable>
        <Text style={dtStyles.value}>{fmtPickerTime(value)}</Text>
        <Pressable onPress={() => adj('minute', 1)} hitSlop={10} style={dtStyles.minusBtn}>
          <Ionicons name="add" size={14} color={colors.t3} />
        </Pressable>
        <Pressable onPress={() => adj('hour', 1)} hitSlop={10} style={dtStyles.arrow}>
          <Ionicons name="chevron-forward" size={18} color={colors.t2} />
        </Pressable>
      </View>
      <Text style={dtStyles.hint}>← / → changes day or hour · +/− changes time by 15 min</Text>
    </View>
  );
}

const dtStyles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface2,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 6,
  },
  label: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: colors.t3, width: 36 },
  value: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.t1, textAlign: 'center' },
  arrow: { padding: 2 },
  minusBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.t3,
    textAlign: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
});

// ─── ProposalCard ─────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<ProposalStatus, { bg: string; text: string }> = {
  pending:  { bg: '#FEF3C7', text: '#92400E' },
  approved: { bg: '#D1FAE5', text: '#065F46' },
  rejected: { bg: '#FEE2E2', text: '#991B1B' },
};

function ProposalCard({
  proposal,
  proposerUsername,
  viewerIsOwner,
  viewerIsProposer,
  onApprove,
  onReject,
  onDelete,
  actioningId,
}: {
  proposal: MeetupProposal;
  proposerUsername?: string;
  viewerIsOwner: boolean;
  viewerIsProposer: boolean;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onDelete: (id: number) => void;
  actioningId: number | null;
}) {
  const statusColor = STATUS_COLORS[proposal.status] ?? STATUS_COLORS.pending;
  const isActioning = actioningId === proposal.id;
  const canDelete = viewerIsOwner || viewerIsProposer;

  function confirmDelete() {
    Alert.alert(
      'Delete this meetup?',
      'This removes it from the chat and the map.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(proposal.id) },
      ],
    );
  }

  return (
    <View style={cardStyles.card}>
      {/* Header stripe */}
      <View style={cardStyles.header}>
        <View style={cardStyles.headerLeft}>
          <Ionicons name="calendar-outline" size={13} color={colors.teal} />
          <Text style={cardStyles.headerLabel}>MEETUP PROPOSAL</Text>
        </View>
        <View style={cardStyles.headerRight}>
          <View style={[cardStyles.statusBadge, { backgroundColor: statusColor.bg }]}>
            <Text style={[cardStyles.statusText, { color: statusColor.text }]}>
              {proposal.status.toUpperCase()}
            </Text>
          </View>
          {canDelete && (
            <Pressable onPress={confirmDelete} hitSlop={10} style={cardStyles.menuBtn}>
              <Ionicons name="ellipsis-vertical" size={16} color={colors.t2} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Body */}
      <View style={cardStyles.body}>
        <Text style={cardStyles.title}>{proposal.title}</Text>
        <View style={cardStyles.metaRow}>
          <Ionicons name="time-outline" size={13} color={colors.t3} />
          <Text style={cardStyles.metaText}>{fmtDateTime(proposal.event_datetime)}</Text>
        </View>
        {proposal.location_name ? (
          <View style={cardStyles.metaRow}>
            <Ionicons name="location-outline" size={13} color={colors.t3} />
            <Text style={cardStyles.metaText} numberOfLines={1}>{proposal.location_name}</Text>
          </View>
        ) : null}
        {proposal.description ? (
          <Text style={cardStyles.desc}>{proposal.description}</Text>
        ) : null}
        <Text style={cardStyles.proposer}>Proposed by @{proposerUsername ?? 'member'}</Text>
      </View>

      {/* Owner actions — pending only */}
      {viewerIsOwner && proposal.status === 'pending' && (
        <View style={cardStyles.actions}>
          <Pressable
            style={[cardStyles.approveBtn, isActioning && cardStyles.actionBtnDisabled]}
            onPress={() => onApprove(proposal.id)}
            disabled={isActioning}
          >
            {isActioning
              ? <ActivityIndicator size="small" color={colors.bg} />
              : <Text style={cardStyles.approveBtnText}>✓  Approve</Text>
            }
          </Pressable>
          <Pressable
            style={[cardStyles.rejectBtn, isActioning && cardStyles.actionBtnDisabled]}
            onPress={() => onReject(proposal.id)}
            disabled={isActioning}
          >
            <Text style={cardStyles.rejectBtnText}>✗  Reject</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.l,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.tealTint,
    borderBottomWidth: 1,
    borderBottomColor: colors.tealLine,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerLabel: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 1, color: colors.teal },
  statusBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  menuBtn: { padding: 2 },

  body: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, gap: 5 },
  title: { fontFamily: fonts.display, fontSize: 16, fontWeight: '700', color: colors.t1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontFamily: fonts.body, fontSize: 13, color: colors.t2, flex: 1 },
  desc: { fontFamily: fonts.body, fontSize: 13, color: colors.t2, lineHeight: 19, marginTop: 4 },
  proposer: { fontFamily: fonts.body, fontSize: 11, color: colors.t3, marginTop: 6 },

  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 4,
  },
  approveBtn: {
    flex: 1,
    backgroundColor: colors.teal,
    borderRadius: radius.m,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingVertical: 9,
    alignItems: 'center',
  },
  actionBtnDisabled: { opacity: 0.5 },
  approveBtnText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.bg },
  rejectBtnText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.t2 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ClubChatScreen() {
  const { id, name, emblem, memberCount } = useLocalSearchParams<{
    id: string;
    name?: string;
    emblem?: string;
    memberCount?: string;
  }>();
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const { ensure: ensurePermission, primer } = usePermissionPrimer();

  const clubId = Number(id);
  const [viewerIsOwner, setViewerIsOwner] = useState(false);

  // ── Chat state ────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ClubMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [wsReady, setWsReady] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [actioningEventId, setActioningEventId] = useState<number | null>(null);

  // ── Proposal / map modal state ────────────────────────────────────────────
  const [modalView, setModalView] = useState<'proposal' | 'map' | null>(null);
  const [propTitle, setPropTitle] = useState('');
  const [propDesc, setPropDesc] = useState('');
  const [propDateTime, setPropDateTime] = useState<Date>(defaultProposalDate);
  const [propLocation, setPropLocation] = useState<{ name: string; lat: number; lng: number } | null>(null);
  const [proposalSubmitting, setProposalSubmitting] = useState(false);

  // ── Map picker state ──────────────────────────────────────────────────────
  const [mapRegion, setMapRegion] = useState<Region>(DEFAULT_REGION);
  const [gettingLocation, setGettingLocation] = useState(false);

  const currentUserIdRef = useRef<number | null>(null);
  const senderCache = useRef<Map<number, { username: string; avatar?: string }>>(new Map());
  const ws = useRef<WebSocket | null>(null);
  const flatListRef = useRef<FlatList>(null);

  function cacheSender(msg: ClubMessage) {
    if (msg.sender_id > 0 && msg.sender_username) {
      senderCache.current.set(msg.sender_id, { username: msg.sender_username, avatar: msg.sender_avatar });
    }
  }

  function hydrate(msg: ClubMessage): ClubMessage {
    if (msg.sender_username) return msg;
    const cached = senderCache.current.get(msg.sender_id);
    if (!cached) return msg;
    return { ...msg, sender_username: cached.username, sender_avatar: cached.avatar };
  }

  // ── Current user id ───────────────────────────────────────────────────────
  useEffect(() => {
    api.get<{ id: number | string }>('/api/users/profile/')
      .then((r) => { currentUserIdRef.current = Number(r.data.id); })
      .catch(() => {});
  }, []);

  // ── Ownership — fetch on mount and re-check whenever screen is focused ────
  const fetchRole = useCallback(async () => {
    try {
      const { data } = await clubsApi.get(clubId);
      setViewerIsOwner(data.my_role === 'owner');
    } catch {}
  }, [clubId]);

  useEffect(() => { fetchRole(); }, [fetchRole]);

  useFocusEffect(useCallback(() => { fetchRole(); }, [fetchRole]));

  // ── History ───────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get<RawMsg[]>(`/api/clubs/${clubId}/messages/`)
      .then((r) => {
        const raw: RawMsg[] = Array.isArray(r.data) ? r.data : (r.data as any).results ?? [];
        const msgs = raw.map((m) => normalise(m));
        msgs.forEach(cacheSender);
        setMessages(msgs);
        if (raw.length === 0) setHasMore(false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clubId]);

  // ── Infinite scroll up ────────────────────────────────────────────────────
  const loadOlderMessages = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    const oldestId = messages[0].id;
    setLoadingMore(true);
    try {
      const r = await api.get<RawMsg[]>(`/api/clubs/${clubId}/messages/?before=${oldestId}`);
      const raw: RawMsg[] = Array.isArray(r.data) ? r.data : (r.data as any).results ?? [];
      if (raw.length === 0) { setHasMore(false); return; }
      const older = raw.map((m) => normalise(m));
      older.forEach(cacheSender);
      setMessages((prev) => [...older, ...prev]);
    } catch {} finally { setLoadingMore(false); }
  }, [clubId, loadingMore, hasMore, messages]);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (e.nativeEvent.contentOffset.y < 60 && hasMore && !loadingMore) loadOlderMessages();
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;

    async function connect() {
      const token = await AsyncStorage.getItem('access_token');
      if (!token || !active) return;
      const socket = new WebSocket(`${WS_BASE}/ws/clubs/${clubId}/?token=${token}`);

      socket.onopen = () => {
        if (!active) { socket.close(); return; }
        ws.current = socket;
        setWsReady(true);
      };

      socket.onmessage = (event) => {
        try {
          const raw: RawMsg = JSON.parse(event.data);
          const incoming = hydrate(normalise(raw));
          // Allow proposals through even without text/image
          if (!incoming.text && !incoming.image && incoming.message_type !== 'meetup_proposal') return;
          cacheSender(incoming);

          setMessages((prev) => {
            if (incoming.id && prev.some((m) => m.id === incoming.id && !m.pending)) return prev;
            const isFromMe = incoming.sender_id === currentUserIdRef.current;
            if (isFromMe) {
              for (let i = prev.length - 1; i >= 0; i--) {
                if (prev[i].pending && prev[i].text === incoming.text) {
                  const updated = [...prev];
                  updated[i] = incoming;
                  return updated;
                }
              }
            }
            return [...prev, incoming];
          });
        } catch {}
      };

      socket.onclose = (event) => {
        if (!active) return;
        setWsReady(false);
        if (event.code === 4003) {
          Alert.alert('Removed from club', 'You are no longer a member of this club.', [
            { text: 'OK', onPress: () => router.replace('/(tabs)/chat' as any) },
          ]);
        } else if (event.code === 4001) {
          router.back();
        }
      };

      socket.onerror = () => { if (active) setWsReady(false); };
    }

    connect();
    return () => {
      active = false;
      ws.current?.close();
      ws.current = null;
    };
  }, [clubId]);

  // ── Scroll to bottom ──────────────────────────────────────────────────────
  useEffect(() => {
    if (messages.length > 0 && !loadingMore) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length]);

  // ── Send text / image ─────────────────────────────────────────────────────
  function sendText() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    const tempId = `pending-${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: tempId, text: trimmed,
      sender_id: currentUserIdRef.current ?? -1,
      created_at: new Date().toISOString(), pending: true,
    }]);
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ content: trimmed }));
    } else {
      api.post<RawMsg>(`/api/clubs/${clubId}/messages/`, { content: trimmed })
        .then((r) => {
          const confirmed = normalise(r.data);
          setMessages((prev) => prev.map((m) => m.id === tempId ? confirmed : m));
        })
        .catch(() => {});
    }
  }

  function sendImage(asset: ImagePicker.ImagePickerAsset) {
    const tempId = `temp-img-${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: tempId, image: asset.uri,
      sender_id: currentUserIdRef.current ?? -1,
      created_at: new Date().toISOString(), pending: true,
    }]);
    const form = new FormData();
    form.append('image', { uri: asset.uri, type: asset.mimeType ?? 'image/jpeg', name: 'attachment.jpg' } as any);
    api.post(`/api/clubs/${clubId}/messages/`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).catch(() => {});
  }

  async function handleAttach() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any, allowsEditing: true, quality: 0.8,
    });
    if (!result.canceled) sendImage(result.assets[0]);
  }

  async function handleCamera() {
    if (!(await ensurePermission('camera'))) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'] as any, allowsEditing: true, quality: 0.8,
    });
    if (!result.canceled) sendImage(result.assets[0]);
  }

  // ── Location helpers ──────────────────────────────────────────────────────
  async function handleCurrentLocation() {
    setGettingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow location access to use your current position.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = pos.coords;
      let locationName = 'Current Location';
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
        const place = geo[0];
        const parts = [place.name, place.street, place.city].filter(Boolean);
        if (parts.length) locationName = parts.join(', ');
      } catch {}
      setPropLocation({ name: locationName, lat: latitude, lng: longitude });
      setMapRegion({ latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    } catch {
      Alert.alert('Error', 'Could not get current location.');
    } finally {
      setGettingLocation(false);
    }
  }

  async function confirmMapLocation() {
    setGettingLocation(true);
    const { latitude, longitude } = mapRegion;
    let locationName = 'Picked Location';
    try {
      const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
      const place = geo[0];
      const parts = [place.name, place.street, place.city].filter(Boolean);
      if (parts.length) locationName = parts.join(', ');
    } catch {}
    setPropLocation({ name: locationName, lat: latitude, lng: longitude });
    setGettingLocation(false);
    setModalView('proposal');
  }

  // ── Proposal submit ───────────────────────────────────────────────────────
  function closeProposalModal() {
    setModalView(null);
    setPropTitle('');
    setPropDesc('');
    setPropDateTime(defaultProposalDate());
    setPropLocation(null);
  }

  async function handleProposalSubmit() {
    if (!propTitle.trim()) {
      Alert.alert('Title required', 'Give your meetup a title.');
      return;
    }
    setProposalSubmitting(true);
    try {
      const body = {
        title: propTitle.trim(),
        description: propDesc.trim() || undefined,
        event_datetime: propDateTime.toISOString(),
        location_name: propLocation?.name,
        latitude: propLocation?.lat,
        longitude: propLocation?.lng,
      };
      console.log('[Proposal] POST body:', JSON.stringify(body));
      await api.post(`/api/clubs/${clubId}/events/`, body);
      closeProposalModal();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not create proposal.');
    } finally {
      setProposalSubmitting(false);
    }
  }

  // ── Delete proposal ───────────────────────────────────────────────────────
  async function handleDelete(proposalId: number) {
    try {
      await api.delete(`/api/clubs/events/${proposalId}/`);
      setMessages((prev) => prev.filter((m) => m.proposal?.id !== proposalId));
      removeMeetupFromMap(proposalId);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not delete meetup.');
    }
  }

  // ── Approve / Reject ──────────────────────────────────────────────────────
  async function handleApprove(proposalId: number) {
    setActioningEventId(proposalId);
    try {
      await api.patch(`/api/clubs/events/${proposalId}/approve/`);
      setMessages((prev) => prev.map((m) =>
        m.proposal?.id === proposalId
          ? { ...m, proposal: { ...m.proposal!, status: 'approved' as ProposalStatus } }
          : m,
      ));
    } catch {
      Alert.alert('Error', 'Could not approve proposal.');
    } finally {
      setActioningEventId(null);
    }
  }

  async function handleReject(proposalId: number) {
    setActioningEventId(proposalId);
    try {
      await api.patch(`/api/clubs/events/${proposalId}/reject/`);
      setMessages((prev) => prev.map((m) =>
        m.proposal?.id === proposalId
          ? { ...m, proposal: { ...m.proposal!, status: 'rejected' as ProposalStatus } }
          : m,
      ));
    } catch {
      Alert.alert('Error', 'Could not reject proposal.');
    } finally {
      setActioningEventId(null);
    }
  }

  const canSend = text.trim().length > 0;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Header */}
      <Pressable style={[styles.header, { paddingTop: top + 6 }]} onPress={() => router.back()}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </Pressable>
        {emblem ? (
          <Image source={{ uri: emblem }} style={styles.headerEmblem} />
        ) : (
          <View style={styles.headerEmblemFallback}>
            <Text style={styles.headerEmblemInitial}>{(name ?? 'C').charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>{name ?? 'Club Chat'}</Text>
          <Text style={styles.headerSub}>
            {memberCount ? `${memberCount} members` : 'Group chat'}
            {!wsReady ? '  ·  Reconnecting…' : ''}
          </Text>
        </View>
      </Pressable>

      {/* Messages */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={200}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          ListHeaderComponent={loadingMore ? <ActivityIndicator color={colors.teal} style={{ marginVertical: 12 }} /> : null}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No messages yet — say hello!</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const isMine = item.sender_id === currentUserIdRef.current;
            const hydratedItem = hydrate(item);

            // ── Meetup proposal card ──────────────────────────────────────
            if (item.message_type === 'meetup_proposal') {
              console.log('[Proposal] raw message:', JSON.stringify(item));
            }
            if (item.message_type === 'meetup_proposal' && item.proposal) {
              return (
                <View style={styles.proposalRow}>
                  <ProposalCard
                    proposal={item.proposal}
                    proposerUsername={hydratedItem.sender_username}
                    viewerIsOwner={viewerIsOwner}
                    viewerIsProposer={item.sender_id === currentUserIdRef.current}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onDelete={handleDelete}
                    actioningId={actioningEventId}
                  />
                  <Text style={styles.proposalTime}>{fmtTime(item.created_at)}</Text>
                </View>
              );
            }

            // ── Regular bubble ────────────────────────────────────────────
            const prevMsg = index > 0 ? messages[index - 1] : null;
            const showSenderHeader = !isMine && (!prevMsg || prevMsg.sender_id !== item.sender_id);

            return (
              <View style={[styles.row, isMine ? styles.rowRight : styles.rowLeft]}>
                {!isMine && (
                  <View style={styles.avatarSlot}>
                    {showSenderHeader && (
                      <Avatar uri={hydratedItem.sender_avatar} name={hydratedItem.sender_username ?? '?'} size="xs" />
                    )}
                  </View>
                )}
                <View style={styles.bubbleCol}>
                  {showSenderHeader && !isMine && (
                    <Text style={styles.senderName}>@{hydratedItem.sender_username ?? 'member'}</Text>
                  )}
                  <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs, item.pending && styles.bubblePending]}>
                    {item.image ? (
                      <Image source={{ uri: item.image }} style={styles.bubbleImage} resizeMode="cover" />
                    ) : (
                      <Text style={isMine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>{item.text}</Text>
                    )}
                    <Text style={[styles.bubbleTime, isMine ? styles.bubbleTimeMine : styles.bubbleTimeTheirs]}>
                      {fmtTime(item.created_at)}{item.pending ? ' ·' : ''}
                    </Text>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Input bar */}
      <View style={[styles.inputBar, { paddingBottom: bottom + 8 }]}>
        <Pressable style={styles.attachBtn} onPress={handleCamera} hitSlop={4}>
          <Ionicons name="camera-outline" size={20} color={colors.t3} />
        </Pressable>
        <Pressable style={styles.attachBtn} onPress={handleAttach} hitSlop={4}>
          <Ionicons name="image-outline" size={20} color={colors.t3} />
        </Pressable>
        <Pressable style={styles.attachBtn} onPress={() => setModalView('proposal')} hitSlop={4}>
          <Ionicons name="calendar-outline" size={20} color={colors.t3} />
        </Pressable>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor={colors.t3}
          multiline
          maxLength={2000}
        />
        <Pressable
          style={[styles.sendBtn, canSend && styles.sendBtnActive]}
          onPress={sendText}
          disabled={!canSend}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
        >
          <Ionicons name="send" size={16} color={canSend ? colors.bg : colors.t3} />
        </Pressable>
      </View>
      {primer}

      {/* ── Single modal: proposal form or map picker ────────────────────── */}
      <Modal
        visible={modalView !== null}
        transparent
        animationType="slide"
        onRequestClose={modalView === 'map' ? () => setModalView('proposal') : closeProposalModal}
      >
        {modalView === 'proposal' ? (
          <>
            <Pressable style={styles.modalBackdrop} onPress={closeProposalModal} />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalKav}>
              <View style={[styles.modalSheet, { paddingBottom: bottom + 20 }]}>
                <View style={styles.modalHandle} />
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Propose a Meetup</Text>
                  <Pressable onPress={closeProposalModal} hitSlop={10}>
                    <Ionicons name="close" size={22} color={colors.t2} />
                  </Pressable>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {/* Title */}
                  <Text style={styles.fieldLabel}>Title <Text style={styles.required}>*</Text></Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={propTitle}
                    onChangeText={setPropTitle}
                    placeholder="e.g. Morning hike at Shymbulak"
                    placeholderTextColor={colors.t3}
                    maxLength={80}
                  />

                  {/* Description */}
                  <Text style={styles.fieldLabel}>Description</Text>
                  <TextInput
                    style={[styles.fieldInput, styles.fieldTextArea]}
                    value={propDesc}
                    onChangeText={setPropDesc}
                    placeholder="Details, what to bring, etc."
                    placeholderTextColor={colors.t3}
                    multiline
                    numberOfLines={3}
                    maxLength={400}
                    textAlignVertical="top"
                  />

                  {/* Date / time */}
                  <Text style={styles.fieldLabel}>Date &amp; Time</Text>
                  <DateTimePicker value={propDateTime} onChange={setPropDateTime} />

                  {/* Location */}
                  <Text style={styles.fieldLabel}>Location</Text>
                  <View style={styles.locationRow}>
                    <Pressable
                      style={[styles.locationBtn, gettingLocation && styles.locationBtnBusy]}
                      onPress={handleCurrentLocation}
                      disabled={gettingLocation}
                    >
                      {gettingLocation
                        ? <ActivityIndicator size="small" color={colors.teal} />
                        : <Ionicons name="navigate-outline" size={16} color={colors.teal} />
                      }
                      <Text style={styles.locationBtnText}>My location</Text>
                    </Pressable>
                    <Pressable style={styles.locationBtn} onPress={() => setModalView('map')}>
                      <Ionicons name="map-outline" size={16} color={colors.teal} />
                      <Text style={styles.locationBtnText}>Pick on map</Text>
                    </Pressable>
                  </View>
                  {propLocation && (
                    <View style={styles.locationPreview}>
                      <Ionicons name="location" size={14} color={colors.teal} />
                      <Text style={styles.locationPreviewText} numberOfLines={1}>{propLocation.name}</Text>
                      <Pressable onPress={() => setPropLocation(null)} hitSlop={8}>
                        <Ionicons name="close-circle" size={16} color={colors.t3} />
                      </Pressable>
                    </View>
                  )}

                  {/* Submit */}
                  <Pressable
                    style={[styles.submitBtn, proposalSubmitting && styles.submitBtnBusy]}
                    onPress={handleProposalSubmit}
                    disabled={proposalSubmitting}
                  >
                    {proposalSubmitting
                      ? <ActivityIndicator color={colors.bg} size="small" />
                      : <Text style={styles.submitBtnText}>Send Proposal</Text>
                    }
                  </Pressable>
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </>
        ) : (
          <View style={styles.mapPickerRoot}>
            {/* Map header */}
            <View style={[styles.mapPickerHeader, { paddingTop: top + 6 }]}>
              <Pressable onPress={() => setModalView('proposal')} hitSlop={12} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={24} color={colors.t1} />
              </Pressable>
              <Text style={styles.mapPickerTitle}>Drop a pin</Text>
              <View style={{ width: 36 }} />
            </View>

            {/* Map */}
            <View style={styles.mapWrap}>
              <MapView
                style={StyleSheet.absoluteFill}
                provider={PROVIDER_GOOGLE}
                initialRegion={mapRegion}
                onRegionChangeComplete={setMapRegion}
              />
              {/* Fixed center pin */}
              <View pointerEvents="none" style={styles.centerPin}>
                <Ionicons name="location" size={36} color={colors.teal} />
                <View style={styles.centerPinDot} />
              </View>
            </View>

            {/* Confirm */}
            <View style={[styles.mapConfirmBar, { paddingBottom: bottom + 16 }]}>
              <Pressable
                style={[styles.mapConfirmBtn, gettingLocation && styles.submitBtnBusy]}
                onPress={confirmMapLocation}
                disabled={gettingLocation}
              >
                {gettingLocation
                  ? <ActivityIndicator color={colors.bg} size="small" />
                  : <Text style={styles.mapConfirmBtnText}>Confirm Location</Text>
                }
              </Pressable>
            </View>
          </View>
        )}
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  backBtn: { padding: 4 },
  headerEmblem: { width: 36, height: 36, borderRadius: 18 },
  headerEmblemFallback: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  headerEmblemInitial: { fontFamily: fonts.display, fontSize: 15, fontWeight: '700', color: colors.teal },
  headerInfo: { flex: 1, gap: 2 },
  headerName: { fontFamily: fonts.display, fontWeight: '600', fontSize: 17, color: colors.t1, flexShrink: 1 },
  headerSub: { fontFamily: fonts.body, fontSize: 11, color: colors.t3 },

  // Loading / empty
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { fontFamily: fonts.body, color: colors.t3, fontSize: 14 },

  // List
  listContent: { paddingHorizontal: 12, paddingVertical: 16, gap: 4, flexGrow: 1 },

  // Proposal row (full width, centred)
  proposalRow: { marginVertical: 6, paddingHorizontal: 4 },
  proposalTime: { fontFamily: fonts.body, fontSize: 10, color: colors.t3, textAlign: 'center', marginTop: 4 },

  // Regular bubble rows
  row: { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 2 },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  avatarSlot: { width: 28, marginRight: 6, alignItems: 'center', justifyContent: 'flex-end' },
  bubbleCol: { flexShrink: 1, maxWidth: '75%' },
  senderName: {
    fontFamily: fonts.body, fontSize: 11, fontWeight: '600', color: colors.t3,
    marginBottom: 3, marginLeft: 4,
  },
  bubble: { borderRadius: radius.l, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 7, gap: 4 },
  bubbleMine: { backgroundColor: colors.teal, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  bubblePending: { opacity: 0.55 },
  bubbleTextMine: { fontFamily: fonts.body, color: '#04211D', fontSize: 15, lineHeight: 21 },
  bubbleTextTheirs: { fontFamily: fonts.body, color: colors.t1, fontSize: 15, lineHeight: 21 },
  bubbleTime: { fontSize: 10, fontFamily: fonts.body, alignSelf: 'flex-end' },
  bubbleTimeMine: { color: colors.tealTint },
  bubbleTimeTheirs: { color: colors.t3 },
  bubbleImage: { width: 210, height: 210, borderRadius: radius.m },

  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 10, gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  attachBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, minHeight: 38, maxHeight: 120,
    backgroundColor: colors.surface2, borderRadius: radius.l, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    fontFamily: fonts.body, color: colors.t1, fontSize: 15, lineHeight: 20,
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  sendBtnActive: { backgroundColor: colors.teal, borderColor: colors.teal },

  // Proposal modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalKav: { justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, maxHeight: '92%',
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: 'center', marginTop: 12, marginBottom: 16,
  },
  modalHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20,
  },
  modalTitle: { fontFamily: fonts.display, fontSize: 18, fontWeight: '700', color: colors.t1 },

  fieldLabel: {
    fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: colors.t2, marginBottom: 8, marginTop: 16,
  },
  required: { color: colors.red },
  fieldInput: {
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radius.m,
    paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: fonts.body, fontSize: 15, color: colors.t1,
  },
  fieldTextArea: { height: 80, paddingTop: 12, textAlignVertical: 'top' },

  locationRow: { flexDirection: 'row', gap: 10 },
  locationBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center',
    backgroundColor: colors.tealTint, borderWidth: 1, borderColor: colors.tealLine,
    borderRadius: radius.m, paddingVertical: 10,
  },
  locationBtnBusy: { opacity: 0.6 },
  locationBtnText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.teal },
  locationPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface2, borderRadius: radius.m, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 9, marginTop: 10,
  },
  locationPreviewText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.t1 },

  submitBtn: {
    marginTop: 24, backgroundColor: colors.teal, borderRadius: radius.l,
    paddingVertical: 14, alignItems: 'center',
  },
  submitBtnBusy: { opacity: 0.6 },
  submitBtnText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: colors.bg },

  // Map picker
  mapPickerRoot: { flex: 1, backgroundColor: colors.bg },
  mapPickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  mapPickerTitle: { fontFamily: fonts.display, fontSize: 17, fontWeight: '600', color: colors.t1 },
  mapWrap: { flex: 1, position: 'relative' },
  centerPin: {
    position: 'absolute', top: '50%', left: '50%',
    transform: [{ translateX: -18 }, { translateY: -36 }],
    alignItems: 'center',
  },
  centerPinDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal,
    marginTop: -2,
  },
  mapConfirmBar: {
    paddingHorizontal: 20, paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  mapConfirmBtn: {
    backgroundColor: colors.teal, borderRadius: radius.l,
    paddingVertical: 14, alignItems: 'center',
  },
  mapConfirmBtnText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: colors.bg },
});
