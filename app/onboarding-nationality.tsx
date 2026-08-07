import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { fonts, lightColors as L, radius } from '@/constants/theme';
import { COUNTRIES, flagEmoji as flag } from '@/constants/onboardingData';

export default function OnboardingNationalityScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const visible = query.trim()
    ? COUNTRIES.filter(c => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : COUNTRIES;

  // Last screen of the sign-up chain, so the guide goes after it rather than
  // after the map — arriving at the map and being covered by an explanation of
  // it is the wrong order. `getting-started` sends them on when it is done, and
  // clears the marker that put them there. Skipping this screen still gets the
  // guide: skipping a country is not skipping the app.
  function goToGuide() {
    router.replace('/getting-started');
  }

  async function handleContinue() {
    setSaving(true);
    try {
      if (selected) {
        await api.patch('/api/users/profile/', { nationality: selected });
      }
    } catch {}
    setSaving(false);
    goToGuide();
  }

  return (
    <View style={[s.root, { paddingTop: top }]}>
      <View style={s.topRow}>
        <Pressable
          onPress={goToGuide}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip"
        >
          <Text style={s.skip}>Skip</Text>
        </Pressable>
      </View>

      <View style={s.header}>
        <Text style={s.title}>Let us know you better</Text>
        <Text style={s.subtitle}>Where are you from?</Text>
      </View>

      <View style={s.searchBar}>
        <Ionicons name="search" size={18} color={L.t3} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search countries..."
          placeholderTextColor={L.t3}
          selectionColor={L.coral}
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

      <FlatList
        data={visible}
        keyExtractor={(item) => item.code}
        windowSize={5}
        initialNumToRender={8}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.list}
        renderItem={({ item }) => {
          const sel = selected === item.code;
          return (
            <Pressable
              onPress={() => setSelected(sel ? null : item.code)}
              style={[s.row, sel && s.rowSel]}
              accessibilityRole="button"
              accessibilityState={{ selected: sel }}
              accessibilityLabel={item.name}
            >
              <Text style={s.flagEmoji}>{flag(item.code)}</Text>
              <Text style={[s.countryName, sel && s.countryNameSel]}>
                {item.name}
              </Text>
              {sel && (
                <Ionicons name="checkmark" size={18} color={L.coral} style={s.check} />
              )}
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={s.separator} />}
      />

      <View style={[s.footer, { paddingBottom: bottom + 16 }]}>
        <Pressable
          onPress={handleContinue}
          disabled={saving}
          style={({ pressed }) => [s.continueBtn, pressed && s.dimmed]}
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          {saving
            ? <ActivityIndicator color="#ffffff" size="small" />
            : <Text style={s.continueBtnLabel}>Continue</Text>
          }
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: L.bg },

  topRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  skip: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: L.t3,
  },

  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 6,
  },
  title: {
    fontFamily: 'SpaceGrotesk-SemiBold',
    fontSize: 26,
    color: L.t1,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: L.t2,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
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

  list: { paddingBottom: 16 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
  },
  rowSel: {
    backgroundColor: L.coralSoft,
  },
  flagEmoji: { fontSize: 24 },
  countryName: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: L.t1,
  },
  countryNameSel: {
    color: L.coral,
    fontWeight: '600',
  },
  check: { marginLeft: 'auto' },

  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: L.border,
    marginLeft: 58,
  },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: L.border,
  },
  continueBtn: {
    backgroundColor: L.coral,
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 17,
    color: '#ffffff',
  },
  dimmed: { opacity: 0.5 },
});
