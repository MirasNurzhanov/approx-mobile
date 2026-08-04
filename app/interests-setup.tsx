import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { fonts, lightColors as L, withAlpha } from '@/constants/theme';

// ─── Category definitions ─────────────────────────────────────────────────────
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Category {
  key: string;
  label: string;
  icon: IoniconName;
  color: string;
  x: number;
  y: number;
  size: number;
}

const CATEGORIES: Category[] = [
  { key: 'sports',   label: 'Sports',       icon: 'football-outline',        color: '#E8714A', x: 12,  y: 14,  size: 138 },
  { key: 'gaming',   label: 'Gaming',       icon: 'game-controller-outline', color: '#8B6FD4', x: 196, y: 40,  size: 112 },
  { key: 'music',    label: 'Music',        icon: 'musical-notes-outline',   color: '#4D8DFF', x: 44,  y: 168, size: 104 },
  { key: 'casual',   label: 'Casual',       icon: 'cafe-outline',            color: '#C9932E', x: 200, y: 176, size: 118 },
  { key: 'food',     label: 'Food & Drink', icon: 'restaurant-outline',      color: '#E0567F', x: 30,  y: 300, size: 126 },
  { key: 'art',      label: 'Art & Making', icon: 'color-palette-outline',   color: '#12A594', x: 210, y: 314, size: 106 },
  { key: 'tech',     label: 'Tech',         icon: 'code-slash-outline',      color: '#5EA83C', x: 28,  y: 440, size: 98  },
  { key: 'outdoors', label: 'Outdoors',     icon: 'leaf-outline',            color: '#E8714A', x: 178, y: 432, size: 122 },
];


// ─── Interest type ────────────────────────────────────────────────────────────
interface Interest {
  id: number;
  name: string;
  icon: string;
  category?: string;
}

// ─── Client-side categorization ───────────────────────────────────────────────
function categorize(name: string): string {
  const n = name.toLowerCase();
  if (/sport|football|basketball|soccer|tennis|swim|run|gym|fitness|yoga|martial|boxing|cycl|volleyball|baseball|hockey/.test(n)) return 'sports';
  if (/gaming|gamer|esport|video.?game|playstation|xbox|nintendo|rpg|fps|strategy/.test(n)) return 'gaming';
  if (/music|guitar|piano|drum|sing|dj|rap|hip.?hop|jazz|concert|festival|instrument|songwrit/.test(n)) return 'music';
  if (/food|cooking|baking|coffee|wine|cocktail|restaurant|recipe|vegan|culinary|drink|beer/.test(n)) return 'food';
  if (/art|paint|sculpt|draw|photograph|fashion|film|theatre|dance|writ|literature|poetry|novel|cinema/.test(n)) return 'art';
  if (/tech|programming|coding|software|ai\b|robotics|data|cyber|startup|engineering|developer/.test(n)) return 'tech';
  if (/outdoor|nature|hiking|camping|surfing|skiing|snowboard|travel|adventure|gardening/.test(n)) return 'outdoors';
  return 'casual';
}

// ─── Float animation config ───────────────────────────────────────────────────
type Variant = 'A' | 'B' | 'C';
const VARIANTS: Variant[] = ['A', 'B', 'C', 'A', 'B', 'C', 'B', 'A'];
const DURATIONS           = [7200, 6100, 8000, 6800, 7600, 6400, 8400, 7000];

