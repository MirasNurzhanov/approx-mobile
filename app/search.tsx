import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';

// ─── Types ────────────────────────────────────────────────────────────────────
type Relationship = 'stranger' | 'connected' | 'friend';

interface SearchUser {
  id: number;
  username: string;
  profile_picture?: string;
  // API may return count directly or a full array
  shared_interests_count?: number;
  shared_interests?: { name: string; icon: string }[] | number;
  relationship?: Relationship;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#be185d', '#0284c7'];

const REL_COLOR: Record<Relationship, string> = {
  stranger:  '#666666',
  connected: '#f97316',
  friend:    '#3b82f6',
};

const REL_LABEL: Record<Relationship, string> = {
  stranger:  'Nearby',
  connected: 'Connected',
  friend:    'Friend',
};

const TEAL = '#00b4a6';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function avatarBg(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + (hash << 5) - hash;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function sharedCount(user: SearchUser): number {
  if (user.shared_interests_count != null) return user.shared_interests_count;
  if (Array.isArray(user.shared_interests)) return user.shared_interests.length;
  if (typeof user.shared_interests === 'number') return user.shared_interests;
  return 0;
}

// ─── User card ────────────────────────────────────────────────────────────────
interface CardProps {
  user: SearchUser;
  hiSent: boolean;
  onSendHi: () => void;
  onMessage: () => void;
  onPress: () => void;
}

function UserCard({ user, hiSent, onSendHi, onMessage, onPress }: CardProps) {
  const bg    = avatarBg(user.username);
  const rel   = user.relationship ?? 'stranger';
  const count = sharedCount(user);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      {/* Avatar */}
      <View style={[styles.avatar, { backgroundColor: bg }]}>
        {user.profile_picture ? (
          <Image source={{ uri: user.profile_picture }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarInitial}>{user.username.charAt(0).toUpperCase()}</Text>
        )}
      </View>

      {/* Info */}
      <View style={styles.cardInfo}>
        <Text style={styles.cardName} numberOfLines={1}>{user.username}</Text>
        <View style={styles.cardMeta}>
          <View style={[styles.relDot, { backgroundColor: REL_COLOR[rel] }]} />
          <Text style={styles.relText}>{REL_LABEL[rel]}</Text>
          {count > 0 && (
            <>
              <Text style={styles.metaSep}>·</Text>
              <Ionicons name="heart" size={10} color={TEAL} />
              <Text style={styles.sharedText}>{count} shared</Text>
            </>
          )}
        </View>
      </View>

      {/* Action */}
      {rel === 'stranger' ? (
        <TouchableOpacity
          style={[styles.actionBtn, hiSent && styles.actionBtnDone]}
          onPress={onSendHi}
          disabled={hiSent}
          activeOpacity={0.75}
          hitSlop={4}
        >
          <Text style={[styles.actionText, hiSent && styles.actionTextDone]}>
            {hiSent ? 'Sent ✓' : '👋 Hi'}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onMessage}
          activeOpacity={0.75}
          hitSlop={4}
        >
          <Text style={styles.actionText}>💬</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function SearchScreen() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();

  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [sentHiIds, setSentHiIds] = useState<Set<number>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef    = useRef<TextInput>(null);

  function handleChange(text: string) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = text.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(trimmed), 400);
  }

  async function doSearch(q: string) {
    setLoading(true);
    setSearched(true);
    try {
      const { data } = await api.get<SearchUser[]>(`/api/users/search/?q=${encodeURIComponent(q)}`);
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function clear() {
    setQuery('');
    setResults([]);
    setSearched(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    inputRef.current?.focus();
  }

  async function sendHi(user: SearchUser) {
    try {
      await api.post('/api/proximity/wave/', { target_id: user.id });
      setSentHiIds((prev) => new Set(prev).add(user.id));
    } catch {}
  }

  function goToProfile(user: SearchUser) {
    router.push({ pathname: '/profile/[id]', params: { id: user.id, username: user.username } });
  }

  function goToMessages(user: SearchUser) {
    router.push({ pathname: '/messages/[id]', params: { id: user.id, username: user.username } });
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  let body: React.ReactNode;

  if (loading) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={TEAL} size="large" />
        <Text style={styles.centerSub}>Searching…</Text>
      </View>
    );
  } else if (!searched) {
    body = (
      <View style={styles.center}>
        <View style={styles.placeholderIcon}>
          <Ionicons name="search" size={32} color={TEAL} />
        </View>
        <Text style={styles.centerTitle}>Find people</Text>
        <Text style={styles.centerSub}>Type a username to search</Text>
      </View>
    );
  } else if (results.length === 0) {
    body = (
      <View style={styles.center}>
        <View style={styles.placeholderIcon}>
          <Ionicons name="person-outline" size={32} color="#2e2e2e" />
        </View>
        <Text style={styles.centerTitle}>No results</Text>
        <Text style={styles.centerSub}>Try a different username</Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={results}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <Text style={styles.resultMeta}>
            {results.length} result{results.length !== 1 ? 's' : ''}
          </Text>
        }
        renderItem={({ item }) => (
          <UserCard
            user={item}
            hiSent={sentHiIds.has(item.id)}
            onSendHi={() => sendHi(item)}
            onMessage={() => goToMessages(item)}
            onPress={() => goToProfile(item)}
          />
        )}
      />
    );
  }

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      {/* ── Search bar ── */}
      <View style={styles.searchBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={TEAL} />
        </TouchableOpacity>

        <View style={styles.inputWrap}>
          <Ionicons name="search-outline" size={16} color="#444" />
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={query}
            onChangeText={handleChange}
            placeholder="Search by username…"
            placeholderTextColor="#2e2e2e"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => query.trim().length >= 2 && doSearch(query.trim())}
          />
          {query.length > 0 && (
            <Pressable onPress={clear} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color="#333" />
            </Pressable>
          )}
        </View>
      </View>

      {body}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },

  // ── Search bar ──
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#161616',
  },
  backBtn: { padding: 4 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  input: { flex: 1, color: '#fff', fontSize: 15 },

  // ── Center states ──
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 60 },
  placeholderIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#0d1f1e',
    borderWidth: 1,
    borderColor: `${TEAL}22`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  centerTitle: { color: '#333', fontSize: 17, fontWeight: '600' },
  centerSub:   { color: '#222', fontSize: 13 },

  // ── List ──
  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 60, gap: 10 },
  resultMeta: {
    color: '#2e2e2e',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },

  // ── Card ──
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },

  // Avatar
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarImage:   { width: 48, height: 48, borderRadius: 24 },
  avatarInitial: { color: '#fff', fontSize: 20, fontWeight: '700' },

  // Info
  cardInfo: { flex: 1, gap: 5 },
  cardName: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  relDot:   { width: 6, height: 6, borderRadius: 3 },
  relText:  { color: '#444', fontSize: 12 },
  metaSep:  { color: '#2a2a2a', fontSize: 12 },
  sharedText: { color: TEAL, fontSize: 12, fontWeight: '500' },

  // Action button
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#0d1f1e',
    borderWidth: 1,
    borderColor: `${TEAL}30`,
    minWidth: 60,
    alignItems: 'center',
  },
  actionBtnDone: {
    backgroundColor: 'transparent',
    borderColor: '#1e1e1e',
  },
  actionText:     { color: TEAL,  fontSize: 13, fontWeight: '600' },
  actionTextDone: { color: '#2e2e2e', fontSize: 13, fontWeight: '500' },
});
