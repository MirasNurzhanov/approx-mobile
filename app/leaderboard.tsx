import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface LeaderboardEntry {
  rank: number;
  username: string;
  total_points?: number;
  profile_picture?: string;
}

interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  my_rank: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TEAL = '#00b4a6';
const AVATAR_COLORS = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#be185d', '#0284c7'];

const MEDAL: Record<1 | 2 | 3, { color: string; label: string; bg: string; h: number; avatarSize: number }> = {
  1: { color: '#f59e0b', label: '🥇', bg: '#1a1300', h: 168, avatarSize: 70 },
  2: { color: '#94a3b8', label: '🥈', bg: '#101418', h: 140, avatarSize: 56 },
  3: { color: '#b45309', label: '🥉', bg: '#150e00', h: 128, avatarSize: 50 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function avatarBg(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + (hash << 5) - hash;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function fmtPoints(n?: number): string {
  return (n ?? 0).toLocaleString();
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ username, picture, size }: { username: string; picture?: string; size: number }) {
  const bg = avatarBg(username);
  const r = size / 2;
  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {picture ? (
        <Image source={{ uri: picture }} style={{ width: size, height: size, borderRadius: r }} />
      ) : (
        <Text style={{ color: '#fff', fontSize: size * 0.38, fontWeight: '700' }}>
          {username.charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

// ─── Podium Card ──────────────────────────────────────────────────────────────
function PodiumCard({ entry, isMe }: { entry: LeaderboardEntry; isMe: boolean }) {
  const rank = entry.rank as 1 | 2 | 3;
  const m = MEDAL[rank];
  const ringSize = m.avatarSize + 12;

  return (
    <View style={[
      styles.podiumCard,
      { height: m.h, backgroundColor: m.bg, borderColor: m.color + '45' },
      isMe && styles.podiumCardMe,
    ]}>
      <Text style={styles.podiumMedal}>{m.label}</Text>

      <View style={[
        styles.podiumRing,
        { width: ringSize, height: ringSize, borderRadius: ringSize / 2, borderColor: m.color + '70' },
      ]}>
        <Avatar username={entry.username} picture={entry.profile_picture} size={m.avatarSize} />
      </View>

      <Text style={[styles.podiumName, isMe && { color: TEAL }]} numberOfLines={1}>
        {entry.username}
      </Text>

      <View style={styles.podiumPointsRow}>
        <Text style={[styles.podiumPointsIcon, { color: m.color }]}>◉</Text>
        <Text style={[styles.podiumPoints, { color: m.color }]}>{fmtPoints(entry.total_points)}</Text>
      </View>
    </View>
  );
}

// ─── Rank Row ─────────────────────────────────────────────────────────────────
function RankRow({ entry, isMe }: { entry: LeaderboardEntry; isMe: boolean }) {
  return (
    <View style={[styles.row, isMe && styles.rowMe]}>
      <Text style={[styles.rowRank, isMe && styles.rowRankMe]}>#{entry.rank}</Text>
      <Avatar username={entry.username} picture={entry.profile_picture} size={40} />
      <Text style={[styles.rowName, isMe && styles.rowNameMe]} numberOfLines={1}>
        {entry.username}
      </Text>
      <View style={styles.rowPointsWrap}>
        <Text style={[styles.rowPointsIcon, isMe && styles.rowPointsIconMe]}>◉</Text>
        <Text style={[styles.rowPoints, isMe && styles.rowPointsMe]}>
          {fmtPoints(entry.total_points)}
        </Text>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function LeaderboardScreen() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        console.log('[Leaderboard] fetching...');
        const [lbRes] = await Promise.allSettled([
          api.get<LeaderboardResponse>('/api/quests/leaderboard/'),
        ]);

        if (lbRes.status === 'fulfilled') {
          const data = lbRes.value.data;
          console.log('[Leaderboard] response:', JSON.stringify(data));
          const { leaderboard, my_rank } = data;
          setEntries(leaderboard ?? []);
          setMyRank(my_rank ?? null);
        } else {
          const err = lbRes.reason;
          console.log('[Leaderboard] error:', err?.response?.status, err?.message);
          setError(true);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: top }]}>
        <ActivityIndicator color={TEAL} size="large" />
        <Text style={styles.loadingText}>Loading rankings…</Text>
      </View>
    );
  }

  // ── Data prep ────────────────────────────────────────────────────────────────
  const top3 = entries.filter((e) => e.rank <= 3).sort((a, b) => a.rank - b.rank);
  const rest  = entries.filter((e) => e.rank > 3);

  // Podium visual order: silver | gold | bronze
  const podiumOrder = [
    top3.find((e) => e.rank === 2),
    top3.find((e) => e.rank === 1),
    top3.find((e) => e.rank === 3),
  ].filter((e): e is LeaderboardEntry => e != null);

  const inList    = myRank != null && entries.some((e) => e.rank === myRank);
  const showBanner = !inList && myRank != null;

  // ── Header & empty state ──────────────────────────────────────────────────────
  const Header = (
    <View style={[styles.header, { paddingTop: top + 4 }]}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={26} color={TEAL} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Leaderboard</Text>
      <View style={{ width: 34 }} />
    </View>
  );

  if (error || entries.length === 0) {
    return (
      <View style={[styles.root, { paddingTop: top }]}>
        {Header}
        <View style={[styles.center, { flex: 1 }]}>
          <View style={styles.emptyIcon}>
            <Ionicons name="trophy-outline" size={32} color={TEAL} />
          </View>
          <Text style={styles.emptyTitle}>{error ? 'Could not load' : 'No rankings yet'}</Text>
          <Text style={styles.emptySub}>
            {error
              ? 'Check your connection and try again.'
              : 'Start earning Aura Points to appear here.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {Header}

      <FlatList
        data={rest}
        keyExtractor={(item) => String(item.rank)}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: bottom + (showBanner ? 100 : 24) },
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* ── Podium ── */}
            {podiumOrder.length > 0 && (
              <View style={styles.podiumWrap}>
                {podiumOrder.map((e) => (
                  <PodiumCard key={e.rank} entry={e} isMe={e.rank === myRank} />
                ))}
              </View>
            )}

            {/* ── Section divider ── */}
            {rest.length > 0 && (
              <Text style={styles.rankSectionLabel}>Rankings</Text>
            )}
          </>
        }
        renderItem={({ item }) => <RankRow entry={item} isMe={item.rank === myRank} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* ── My rank banner (shown only when outside top list) ── */}
      {showBanner && (
        <View style={[styles.myRankBanner, { paddingBottom: bottom + 16 }]}>
          <View style={styles.myRankInner}>
            <Text style={styles.myRankLabel}>Your rank</Text>
            <Text style={styles.myRankNum}>#{myRank}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10 },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#161616',
  },
  backBtn: { padding: 4 },
  headerTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700' },

  // ── Loading / empty ──
  loadingText: { color: '#444', fontSize: 14, marginTop: 12 },
  emptyIcon: {
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
  emptyTitle: { color: '#555', fontSize: 17, fontWeight: '600' },
  emptySub:  { color: '#333', fontSize: 13, textAlign: 'center', maxWidth: 260 },

  // ── List ──
  listContent: { paddingHorizontal: 16, paddingTop: 8 },

  // ── Podium ──
  podiumWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    marginBottom: 24,
  },
  podiumCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 14,
    paddingHorizontal: 6,
    gap: 6,
  },
  podiumCardMe: {
    borderColor: TEAL,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  podiumMedal: { fontSize: 22, marginBottom: 2, marginTop: 12 },
  podiumRing: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  podiumName: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    maxWidth: '100%',
  },
  podiumPointsRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  podiumPointsIcon: { fontSize: 11, fontWeight: '700' },
  podiumPoints:     { fontSize: 12, fontWeight: '700' },

  // ── Section label ──
  rankSectionLabel: {
    color: '#444',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  // ── Rank row ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  rowMe: {
    backgroundColor: '#071a19',
    borderColor: `${TEAL}55`,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  rowRank: {
    color: '#2e2e2e',
    fontSize: 13,
    fontWeight: '700',
    width: 34,
    textAlign: 'right',
  },
  rowRankMe: { color: TEAL },
  rowName: { flex: 1, color: '#ddd', fontSize: 14, fontWeight: '600' },
  rowNameMe: { color: '#ffffff' },
  rowPointsWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowPointsIcon: { color: '#8b5cf6', fontSize: 13, fontWeight: '700' },
  rowPointsIconMe: { color: '#a78bfa' },
  rowPoints: { color: '#8b5cf6', fontSize: 13, fontWeight: '700' },
  rowPointsMe: { color: '#a78bfa' },

  separator: { height: 8 },

  // ── My rank banner ──
  myRankBanner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#071a19',
    borderTopWidth: 1,
    borderTopColor: `${TEAL}30`,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  myRankInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  myRankLabel:  { color: '#555', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  myRankRight:  { flexDirection: 'row', alignItems: 'center', gap: 14 },
  myRankNum:    { color: TEAL, fontSize: 20, fontWeight: '700' },
  myRankPointsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  myRankIcon:   { color: '#8b5cf6', fontSize: 14, fontWeight: '700' },
  myRankPoints: { color: '#8b5cf6', fontSize: 14, fontWeight: '700' },
});
