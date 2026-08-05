import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { AuraMark } from '@/components/ui/AuraMark';
import { Speedometer } from '@/components/Speedometer';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  auraOrb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: `${colors.purple}20`,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  auraOrbValue: {
    fontFamily: fonts.display,
    fontSize: 15,
    fontWeight: '700',
    color: colors.purple,
  },

  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 14,
  },

  iconBubble: {
    width: 88,
    height: 88,
    borderRadius: radius.l,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },

  screenTitle: {
    fontFamily: fonts.display,
    fontSize: 26,
    fontWeight: '700',
    color: colors.t1,
    textAlign: 'center',
  },

  comingSoonTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.t1,
    textAlign: 'center',
  },

  subtitle: {
    fontSize: 14,
    color: colors.t3,
    textAlign: 'center',
    lineHeight: 21,
  },
});

export default function MarketScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const [auraPoints, setAuraPoints] = useState<number | null>(null);

  useEffect(() => {
    api.get<{ aura_points?: number }>('/api/users/profile/')
      .then((r) => setAuraPoints(r.data.aura_points ?? 0))
      .catch(() => {});
  }, []);

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          onPress={() => router.back()}
          hitSlop={14}
        >
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </Pressable>

        <View style={styles.auraOrb}>
          <AuraMark size={13} color={colors.purple} />
          <Text style={styles.auraOrbValue}>
            {auraPoints != null ? auraPoints.toLocaleString() : '—'}
          </Text>
        </View>
      </View>

      {/* Coming soon body */}
      <View style={styles.body}>
        <View style={styles.iconBubble}>
          <Ionicons name="storefront-outline" size={44} color={colors.teal} />
        </View>

        <Text style={styles.screenTitle}>Market</Text>

        <Text style={styles.comingSoonTitle}>Coming Soon 🔒</Text>

        <Text style={styles.subtitle}>
          Spend your Aura Points on frames, banners and zone upgrades
        </Text>
      </View>

      <Speedometer />
    </View>
  );
}
