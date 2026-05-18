import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/services/api';
import { ParticleBackground } from '@/components/ParticleBackground';

interface Interest {
  id: number;
  name: string;
  icon: string;
}

export default function InterestsSetupScreen() {
  const { top, bottom } = useSafeAreaInsets();

  const [interests, setInterests] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Interest[]>('/api/interests/')
      .then((r) => setInterests(r.data))
      .catch(() => setError('Could not load interests. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleContinue() {
    setSaving(true);
    try {
      await api.post('/api/interests/select/', { interest_ids: Array.from(selected) });
    } catch {
      // Non-fatal — still navigate so the user isn't stuck
    } finally {
      setSaving(false);
    }
    router.replace('/(tabs)/map');
  }

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <ParticleBackground />
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Your Interests</Text>
        <Text style={styles.subtitle}>
          Choose what you care about to find people like you
        </Text>
      </View>

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#00b4a6" size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setError(null);
              setLoading(true);
              api.get<Interest[]>('/api/interests/')
                .then((r) => setInterests(r.data))
                .catch(() => setError('Could not load interests. Please try again.'))
                .finally(() => setLoading(false));
            }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.bubbleContainer}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.bubbleWrap}>
            {interests.map((item) => {
              const isSelected = selected.has(item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.bubble, isSelected && styles.bubbleSelected]}
                  onPress={() => toggle(item.id)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.bubbleIcon}>{item.icon}</Text>
                  <Text style={[styles.bubbleName, isSelected && styles.bubbleNameSelected]}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: bottom + 20 }]}>
        {selected.size > 0 && (
          <Text style={styles.countLabel}>{selected.size} selected</Text>
        )}
        <TouchableOpacity
          style={[styles.continueBtn, saving && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.continueBtnText}>
              {selected.size === 0 ? 'Skip for now' : 'Continue'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  // ── Header ──
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: '#555',
    fontSize: 14,
    lineHeight: 20,
  },

  // ── Bubbles ──
  bubbleContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  bubbleWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 50,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  bubbleSelected: {
    backgroundColor: '#0d2420',
    borderColor: '#00b4a6',
    shadowColor: '#00b4a6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  bubbleIcon: { fontSize: 18 },
  bubbleName: { color: '#666', fontSize: 14, fontWeight: '500' },
  bubbleNameSelected: { color: '#00b4a6', fontWeight: '600' },

  // ── Footer ──
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#141414',
    gap: 10,
  },
  countLabel: {
    color: '#00b4a6',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
  continueBtn: {
    backgroundColor: '#00b4a6',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#00b4a6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  continueBtnDisabled: { opacity: 0.6 },
  continueBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.4 },

  // ── Error ──
  errorText: { color: '#e55', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#00b4a6',
  },
  retryText: { color: '#00b4a6', fontSize: 14, fontWeight: '600' },
});
