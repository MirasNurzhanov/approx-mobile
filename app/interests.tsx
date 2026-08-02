import { useEffect, useMemo, useState } from 'react';
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
import { IconBack, InterestChipIcon } from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

interface Interest {
  id: number;
  name: string;
  icon: string;
}

export default function EditInterestsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { top, bottom } = useSafeAreaInsets();

  const [interests, setInterests] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [initialSelected, setInitialSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();
  const visibleInterests = normalizedQuery
    ? interests.filter((i) => i.name.toLowerCase().includes(normalizedQuery))
    : interests;

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const [allRes, profileRes] = await Promise.all([
        api.get<Interest[]>('/api/interests/'),
        api.get<{ interests?: Interest[] }>('/api/users/profile/'),
      ]);
      const all = allRes.data;
      const mine = profileRes.data.interests ?? [];
      // Custom interests may not be in the shared list — merge them in so they
      // show as chips and can be deselected.
      const listedIds = new Set(all.map((i) => i.id));
      const merged = [...all, ...mine.filter((i) => !listedIds.has(i.id))];
      const preSelected = new Set(mine.map((i) => i.id));
      setInterests(merged);
      setSelected(preSelected);
      setInitialSelected(preSelected);
    } catch {
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
    const toDeselect = interests.filter((i) => initialSelected.has(i.id)).map((i) => i.id);
    const toSelect = Array.from(selected);

    setSaving(true);
    try {
      await Promise.all(
        toDeselect.map((id) => api.delete(`/api/interests/${id}/select/`).catch(() => {}))
      );
      for (const id of toSelect) {
        await api.post(`/api/interests/${id}/select/`);
      }
      router.back();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          onPress={() => router.back()}
          hitSlop={12}
        >
          <IconBack size={22} color={colors.t1} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Edit interests</Text>
          <Text style={styles.subtitle}>Choose what you care about</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Button label="Retry" variant="ghost" size="sm" onPress={load} />
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
            </View>
          </ScrollView>
        </>
      )}

      {!loading && !error && (
        <View style={[styles.footer, { paddingBottom: bottom + 16 }]}>
          <Text style={styles.count}>
            {selected.size > 0 ? `${selected.size} selected` : ' '}
          </Text>
          <Button
            label="Save changes"
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            onPress={handleSave}
          />
        </View>
      )}

    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 4 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 24,
    color: colors.t1,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t2,
  },
  pressed: { opacity: 0.6 },

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
