import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { Speedometer } from '@/components/Speedometer';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Quest {
  id: number;
  title: string;
  description?: string;
  reward_points?: number;
  quest_type?: 'daily' | 'weekly' | string;
  condition_type?: string;
  completed?: boolean;
  is_completed?: boolean;
}

interface Profile {
  aura_points?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isCompleted(q: Quest): boolean {
  return !!(q.completed || q.is_completed);
}

function isFriendQuest(q: Quest): boolean {
  return q.condition_type === 'meet_friend_in_person';
}

// ─── QuestCard ────────────────────────────────────────────────────────────────
function QuestCard({
  quest,
  onVerify,
  verifying,
}: {
  quest: Quest;
  onVerify: (id: number) => void;
  verifying: boolean;
}) {
  const done = isCompleted(quest);
  const friend = isFriendQuest(quest);
  const points = quest.reward_points ?? 0;

  return (
    <View style={[styles.card, done && styles.cardDone]}>
      <View style={styles.cardBody}>
        {/* Left: icon */}
        <View style={[styles.questIconWrap, done && styles.questIconWrapDone]}>
          {done ? (
            <Ionicons name="checkmark" size={18} color="#00b4a6" />
          ) : friend ? (
            <Text style={styles.questEmoji}>📍</Text>
          ) : (
            <Ionicons name="flash-outline" size={18} color="#00b4a6" />
          )}
        </View>

        {/* Center: title + desc */}
        <View style={styles.cardInfo}>
          <Text style={[styles.cardTitle, done && styles.cardTitleDone]} numberOfLines={2}>
            {quest.title}
          </Text>
          {quest.description ? (
            <Text style={[styles.cardDesc, done && styles.cardDescDone]} numberOfLines={2}>
              {quest.description}
            </Text>
          ) : null}
        </View>

        {/* Right: points */}
        <View style={styles.pointsBadge}>
          <Text style={styles.pointsIcon}>◉</Text>
          <Text style={styles.pointsValue}>+{points}</Text>
        </View>
      </View>

      {/* Verify button — only for incomplete friend quests */}
      {friend && !done && (
        <TouchableOpacity
          style={[styles.verifyBtn, verifying && styles.verifyBtnOff]}
          onPress={() => onVerify(quest.id)}
          disabled={verifying}
          activeOpacity={0.75}
        >
          {verifying ? (
            <ActivityIndicator color="#0a0a0a" size="small" />
          ) : (
            <Text style={styles.verifyText}>Verify Meetup 📍</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────
function Section({ title, quests, onVerify, verifyingId }: {
  title: string;
  quests: Quest[];
  onVerify: (id: number) => void;
  verifyingId: number | null;
}) {
  if (quests.length === 0) return null;
  const done = quests.filter(isCompleted).length;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionProgress}>{done}/{quests.length}</Text>
      </View>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { flex: done / quests.length }]} />
        <View style={{ flex: 1 - done / quests.length }} />
      </View>
      <View style={styles.cardList}>
        {quests.map((q) => (
          <QuestCard
            key={q.id}
            quest={q}
            onVerify={onVerify}
            verifying={verifyingId === q.id}
          />
        ))}
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function QuestsScreen() {
  const { top, bottom } = useSafeAreaInsets();

  const [quests, setQuests] = useState<Quest[]>([]);
  const [auraPoints, setAuraPoints] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);

  async function fetchAll() {
    const [questsRes, profileRes] = await Promise.allSettled([
      api.get<Quest[]>('/api/quests/'),
      api.get<Profile>('/api/users/profile/'),
    ]);

    if (questsRes.status === 'fulfilled') {
      const data = questsRes.value.data;
      console.log('[Quests] raw response:', JSON.stringify(data).slice(0, 500));
      let list: Quest[] = [];
      if (Array.isArray(data)) {
        list = data;
      } else if (data && typeof data === 'object') {
        const wrapped = (data as any).results ?? (data as any).quests ?? (data as any).data ?? [];
        list = Array.isArray(wrapped) ? wrapped : [];
      }
      console.log('[Quests] quests count:', list.length);
      setQuests(list);
    } else {
      console.log('[Quests] fetch error:', questsRes.reason?.response?.status, JSON.stringify(questsRes.reason?.response?.data));
    }

    if (profileRes.status === 'fulfilled') {
      setAuraPoints(profileRes.value.data.aura_points ?? 0);
    }
  }

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, []);

  async function handleVerify(id: number) {
    setVerifyingId(id);
    try {
      await api.post(`/api/quests/${id}/verify-meetup/`);
      // Mark quest complete locally and refresh points
      setQuests((prev) =>
        prev.map((q) => (q.id === id ? { ...q, completed: true, is_completed: true } : q))
      );
      const { data } = await api.get<Profile>('/api/users/profile/');
      setAuraPoints(data.aura_points ?? 0);
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? 'Could not verify meetup. Make sure you\'re nearby.';
      Alert.alert('Verification Failed', msg);
    } finally {
      setVerifyingId(null);
    }
  }

  const daily = quests.filter((q) => q.quest_type === 'daily' && !isFriendQuest(q));
  const weekly = quests.filter((q) => q.quest_type === 'weekly' && !isFriendQuest(q));
  const friend = quests.filter(isFriendQuest);

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color="#00b4a6" size="large" />
        <Speedometer />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: top + 20, paddingBottom: bottom + 110 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00b4a6" />
        }
      >
        {/* ── Header ── */}
        <View style={styles.pageHeader}>
          <View>
            <Text style={styles.pageTitle}>Quests</Text>
            <Text style={styles.pageSubtitle}>Complete challenges, earn Aura Points</Text>
          </View>
          <View style={styles.auraOrb}>
            <Text style={styles.auraOrbIcon}>◉</Text>
            <Text style={styles.auraOrbValue}>
              {auraPoints != null ? auraPoints.toLocaleString() : '—'}
            </Text>
          </View>
        </View>

        {quests.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyIcon}>◉</Text>
            <Text style={styles.emptyTitle}>No quests available</Text>
            <Text style={styles.emptySub}>Check back soon for new challenges</Text>
          </View>
        ) : (
          <>
            <Section
              title="Daily Quests"
              quests={daily}
              onVerify={handleVerify}
              verifyingId={verifyingId}
            />
            <Section
              title="Weekly Quests"
              quests={weekly}
              onVerify={handleVerify}
              verifyingId={verifyingId}
            />
            <Section
              title="Friend Quests"
              quests={friend}
              onVerify={handleVerify}
              verifyingId={verifyingId}
            />
          </>
        )}
      </ScrollView>

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20 },

  // ── Page header ──
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  pageTitle: { color: '#ffffff', fontSize: 26, fontWeight: '700' },
  pageSubtitle: { color: '#444', fontSize: 13, marginTop: 3 },

  auraOrb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#140d1f',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#8b5cf620',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  auraOrbIcon: { color: '#8b5cf6', fontSize: 15 },
  auraOrbValue: { color: '#8b5cf6', fontSize: 15, fontWeight: '700' },

  // ── Section ──
  section: { marginBottom: 28 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#444',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  sectionProgress: { color: '#2e2e2e', fontSize: 11 },

  progressBar: {
    flexDirection: 'row',
    height: 2,
    backgroundColor: '#141414',
    borderRadius: 1,
    marginBottom: 14,
    overflow: 'hidden',
  },
  progressFill: { backgroundColor: '#00b4a6', borderRadius: 1 },

  cardList: { gap: 10 },

  // ── Card ──
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    overflow: 'hidden',
  },
  cardDone: { opacity: 0.55 },

  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },

  questIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#0d1f1e',
    borderWidth: 1,
    borderColor: '#00b4a620',
    alignItems: 'center',
    justifyContent: 'center',
  },
  questIconWrapDone: {
    backgroundColor: '#0d1f1e',
    borderColor: '#00b4a640',
  },
  questEmoji: { fontSize: 18 },

  cardInfo: { flex: 1 },
  cardTitle: { color: '#e0e0e0', fontSize: 14, fontWeight: '600', lineHeight: 19 },
  cardTitleDone: { color: '#444' },
  cardDesc: { color: '#555', fontSize: 12, marginTop: 3, lineHeight: 17 },
  cardDescDone: { color: '#2e2e2e' },

  pointsBadge: { alignItems: 'center' },
  pointsIcon: { color: '#8b5cf6', fontSize: 11 },
  pointsValue: { color: '#8b5cf6', fontSize: 13, fontWeight: '700' },

  // ── Verify button ──
  verifyBtn: {
    marginHorizontal: 14,
    marginBottom: 14,
    paddingVertical: 11,
    borderRadius: 11,
    backgroundColor: '#00b4a6',
    alignItems: 'center',
  },
  verifyBtnOff: { opacity: 0.6 },
  verifyText: { color: '#0a0a0a', fontSize: 14, fontWeight: '700' },

  // ── Empty ──
  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyIcon: { color: '#1e1e1e', fontSize: 48 },
  emptyTitle: { color: '#333', fontSize: 16, fontWeight: '600' },
  emptySub: { color: '#222', fontSize: 13 },
});
