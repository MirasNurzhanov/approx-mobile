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
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { ParticleBackground } from '@/components/ParticleBackground';

interface Interest {
  id: number;
  name: string;
  icon: string;
}

export default function EditInterestsScreen() {
  const { top, bottom } = useSafeAreaInsets();

  const [interests, setInterests] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [initialSelected, setInitialSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setLoading(true);
    console.log('[Interests] fetching from:', '/api/interests/');
    try {
      const [allRes, profileRes] = await Promise.all([
        api.get<Interest[]>('/api/interests/'),
        api.get<{ interests?: { name: string; icon: string }[] }>('/api/users/profile/'),
      ]);
      const all = allRes.data;
      console.log('[Interests] loaded:', all.length, 'interests');
      const currentNames = new Set((profileRes.data.interests ?? []).map((i) => i.name));
      const preSelected = new Set(all.filter((i) => currentNames.has(i.name)).map((i) => i.id));
      setInterests(all);
      setSelected(preSelected);
      setInitialSelected(preSelected);
    } catch (error: any) {
      console.log('[Interests] fetch error:', error.response?.status, error.message);
      setError('Could not load interests. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSave() {
    const selectedIds = Array.from(selected);
    const currentSelected = Array.from(initialSelected);
    const toDeselect = interests.filter((i) => initialSelected.has(i.id)).map((i) => i.id);
    const toSelect = selectedIds;

    console.log('[Interests] currently selected:', currentSelected);
    console.log('[Interests] new selection:', selectedIds);
    console.log('[Interests] to deselect:', toDeselect);
    console.log('[Interests] to select:', toSelect);

    setSaving(true);
    try {
      await Promise.all(
        toDeselect.map(async (id) => {
          console.log('[Interests] calling URL: DELETE', `/api/interests/${id}/select/`);
          try {
            const res = await api.delete(`/api/interests/${id}/select/`);
            console.log('[Interests] DELETE', id, '→ status:', res.status);
          } catch (e: any) {
            console.log('[Interests] DELETE', id, '→ error:', e.response?.status, JSON.stringify(e.response?.data));
          }
        })
      );
      for (const id of toSelect) {
        console.log('[Interests] calling URL: POST', `/api/interests/${id}/select/`);
        try {
          const res = await api.post(`/api/interests/${id}/select/`);
          console.log('[Interests] POST', id, '→ status:', res.status);
        } catch (e: any) {
          console.log('[Interests] POST', id, '→ error:', e.response?.status, JSON.stringify(e.response?.data));
          throw e;
        }
      }
      router.back();
    } catch (error: any) {
      console.log('[Interests] error:', error.response?.status, JSON.stringify(error.response?.data));
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <ParticleBackground />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Edit Interests</Text>
          <Text style={styles.subtitle}>Choose what you care about</Text>
        </View>
      </View>

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#00b4a6" size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
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
      {!loading && !error && (
        <View style={[styles.footer, { paddingBottom: bottom + 20 }]}>
          {selected.size > 0 && (
            <Text style={styles.countLabel}>{selected.size} selected</Text>
          )}
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#555', fontSize: 13, marginTop: 2 },

  bubbleContainer: { paddingHorizontal: 20, paddingBottom: 16 },
  bubbleWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
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

  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#141414',
    gap: 10,
  },
  countLabel: { color: '#00b4a6', fontSize: 13, textAlign: 'center', fontWeight: '500' },
  saveBtn: {
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
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.4 },

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
