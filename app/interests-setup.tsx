import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { InterestChipIcon } from '@/components/ui/icons';
import { fonts, lightColors as L, radius } from '@/constants/theme';

const BLOB = 300;

interface Interest {
  id: number;
  name: string;
  icon: string;
}

export default function InterestsSetupScreen() {
  const { top, bottom } = useSafeAreaInsets();

  const [interests, setInterests] = useState<Interest[]>([]);
  const [selected, setSelected]   = useState<Set<number>>(new Set());
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [query, setQuery]         = useState('');

  const normalizedQuery  = query.trim().toLowerCase();
  const visibleInterests = normalizedQuery
    ? interests.filter((i) => i.name.toLowerCase().includes(normalizedQuery))
    : interests;

  function loadInterests() {
    setError(null);
    setLoading(true);
    api.get<Interest[]>('/api/interests/')
      .then((r) => setInterests(r.data))
      .catch(() => setError('Could not load interests. Please try again.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadInterests(); }, []);

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
      // Non-fatal — navigate anyway so the user isn't stuck
    } finally {
      setSaving(false);
    }
    router.replace('/onboarding-profession');
  }

  const canContinue = selected.size > 0;

  return (
    <View style={[s.root, { paddingTop: top }]}>
      {/* Decorative blobs */}
      <View style={s.blobTL} />
      <View style={s.blobBR} />

      <View style={s.header}>
        <Text style={s.title}>Choose your interests</Text>
        <Text style={s.subtitle}>Find people who share your passions</Text>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={L.teal} size="large" />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable
            onPress={loadInterests}
            style={({ pressed }) => [s.retryBtn, pressed && s.dimmed]}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={s.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={s.searchBar}>
            <Ionicons name="search" size={18} color={L.t3} />
            <TextInput
              style={s.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search interests..."
              placeholderTextColor={L.t3}
              selectionColor={L.teal}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={10}>
                <Ionicons name="close-circle" size={18} color={L.t3} />
              </Pressable>
            )}
          </View>

          <ScrollView
            contentContainerStyle={s.grid}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={{ backgroundColor: 'transparent' }}
          >
            {visibleInterests.length === 0 && (
              <Text style={s.emptyText}>No interests match "{query.trim()}"</Text>
            )}
            <View style={s.chips}>
              {visibleInterests.map((item) => {
                const sel = selected.has(item.id);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => toggle(item.id)}
                    style={[s.chip, sel && s.chipSelected]}
                  >
                    <InterestChipIcon name={item.name} icon={item.icon} />
                    <Text style={[s.chipLabel, sel && s.chipLabelSelected]}>
                      {item.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </>
      )}

      <View style={[s.footer, { paddingBottom: bottom + 16 }]}>
        <Text style={s.count}>
          {selected.size > 0 ? `${selected.size} selected` : ' '}
        </Text>
        <Pressable
          onPress={handleContinue}
          disabled={!canContinue || saving}
          style={({ pressed }) => [
            s.continueBtn,
            (!canContinue || pressed || saving) && s.dimmed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          {saving
            ? <ActivityIndicator color={L.bg} size="small" />
            : <Text style={s.continueBtnLabel}>Continue</Text>
          }
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: L.bg },

  blobTL: {
    position: 'absolute',
    top: -BLOB * 0.35,
    left: -BLOB * 0.28,
    width: BLOB,
    height: BLOB,
    borderRadius: BLOB / 2,
    backgroundColor: L.surface2,
  },
  blobBR: {
    position: 'absolute',
    bottom: -BLOB * 0.35,
    right: -BLOB * 0.28,
    width: BLOB,
    height: BLOB,
    borderRadius: BLOB / 2,
    backgroundColor: '#E8E4F5',
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },

  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
    gap: 8,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 28,
    color: L.t1,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: L.t2,
    lineHeight: 22,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 14,
    borderRadius: radius.m,
    backgroundColor: L.surface,
    borderWidth: 1,
    borderColor: L.border,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    color: L.t1,
  },

  emptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: L.t3,
    textAlign: 'center',
    marginTop: 32,
  },

  grid: { paddingHorizontal: 20, paddingBottom: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.l,
    backgroundColor: L.surface,
    borderWidth: 1,
    borderColor: L.border,
  },
  chipSelected: {
    backgroundColor: L.tealTint,
    borderColor: L.tealLine,
  },
  chipLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '500',
    color: L.t2,
  },
  chipLabelSelected: {
    color: L.teal,
    fontWeight: '600',
  },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: L.border,
    gap: 8,
  },
  count: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: L.t3,
    textAlign: 'center',
  },

  continueBtn: {
    backgroundColor: L.teal,
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  continueBtnLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 17,
    color: L.bg,
  },

  retryBtn: {
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: L.border,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 14,
    color: L.t1,
  },

  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: L.red,
    textAlign: 'center',
  },

  dimmed: { opacity: 0.5 },
});