// ─── Floating bubble ──────────────────────────────────────────────────────────
function FloatingBubble({
  category,
  index,
  picked,
  onPress,
}: {
  category: Category;
  index: number;
  picked: number;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  const anim    = useRef(new Animated.Value(0)).current;
  const variant = VARIANTS[index];

  useEffect(() => {
    const dur = DURATIONS[index];
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: dur,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: dur,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    );
    const timer = setTimeout(() => loop.start(), index * 400);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, []);

  const { size, color, label, icon, x, y } = category;
  const hasPicks  = picked > 0;
  const iconSize  = Math.round(size * 0.2);
  const labelSize = Math.max(13, Math.round(size * 0.115));

  const transform =
    variant === 'A'
      ? [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -18] }) }]
      : variant === 'B'
      ? [
          { translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 8] }) },
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 14] }) },
        ]
      : [
          { translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) },
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -12] }) },
        ];

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: withAlpha(color, hasPicks ? 0.18 : 0.09),
        borderWidth: hasPicks ? 2 : 1.5,
        borderColor: withAlpha(color, hasPicks ? 1 : 0.3),
        shadowColor: hasPicks ? color : '#2D2A22',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: hasPicks ? 0.2 : 0.06,
        shadowRadius: 8,
        elevation: hasPicks ? 4 : 2,
        transform,
      }}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          StyleSheet.absoluteFillObject,
          {
            borderRadius: size / 2,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${label}${hasPicks ? `, ${picked} picked` : ''}`}
      >
        <Ionicons name={icon} size={iconSize} color={color} />
        <Text
          numberOfLines={2}
          style={{
            fontFamily: fonts.display,
            fontWeight: '600',
            fontSize: labelSize,
            lineHeight: labelSize * 1.25,
            color: '#2D2A22',
            textAlign: 'center',
            paddingHorizontal: 8,
          }}
        >
          {label}
        </Text>
        {hasPicks && (
          <View style={[s.pickedPill, { backgroundColor: color }]}>
            <Text style={s.pickedPillText}>{picked} picked</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function InterestsSetupScreen() {
  const { top, bottom } = useSafeAreaInsets();

  const [step, setStep]                     = useState<'categories' | 'interests'>('categories');
  const [activeCategory, setActiveCategory] = useState<Category>(CATEGORIES[0]);
  const [interests, setInterests]           = useState<Interest[]>([]);
  const [selected, setSelected]             = useState<Set<number>>(new Set());
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [error, setError]                   = useState<string | null>(null);

  useEffect(() => {
    api.get<Interest[]>('/api/interests/')
      .then(r => setInterests(r.data))
      .catch(() => setError('Could not load interests. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  function openCategory(cat: Category) {
    setActiveCategory(cat);
    setStep('interests');
  }

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleContinue() {
    setSaving(true);
    try {
      await api.post('/api/interests/select/', { interest_ids: Array.from(selected) });
    } catch {}
    finally { setSaving(false); }
    router.replace('/onboarding-profession');
  }

  // Group interests by category key
  const byCategory = useMemo(() => {
    const map = new Map<string, Interest[]>();
    for (const cat of CATEGORIES) map.set(cat.key, []);
    for (const item of interests) {
      const key = item.category ?? categorize(item.name);
      (map.get(key) ?? map.get('casual')!).push(item);
    }
    return map;
  }, [interests]);

  // Selected count per category
  const pickedPerCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const [key, items] of byCategory) {
      map.set(key, items.filter(i => selected.has(i.id)).length);
    }
    return map;
  }, [byCategory, selected]);

  // ── Screen 2: drill-in ───────────────────────────────────────────────────
  if (step === 'interests') {
    const catItems  = byCategory.get(activeCategory.key) ?? [];
    const catPicked = pickedPerCategory.get(activeCategory.key) ?? 0;
    const { color }  = activeCategory;

    return (
      <View style={[s.root, { paddingTop: top }]}>
        {/* Back */}
        <Pressable
          onPress={() => setStep('categories')}
          style={({ pressed }) => [s.backLink, pressed && s.dimmed]}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="All categories"
        >
          <Ionicons name="chevron-back" size={18} color={L.t2} />
          <Text style={s.backLinkLabel}>All categories</Text>
        </Pressable>

        {/* Category header */}
        <View style={s.drillHeader}>
          <View style={[s.drillIconTile, { backgroundColor: withAlpha(color, 0.12) }]}>
            <Ionicons name={activeCategory.icon} size={22} color={color} />
          </View>
          <View style={{ gap: 2 }}>
            <Text style={s.drillTitle}>{activeCategory.label}</Text>
            <Text style={s.drillSubtitle}>
              {catPicked} of {catItems.length} selected
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={s.chipsContainer}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {catItems.length === 0 ? (
            <Text style={s.emptyText}>No interests in this category yet.</Text>
          ) : (
            <View style={s.chips}>
              {catItems.map(item => {
                const sel = selected.has(item.id);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => toggle(item.id)}
                    style={({ pressed }) => [
                      s.chip,
                      sel && s.chipSelected,
                      pressed && s.dimmed,
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: sel }}
                    accessibilityLabel={item.name}
                  >
                    <Text style={s.chipIcon}>{item.icon}</Text>
                    <Text style={[s.chipLabel, sel && s.chipLabelSelected]}>
                      {item.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>

        <View style={[s.footer, { paddingBottom: bottom + 16 }]}>
          <Text style={s.footerCount}>
            {catPicked > 0 ? `${catPicked} selected` : ' '}
          </Text>
          <Pressable
            onPress={() => setStep('categories')}
            style={({ pressed }) => [s.continueBtn, pressed && s.dimmed]}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={s.continueBtnLabel}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Screen 1: floating bubbles ───────────────────────────────────────────
  return (
    <View style={[s.root, { paddingTop: top }]}>
      <View style={s.header}>
        <Text style={s.title}>What are you into?</Text>
        <Text style={s.subtitle}>
          Tap a category to see what is inside. Find people who share your passions.
        </Text>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={L.coral} size="large" />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.canvasContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* 350×560 absolute-positioned canvas */}
          <View style={s.canvas}>
            {CATEGORIES.map((cat, i) => (
              <FloatingBubble
                key={cat.key}
                category={cat}
                index={i}
                picked={pickedPerCategory.get(cat.key) ?? 0}
                reduceMotion={false}
                onPress={() => openCategory(cat)}
              />
            ))}
          </View>
        </ScrollView>
      )}

      <View style={[s.footer, { paddingBottom: bottom + 16 }]}>
        <Text style={s.footerCount}>
          {selected.size > 0 ? `${selected.size} selected` : ' '}
        </Text>
        <Pressable
          onPress={handleContinue}
          disabled={selected.size === 0 || saving}
          style={({ pressed }) => [
            s.continueBtn,
            (selected.size === 0 || pressed) && s.dimmed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={s.continueBtnLabel}>Continue</Text>
          }
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#faf9f5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Screen 1 header
  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12, gap: 8 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 30,
    color: '#2D2A22',
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: L.t2,
  },

  // Bubble canvas — 350×560 design field
  canvasContainer: { paddingBottom: 8 },
  canvas: {
    width: 350,
    height: 580,
    alignSelf: 'center',
    position: 'relative',
  },

  // Picked badge inside bubble
  pickedPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pickedPillText: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    color: '#faf9f5',
  },

  // Screen 2 back link
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    alignSelf: 'flex-start',
  },
  backLinkLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: L.t2,
  },

  // Screen 2 category header
  drillHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  drillIconTile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drillTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 24,
    color: '#2D2A22',
  },
  drillSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: '#8C8475',
  },

  // Interest chips
  chipsContainer: { paddingHorizontal: 20, paddingBottom: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: L.border,
  },
  chipSelected: {
    backgroundColor: '#FCEEE8',
    borderColor: '#F0C4AE',
  },
  chipIcon:  { fontSize: 14 },
  chipLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '500',
    color: L.t1,
  },
  chipLabelSelected: {
    color: '#E8714A',
    fontWeight: '600',
  },

  // Shared footer
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: L.border,
    backgroundColor: '#faf9f5',
  },
  footerCount: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: L.t2,
    textAlign: 'center',
  },
  continueBtn: {
    backgroundColor: '#E8714A',
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

  emptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: L.t3,
    textAlign: 'center',
    paddingTop: 40,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: L.red,
    textAlign: 'center',
  },
  dimmed: { opacity: 0.5 },
});
