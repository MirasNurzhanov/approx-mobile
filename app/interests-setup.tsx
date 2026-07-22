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
import { Button } from '@/components/ui/Button';
import {
  InterestChipIcon,
  OtherInterestSheet,
  type OtherInterestResult,
} from '@/components/OtherInterestSheet';
import { colors, fonts, radius } from '@/constants/theme';

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
  const [query, setQuery] = useState('');
  const [otherVisible, setOtherVisible] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();
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

  async function handleOtherAdd({ name, matched }: OtherInterestResult) {
    const existing = interests.find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setSelected((prev) => new Set(prev).add(existing.id));
      setQuery('');
      return;
    }
    try {
      const { data } = await api.post<Interest>('/api/interests/other/', { name, matched });
      setInterests((prev) =>
        prev.some((i) => i.id === data.id) ? prev : [...prev, data]
      );
      setSelected((prev) => new Set(prev).add(data.id));
      setQuery('');
    } catch {
      // Non-fatal during onboarding — the user can continue without it
    }
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
    router.replace('/(tabs)/map');
  }

  const canContinue = selected.size > 0;

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose your interests</Text>
        <Text style={styles.subtitle}>Find people who share your passions</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Button label="Retry" variant="ghost" size="sm" onPress={loadInterests} />
        </View>
      ) : (
        <>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.t3} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search interests..."
              placeholderTextColor={colors.t3}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={10}>
                <Ionicons name="close-circle" size={18} color={colors.t3} />
              </Pressable>
            )}
          </View>

          <ScrollView
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {visibleInterests.length === 0 && (
              <Text style={styles.emptyText}>No interests match “{query.trim()}”</Text>
            )}
            <View style={styles.chips}>
              {visibleInterests.map((item) => {
                const sel = selected.has(item.id);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => toggle(item.id)}
                    style={[styles.chip, sel && styles.chipSelected]}
                  >
                    <InterestChipIcon name={item.name} icon={item.icon} />
                    <Text style={[styles.chipLabel, sel && styles.chipLabelSelected]}>
                      {item.name}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setOtherVisible(true)}
                style={({ pressed }) => [styles.chip, styles.chipOther, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="add" size={16} color={colors.t2} />
                <Text style={styles.chipLabel}>Other</Text>
              </Pressable>
            </View>
          </ScrollView>
        </>
      )}

      <View style={[styles.footer, { paddingBottom: bottom + 16 }]}>
        <Text style={styles.count}>
          {selected.size > 0 ? `${selected.size} selected` : ' '}
        </Text>
        <Button
          label="Continue"
          variant="primary"
          size="lg"
          fullWidth
          loading={saving}
          disabled={!canContinue}
          onPress={handleContinue}
        />
      </View>

      <OtherInterestSheet
        visible={otherVisible}
        onClose={() => setOtherVisible(false)}
        onAdd={handleOtherAdd}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
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
    color: colors.t1,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t2,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t1,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t3,
    textAlign: 'center',
    marginTop: 32,
  },

  grid: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.tealTint,
    borderColor: colors.tealLine,
  },
  chipOther: {
    borderStyle: 'dashed',
  },
  chipLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '500',
    color: colors.t2,
  },
  chipLabelSelected: {
    color: colors.teal,
    fontWeight: '600',
  },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  count: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t3,
    textAlign: 'center',
  },

  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.red,
    textAlign: 'center',
  },
});
