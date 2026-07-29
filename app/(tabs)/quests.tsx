import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { api } from '@/services/api';
import { buildAttestation } from '@/services/attestation';
import { useScrollHandler } from '@/hooks/useScrollHandler';
import { Leaderboard } from '@/components/Leaderboard';
import { usePermissionPrimer } from '@/components/PermissionPrimer';
import { Speedometer } from '@/components/Speedometer';

// ─── Types ────────────────────────────────────────────────────────────────────
type ProofStatus = 'pending' | 'approved' | 'rejected';

interface Quest {
  id: number;
  title: string;
  description?: string;
  reward_points?: number;
  quest_type?: 'daily' | 'weekly' | string;
  condition_type?: string;
  completed?: boolean;
  is_completed?: boolean;
  proof_status?: ProofStatus | null;
  proof_rejection_reason?: string | null;
}

interface Profile {
  aura_points?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isCompleted(q: Quest): boolean {
  return !!(q.completed || q.is_completed);
}

// ─── QuestCard ────────────────────────────────────────────────────────────────
function QuestCard({
  quest,
  onSubmitProof,
  submitting,
}: {
  quest: Quest;
  onSubmitProof: (quest: Quest) => void;
  submitting: boolean;
}) {
  const done = isCompleted(quest);
  const points = quest.reward_points ?? 0;
  const pending = quest.proof_status === 'pending';
  const rejected = quest.proof_status === 'rejected';

  return (
    <View style={[styles.card, done && styles.cardDone]}>
      <View style={styles.cardBody}>
        {/* Left: icon */}
        <View style={[styles.questIconWrap, done && styles.questIconWrapDone]}>
          {done ? (
            <Ionicons name="checkmark" size={18} color="#00b4a6" />
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

      {/* Photo proof flow — daily/weekly quests complete via camera only */}
      {!done && pending && (
        <View style={styles.reviewPill}>
          <Ionicons name="time-outline" size={13} color="#c9a227" />
          <Text style={styles.reviewPillText}>Photo under review</Text>
        </View>
      )}
      {!done && rejected && quest.proof_rejection_reason ? (
        <Text style={styles.rejectionText} numberOfLines={2}>
          Rejected: {quest.proof_rejection_reason}
        </Text>
      ) : null}
      {!done && !pending && (
        <TouchableOpacity
          style={[styles.verifyBtn, submitting && styles.verifyBtnOff]}
          onPress={() => onSubmitProof(quest)}
          disabled={submitting}
          activeOpacity={0.75}
        >
          {submitting ? (
            <ActivityIndicator color="#0a0a0a" size="small" />
          ) : (
            <Text style={styles.verifyText}>
              {rejected ? 'Try again with a new photo 📷' : 'Complete with photo 📷'}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────
function Section({ title, quests, onSubmitProof, submittingId }: {
  title: string;
  quests: Quest[];
  onSubmitProof: (quest: Quest) => void;
  submittingId: number | null;
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
            onSubmitProof={onSubmitProof}
            submitting={submittingId === q.id}
          />
        ))}
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function QuestsScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const scrollProps = useScrollHandler();

  const [quests, setQuests] = useState<Quest[]>([]);
  const [auraPoints, setAuraPoints] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [cameraDenied, setCameraDenied] = useState(false);
  const { ensure: ensurePermission, primer } = usePermissionPrimer();
  const [activeTab, setActiveTab] = useState<'quests' | 'leaderboard'>('quests');

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

  // Quest proof is camera-only by design: no gallery picker exists in this
  // flow, and the server rejects stale-EXIF photos anyway.
  async function handleSubmitProof(quest: Quest) {
    // Primed: the sheet explains that quests are verified from a live photo
    // before the OS dialog appears, so a refusal is an informed one.
    if (!(await ensurePermission('camera'))) {
      setCameraDenied(true);
      return;
    }
    setCameraDenied(false);

    // Full quality, no editing — recompression/cropping can strip the EXIF
    // the server needs to check the capture time.
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'] as any,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;

    setSubmittingId(quest.id);
    try {
      const uri = result.assets[0].uri;
      const form = new FormData();
      form.append('image', {
        uri,
        name: uri.split('/').pop() ?? 'proof.jpg',
        type: 'image/jpeg',
      } as any);

      // Proves this upload came from a genuine, unmodified build — the only
      // thing that distinguishes a camera shot from a gallery pick, since the
      // EXIF is identical. Never throws; the server decides how strict to be.
      const attestation = await buildAttestation();
      for (const [key, value] of Object.entries(attestation)) {
        if (value) form.append(key, value);
      }

      await api.post(`/api/quests/${quest.id}/submit-proof/`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setQuests((prev) =>
        prev.map((q) =>
          q.id === quest.id ? { ...q, proof_status: 'pending', proof_rejection_reason: null } : q,
        ),
      );
    } catch (e: any) {
      Alert.alert(
        'Submission failed',
        e?.response?.data?.detail ?? 'Could not upload your photo. Please try again.',
      );
    } finally {
      setSubmittingId(null);
    }
  }

  const daily = quests.filter((q) => q.quest_type === 'daily');
  const weekly = quests.filter((q) => q.quest_type === 'weekly');

  return (
    <View style={styles.root}>
      <View style={styles.contentArea} pointerEvents="none">
      {/* ── Header (shared by both tabs) ── */}
      <View style={[styles.pageHeader, { paddingTop: top + 20 }]}>
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

      {/* ── Tabs ── */}
      <View style={styles.tabBar}>
        {(['quests', 'leaderboard'] as const).map((tab) => {
          const isActive = activeTab === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {tab === 'quests' ? 'Quests' : 'Leaderboard'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {activeTab === 'leaderboard' ? (
        <Leaderboard bottomInset={bottom} scrollProps={scrollProps} />
      ) : loading ? (
        // Scoped to this tab so a slow quests fetch never blocks the leaderboard.
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator color="#00b4a6" size="large" />
        </View>
      ) : (
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: 16, paddingBottom: bottom + 110 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00b4a6" />
        }
        {...scrollProps}
      >
        {/* Camera permission denied — quests need the camera, explain how to fix */}
        {cameraDenied && (
          <View style={styles.cameraBanner}>
            <Ionicons name="camera-outline" size={18} color="#e5484d" />
            <Text style={styles.cameraBannerText}>
              Quests are completed with a live photo, but camera access is off. Enable it in
              Settings to continue.
            </Text>
            <TouchableOpacity onPress={() => Linking.openSettings()} hitSlop={8}>
              <Text style={styles.cameraBannerAction}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        )}

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
              onSubmitProof={handleSubmitProof}
              submittingId={submittingId}
            />
            <Section
              title="Weekly Quests"
              quests={weekly}
              onSubmitProof={handleSubmitProof}
              submittingId={submittingId}
            />
          </>
        )}
      </ScrollView>
      )}
      </View>

      {primer}

      <Speedometer />

      {/* Coming Soon overlay */}
      <View style={styles.comingSoonOverlay} pointerEvents="none">
        <Text style={styles.comingSoonTitle}>Quests — Coming Soon 🔒</Text>
        <Text style={styles.comingSoonSubtitle}>We're working on something exciting</Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  contentArea: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20 },

  // ── Page header ──
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 18,
  },

  // ── Tabs (Quests / Leaderboard) ──
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e1e1e',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: '#00b4a6' },
  tabLabel: { color: '#444', fontSize: 13, fontWeight: '600' },
  tabLabelActive: { color: '#ffffff' },
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

  cardInfo: { flex: 1 },
  cardTitle: { color: '#e0e0e0', fontSize: 14, fontWeight: '600', lineHeight: 19 },
  cardTitleDone: { color: '#444' },
  cardDesc: { color: '#555', fontSize: 12, marginTop: 3, lineHeight: 17 },
  cardDescDone: { color: '#2e2e2e' },

  pointsBadge: { alignItems: 'center' },
  pointsIcon: { color: '#8b5cf6', fontSize: 11 },
  pointsValue: { color: '#8b5cf6', fontSize: 13, fontWeight: '700' },

  // ── Photo proof states ──
  reviewPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 14,
    marginBottom: 14,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: '#1f1a0d',
    borderWidth: 1,
    borderColor: '#c9a22730',
  },
  reviewPillText: { color: '#c9a227', fontSize: 13, fontWeight: '600' },
  rejectionText: {
    color: '#e5484d',
    fontSize: 12,
    lineHeight: 16,
    marginHorizontal: 14,
    marginBottom: 10,
  },

  // ── Camera permission banner ──
  cameraBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1f0d0e',
    borderWidth: 1,
    borderColor: '#e5484d30',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  cameraBannerText: { flex: 1, color: '#e0e0e0', fontSize: 12, lineHeight: 17 },
  cameraBannerAction: { color: '#e5484d', fontSize: 13, fontWeight: '700' },

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

  // ── Coming Soon overlay ──
  comingSoonOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 10, 10, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    gap: 10,
  },
  comingSoonTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  comingSoonSubtitle: {
    color: '#555',
    fontSize: 14,
    textAlign: 'center',
  },

  // ── Empty ──
  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyIcon: { color: '#1e1e1e', fontSize: 48 },
  emptyTitle: { color: '#333', fontSize: 16, fontWeight: '600' },
  emptySub: { color: '#222', fontSize: 13 },
});
