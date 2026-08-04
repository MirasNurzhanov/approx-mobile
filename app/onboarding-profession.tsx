import { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/services/api';
import { fonts, lightColors as L, radius } from '@/constants/theme';
import { PROFESSIONS } from '@/constants/onboardingData';

const SCREEN_W = Dimensions.get('window').width;
const H_PAD = 16;
const COL_GAP = 12;
const CARD_W = (SCREEN_W - H_PAD * 2 - COL_GAP) / 2;

export default function OnboardingProfessionScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function goToMap() {
    router.replace('/onboarding-nationality');
  }

  async function handleContinue() {
    setSaving(true);
    try {
      if (selected) {
        await api.patch('/api/users/profile/', { profession: selected });
      }
    } catch {}
    setSaving(false);
    router.replace('/onboarding-nationality');
  }

  return (
    <View style={[s.root, { paddingTop: top }]}>
      <View style={s.topRow}>
        <Pressable
          onPress={goToMap}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip"
        >
          <Text style={s.skip}>Skip</Text>
        </Pressable>
      </View>

      <View style={s.header}>
        <Text style={s.title}>Let us know you better</Text>
        <Text style={s.subtitle}>What do you do?</Text>
      </View>

      <FlatList
        data={PROFESSIONS}
        keyExtractor={(item) => item.key}
        numColumns={2}
        windowSize={5}
        initialNumToRender={8}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.grid}
        columnWrapperStyle={s.row}
        ItemSeparatorComponent={() => <View style={{ height: COL_GAP }} />}
        renderItem={({ item }) => {
          const sel = selected === item.key;
          return (
            <Pressable
              onPress={() => setSelected(sel ? null : item.key)}
              style={[s.card, { width: CARD_W }, sel && s.cardSel]}
              accessibilityRole="button"
              accessibilityState={{ selected: sel }}
              accessibilityLabel={item.label}
            >
              <Text style={s.emoji}>{item.emoji}</Text>
              <Text style={[s.cardLabel, sel && s.cardLabelSel]} numberOfLines={2}>
                {item.label}
              </Text>
            </Pressable>
          );
        }}
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
    paddingBottom: 20,
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

  grid: { paddingHorizontal: H_PAD, paddingBottom: 16 },
  row: { gap: COL_GAP },

  card: {
    backgroundColor: L.surface,
    borderWidth: 1.5,
    borderColor: L.border,
    borderRadius: radius.m,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 100,
  },
  cardSel: {
    backgroundColor: L.coralSoft,
    borderColor: L.coral,
  },
  emoji: { fontSize: 28 },
  cardLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: L.t2,
    textAlign: 'center',
  },
  cardLabelSel: {
    color: L.coral,
    fontWeight: '600',
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
