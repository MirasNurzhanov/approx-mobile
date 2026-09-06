import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { Avatar } from '@/components/ui/Avatar';
import type { Presence } from '@/services/presence';
import { Card } from '@/components/ui/Card';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useScreenTopInset } from '@/hooks/useScreenTopInset';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// ─── Types ────────────────────────────────────────────────────────────────────
type Relationship = 'stranger' | 'connected' | 'friend';

interface SearchUser {
  id: number;
  username: string;
  profile_picture?: string;
  shared_interests_count?: number;
  shared_interests?: { name: string; icon: string }[] | number;
  relationship?: Relationship;
  /** Absent when this viewer may not see it — render no indicator, not grey. */
  presence?: Presence;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** A search response that isn't a list means "nothing found" rather than an
 *  error. At module scope because the call site is inside a `try`, and a
 *  ternary there is a "value block" React Compiler cannot lower. */
function listOf(data: unknown): SearchUser[] {
  return Array.isArray(data) ? data : [];
}

function sharedCount(user: SearchUser): number {
  if (user.shared_interests_count != null) return user.shared_interests_count;
  if (Array.isArray(user.shared_interests)) return user.shared_interests.length;
  if (typeof user.shared_interests === 'number') return user.shared_interests;
  return 0;
}

function ringColor(colors: ColorPalette, rel: Relationship): string {
  if (rel === 'friend') return colors.blue;
  if (rel === 'connected') return colors.orange;
  return colors.t3;
}

// ─── Action button ────────────────────────────────────────────────────────────
function ActionBtn({
  rel,
  hiSent,
  onSendHi,
  onMessage,
}: {
  rel: Relationship;
  hiSent: boolean;
  onSendHi: () => void;
  onMessage: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  if (rel !== 'stranger') {
    return (
      <Pressable
        style={({ pressed }) => [styles.actionBtn, styles.actionBtnGhost, pressed && styles.pressed]}
        onPress={onMessage}
        hitSlop={4}
      >
        <Text style={styles.actionBtnGhostText}>Message</Text>
      </Pressable>
    );
  }

  if (hiSent) {
    return (
      <View style={[styles.actionBtn, styles.actionBtnGhost, styles.actionBtnDisabled]}>
        <Text style={styles.actionBtnSentText}>Sent ✓</Text>
      </View>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.actionBtn, styles.actionBtnPrimary, pressed && styles.pressed]}
      onPress={onSendHi}
      hitSlop={4}
    >
      <Text style={styles.actionBtnPrimaryText}>Hi</Text>
    </Pressable>
  );
}

// ─── User result card ─────────────────────────────────────────────────────────
function UserCard({
  user,
  hiSent,
  onSendHi,
  onMessage,
  onPress,
}: {
  user: SearchUser;
  hiSent: boolean;
  onSendHi: () => void;
  onMessage: () => void;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const rel = user.relationship ?? 'stranger';
  const count = sharedCount(user);

  return (
    <Card onPress={onPress}>
      <View style={styles.cardRow}>
        <Avatar
          uri={user.profile_picture}
          name={user.username}
          size="md"
          ringColor={ringColor(colors, rel)}
          presence={user.presence}
        />

        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={1}>{user.username}</Text>
          {count > 0 ? (
            <Text style={styles.cardMeta}>{count} shared interest{count !== 1 ? 's' : ''}</Text>
          ) : (
            <Text style={styles.cardMeta}>Nearby</Text>
          )}
        </View>

        <ActionBtn
          rel={rel}
          hiSent={hiSent}
          onSendHi={onSendHi}
          onMessage={onMessage}
        />
      </View>
    </Card>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function SearchScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const top = useScreenTopInset();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [sentHiIds, setSentHiIds] = useState<Set<number>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Declared before `handleChange`, which captures it in the debounce timer.
  // Hoisting would let it sit below, but React Compiler cannot rewrite a
  // reference to a function hoisted from further down and gives up on the whole
  // screen, so the definition order is load-bearing here.
  async function doSearch(q: string) {
    setLoading(true);
    setSearched(true);
    try {
      const { data } = await api.get<SearchUser[]>(`/api/users/search/?q=${encodeURIComponent(q)}`);
      setResults(listOf(data));
    } catch {
      setResults([]);
    }
    // Reached on both paths: the `catch` empties the list and stops there.
    setLoading(false);
  }

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

  function clear() {
    setQuery('');
    setResults([]);
    setSearched(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    inputRef.current?.focus();
  }

  async function sendHi(user: SearchUser) {
    try {
      await api.post(`/api/friends/hi/${user.id}/`);
      setSentHiIds((prev) => new Set(prev).add(user.id));
    } catch (e: any) {
      console.log('[Hi] error:', e?.response?.status, JSON.stringify(e?.response?.data));
    }
  }

  function goToProfile(user: SearchUser) {
    router.push({ pathname: '/profile/[id]', params: { id: user.id, username: user.username } });
  }

  function goToMessages(user: SearchUser) {
    router.push({ pathname: '/messages/[id]', params: { id: user.id, username: user.username } });
  }

  // ─── Body ─────────────────────────────────────────────────────────────────
  function renderBody() {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} />
        </View>
      );
    }

    if (!searched || query.trim().length < 2) {
      return (
        <View style={styles.center}>
          <Text style={styles.idleText}>Search for people by username</Text>
        </View>
      );
    }

    if (results.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.idleText}>No results for "{query.trim()}"</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={results}
        keyExtractor={(item) => String(item.id)}
        windowSize={5}
        initialNumToRender={8}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // Required by `headerSearchBarOptions`: it is what lets UIKit inset the
        // list for the search bar and collapse it as the list scrolls.
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <Text style={styles.resultsLabel}>
            {results.length} RESULT{results.length !== 1 ? 'S' : ''}
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
      <ScreenHeader
        title="Search"
        search={{
          placeholder: 'Search by username…',
          autoFocus: true,
          onChangeText: handleChange,
          onSubmit: (text) => text.trim().length >= 2 && doSearch(text.trim()),
          onCancel: clear,
        }}
      >
        {/* Search bar */}
        <View style={styles.searchBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.t1} />
          </Pressable>

          <GlassSurface style={[styles.inputPill, focused && styles.inputPillFocused]}>
            <Ionicons name="search-outline" size={16} color={colors.t3} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={query}
              onChangeText={handleChange}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Search by username…"
              placeholderTextColor={colors.t3}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => query.trim().length >= 2 && doSearch(query.trim())}
            />
            {query.length > 0 && (
              <Pressable onPress={clear} hitSlop={8}>
                <Ionicons name="close-outline" size={20} color={colors.t3} />
              </Pressable>
            )}
          </GlassSurface>
        </View>
      </ScreenHeader>

      {renderBody()}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // Search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  // No `backgroundColor`: the fill is drawn behind the row by `GlassBackdrop`,
  // and a background here would sit on top of the blur and hide it.
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  inputPillFocused: { borderColor: colors.teal },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t1,
  },

  // Center states
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  idleText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t3,
  },

  // List
  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 60, gap: 8 },
  resultsLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    marginBottom: 8,
  },

  // Card row
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardInfo: { flex: 1, gap: 4 },
  cardName: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: colors.t1,
  },
  cardMeta: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
  },

  // Action button
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.s,
    alignItems: 'center',
    minWidth: 72,
  },
  actionBtnPrimary: {
    backgroundColor: colors.teal,
  },
  actionBtnPrimaryText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 13,
    color: colors.bg,
  },
  actionBtnGhost: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  actionBtnGhostText: {
    fontFamily: fonts.body,
    fontWeight: '500',
    fontSize: 13,
    color: colors.t2,
  },
  actionBtnDisabled: { opacity: 0.7 },
  actionBtnSentText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 13,
    color: colors.teal,
  },

  pressed: { opacity: 0.6 },
});
