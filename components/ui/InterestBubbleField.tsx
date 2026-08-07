import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { fonts, withAlpha, type ColorPalette } from '@/constants/theme';
import type { CategoryStyle } from '@/services/interestCategories';

import { InterestChipIcon } from './InterestChipIcon';

/**
 * The nine category bubbles, and the interests that live inside them.
 *
 * The interests are *in* the bubble: tapping one grows that bubble into a panel
 * filling the field, with its chips inside, and the rest of the field dims
 * behind it. There is no second screen and no navigation — closing shrinks the
 * panel back into the circle it came from.
 *
 * Both pickers render this. Onboarding used to push a drill-in step of its own
 * and edit-interests used to lay the same 681 interests out as flat sections;
 * what "Sports" looks like when you open it is now one answer rather than two.
 * The two screens differ only in the palette they hand over, so this works the
 * same in the forced-light onboarding flow and the themed settings one.
 */

// ─── The design field ─────────────────────────────────────────────────────────
// Placements are authored against a fixed 350×580 canvas and scaled to whatever
// box the screen gives us, so the composition holds on a small phone without
// the field having to scroll — a bubble you have to scroll to is a bubble you
// cannot expand in place.

const FIELD_W = 350;
const FIELD_H = 580;

/** Sizes are roughly proportional to how big each group is, so the biggest one
 *  is also the biggest target. Order matches `CATEGORY_STYLES`. */
export const BUBBLE_LAYOUT: { x: number; y: number; size: number }[] = [
  { x: 8,   y: 6,   size: 140 }, // Sports — the largest group, 186 entries
  { x: 196, y: 30,  size: 108 }, // Fitness & Wellness
  { x: 30,  y: 158, size: 110 }, // Music
  { x: 186, y: 152, size: 128 }, // Arts & Creativity
  { x: 12,  y: 288, size: 116 }, // Food & Drink
  { x: 156, y: 300, size: 112 }, // Travel & Outdoors
  { x: 6,   y: 418, size: 118 }, // Games & Tech
  { x: 146, y: 428, size: 110 }, // Entertainment & Culture
  { x: 258, y: 300, size: 92  }, // Lifestyle & Social
];

// ─── Float animation config ───────────────────────────────────────────────────
// Indexed modulo their own length: how many bubbles there are is a property of
// the catalogue rather than a constant, and reading past the end of these gave
// a tenth bubble an undefined drift variant and a NaN duration.
type Variant = 'A' | 'B' | 'C';
const VARIANTS: Variant[] = ['A', 'B', 'C', 'A', 'B', 'C', 'B', 'A'];
const DURATIONS = [7200, 6100, 8000, 6800, 7600, 6400, 8400, 7000];

const variantFor = (i: number) => VARIANTS[i % VARIANTS.length];
const durationFor = (i: number) => DURATIONS[i % DURATIONS.length];

/** How many interests a category needs before its panel is worth searching. */
const SEARCH_THRESHOLD = 12;

const OPEN_MS = 260;
const CLOSE_MS = 190;

// ─── Types ────────────────────────────────────────────────────────────────────
export interface BubbleInterest {
  id: number;
  name: string;
  icon?: string;
}

export interface BubbleGroup<T extends BubbleInterest = BubbleInterest> {
  style: CategoryStyle;
  items: T[];
}

interface Rect {
  left: number;
  top: number;
  size: number;
}

interface Props<T extends BubbleInterest> {
  /** All nine, in the server's order. Empty groups keep their bubble — a
   *  category with nothing in it is still a fact about the catalogue. */
  groups: BubbleGroup<T>[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  /** Onboarding forces light; settings follows the theme. */
  palette: ColorPalette;
}

// ─── One floating bubble ──────────────────────────────────────────────────────
function FloatingBubble({
  category,
  rect,
  index,
  picked,
  total,
  palette,
  onPress,
}: {
  category: CategoryStyle;
  rect: Rect;
  index: number;
  picked: number;
  total: number;
  palette: ColorPalette;
  onPress: () => void;
}) {
  const [anim] = useState(() => new Animated.Value(0));
  const variant = variantFor(index);

  useEffect(() => {
    const dur = durationFor(index);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: dur,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: dur,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const timer = setTimeout(() => loop.start(), index * 400);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
    // `anim` is built once and `index` is fixed for a mounted bubble, so this
    // still runs exactly once per bubble.
  }, [anim, index]);

  const { color, label, icon } = category;
  const { size, left, top } = rect;
  const hasPicks = picked > 0;
  const iconSize = Math.round(size * 0.2);
  const labelSize = Math.max(11, Math.round(size * 0.115));

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
        left,
        top,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: withAlpha(color, hasPicks ? 0.18 : 0.09),
        borderWidth: hasPicks ? 2 : 1.5,
        borderColor: withAlpha(color, hasPicks ? 1 : 0.3),
        boxShadow: `0 4px 8px ${withAlpha(hasPicks ? color : palette.t1, hasPicks ? 0.2 : 0.06)}`,
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
        accessibilityLabel={`${label}, ${total} interests${hasPicks ? `, ${picked} picked` : ''}`}
        accessibilityHint="Opens this category"
      >
        <Ionicons name={icon} size={iconSize} color={color} />
        <Text
          numberOfLines={2}
          style={{
            fontFamily: fonts.display,
            fontWeight: '600',
            fontSize: labelSize,
            lineHeight: labelSize * 1.25,
            color: palette.t1,
            textAlign: 'center',
            paddingHorizontal: 8,
          }}
        >
          {label}
        </Text>
        {hasPicks ? (
          <View style={[fieldStyles.pickedPill, { backgroundColor: color }]}>
            <Text style={[fieldStyles.pickedPillText, { color: palette.bg }]}>
              {picked} picked
            </Text>
          </View>
        ) : (
          <Text style={[fieldStyles.countHint, { color: palette.t3 }]}>{total}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─── The field ────────────────────────────────────────────────────────────────
export function InterestBubbleField<T extends BubbleInterest>({
  groups,
  selected,
  onToggle,
  palette,
}: Props<T>) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [grow] = useState(() => new Animated.Value(0));

  const openIndex = openKey === null ? -1 : groups.findIndex((g) => g.style.key === openKey);
  const open = openIndex >= 0 ? groups[openIndex] : null;

  const close = useCallback(() => {
    setClosing(true);
    Animated.timing(grow, {
      toValue: 0,
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      // A re-open interrupts the collapse; unmounting the panel then would
      // throw away the one that was just asked for.
      if (finished) setOpenKey(null);
    });
  }, [grow]);

  function expand(key: string) {
    setQuery('');
    setClosing(false);
    setOpenKey(key);
    grow.setValue(0);
    Animated.timing(grow, {
      toValue: 1,
      duration: OPEN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }

  // Back closes the panel rather than leaving the screen — the panel is where
  // you are, even though it cost no navigation to get there.
  useEffect(() => {
    if (!openKey) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [openKey, close]);

  // Scale the authored field into whatever box we were given, and centre it.
  const scale = box.w > 0 && box.h > 0 ? Math.min(box.w / FIELD_W, box.h / FIELD_H, 1) : 0;
  const offX = (box.w - FIELD_W * scale) / 2;
  const offY = (box.h - FIELD_H * scale) / 2;

  const rectFor = (i: number): Rect => {
    const slot = BUBBLE_LAYOUT[i % BUBBLE_LAYOUT.length];
    return {
      left: offX + slot.x * scale,
      top: offY + slot.y * scale,
      size: slot.size * scale,
    };
  };

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!open) return [];
    return needle ? open.items.filter((i) => i.name.toLowerCase().includes(needle)) : open.items;
  }, [open, needle]);

  const openRect = openIndex >= 0 ? rectFor(openIndex) : null;
  const pickedIn = open ? open.items.filter((i) => selected.has(i.id)).length : 0;

  return (
    <View
      style={fieldStyles.root}
      onLayout={(e) =>
        setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          openKey ? { opacity: grow.interpolate({ inputRange: [0, 1], outputRange: [1, 0.12] }) } : null,
        ]}
        pointerEvents={openKey ? 'none' : 'auto'}
      >
        {scale > 0 &&
          groups.map((group, i) => (
            <FloatingBubble
              key={group.style.key || 'more'}
              category={group.style}
              rect={rectFor(i)}
              index={i}
              picked={group.items.filter((item) => selected.has(item.id)).length}
              total={group.items.length}
              palette={palette}
              onPress={() => expand(group.style.key)}
            />
          ))}
      </Animated.View>

      {open && openRect && (
        <Animated.View
          style={{
            position: 'absolute',
            overflow: 'hidden',
            backgroundColor: palette.bg,
            borderWidth: 1.5,
            borderColor: withAlpha(open.style.color, 0.45),
            left: grow.interpolate({ inputRange: [0, 1], outputRange: [openRect.left, 0] }),
            top: grow.interpolate({ inputRange: [0, 1], outputRange: [openRect.top, 0] }),
            width: grow.interpolate({ inputRange: [0, 1], outputRange: [openRect.size, box.w] }),
            height: grow.interpolate({ inputRange: [0, 1], outputRange: [openRect.size, box.h] }),
            borderRadius: grow.interpolate({
              inputRange: [0, 1],
              outputRange: [openRect.size / 2, 26],
            }),
          }}
        >
          {/* The category's own tint, so the panel is recognisably the bubble
              it grew out of rather than a plain sheet. */}
          <View
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: withAlpha(open.style.color, 0.07) },
            ]}
            pointerEvents="none"
          />

          {/* Layer 1: what the bubble already looked like, so the first frame of
              the growth is identical to the circle it replaces. Fixed size, so
              it never re-lays-out while the panel grows around it. */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: openRect.size,
              height: openRect.size,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              opacity: grow.interpolate({
                inputRange: [0, 0.4, 1],
                outputRange: [1, 0, 0],
              }),
            }}
          >
            <Ionicons
              name={open.style.icon}
              size={Math.round(openRect.size * 0.2)}
              color={open.style.color}
            />
            <Text
              numberOfLines={2}
              style={{
                fontFamily: fonts.display,
                fontWeight: '600',
                fontSize: Math.max(11, Math.round(openRect.size * 0.115)),
                color: palette.t1,
                textAlign: 'center',
                paddingHorizontal: 8,
              }}
            >
              {open.style.label}
            </Text>
          </Animated.View>

          {/* Layer 2: the interests. Also fixed at the panel's final size — the
              chips are laid out once, not re-wrapped on every frame. */}
          <Animated.View
            pointerEvents={closing ? 'none' : 'auto'}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: box.w,
              height: box.h,
              opacity: grow.interpolate({
                inputRange: [0, 0.35, 1],
                outputRange: [0, 0, 1],
              }),
            }}
          >
            <View style={fieldStyles.panelHeader}>
              <View
                style={[
                  fieldStyles.panelIcon,
                  { backgroundColor: withAlpha(open.style.color, 0.14) },
                ]}
              >
                <Ionicons name={open.style.icon} size={20} color={open.style.color} />
              </View>
              <View style={fieldStyles.panelHeaderText}>
                <Text style={[fieldStyles.panelTitle, { color: palette.t1 }]} numberOfLines={1}>
                  {open.style.label}
                </Text>
                <Text style={[fieldStyles.panelMeta, { color: palette.t3 }]}>
                  {pickedIn} of {open.items.length} selected
                </Text>
              </View>
              <Pressable
                onPress={close}
                hitSlop={12}
                style={({ pressed }) => [
                  fieldStyles.closeBtn,
                  { borderColor: palette.border, backgroundColor: palette.surface },
                  pressed && fieldStyles.dimmed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Close category"
              >
                <Ionicons name="close" size={18} color={palette.t2} />
              </Pressable>
            </View>

            {open.items.length > SEARCH_THRESHOLD && (
              <View
                style={[
                  fieldStyles.searchBar,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                ]}
              >
                <Ionicons name="search" size={17} color={palette.t3} />
                <TextInput
                  style={[fieldStyles.searchInput, { color: palette.t1 }]}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={`Search ${open.style.label.toLowerCase()}…`}
                  placeholderTextColor={palette.t3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel={`Search ${open.style.label}`}
                />
                {query.length > 0 && (
                  <Pressable
                    onPress={() => setQuery('')}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                  >
                    <Ionicons name="close-circle" size={17} color={palette.t3} />
                  </Pressable>
                )}
              </View>
            )}

            <ScrollView
              contentContainerStyle={fieldStyles.chipScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {open.items.length === 0 ? (
                <Text style={[fieldStyles.empty, { color: palette.t3 }]}>
                  Nothing in this category yet.
                </Text>
              ) : shown.length === 0 ? (
                <Text style={[fieldStyles.empty, { color: palette.t3 }]}>
                  Nothing here matches “{query.trim()}”.
                </Text>
              ) : (
                <View style={fieldStyles.chips}>
                  {shown.map((item) => {
                    const sel = selected.has(item.id);
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => onToggle(item.id)}
                        style={({ pressed }) => [
                          fieldStyles.chip,
                          {
                            backgroundColor: sel
                              ? withAlpha(open.style.color, 0.16)
                              : palette.surface,
                            borderColor: sel
                              ? withAlpha(open.style.color, 0.55)
                              : palette.border,
                          },
                          pressed && fieldStyles.dimmed,
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: sel }}
                        accessibilityLabel={`${item.name}, ${open.style.label}`}
                      >
                        <InterestChipIcon
                          name={item.name}
                          icon={item.icon}
                          color={sel ? open.style.color : palette.t2}
                        />
                        <Text
                          style={[
                            fieldStyles.chipLabel,
                            { color: sel ? open.style.color : palette.t1 },
                            sel && fieldStyles.chipLabelSelected,
                          ]}
                        >
                          {item.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  root: { flex: 1, position: 'relative' },

  pickedPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pickedPillText: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
  },
  countHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
  },

  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
  },
  panelIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelHeaderText: { flex: 1, gap: 2 },
  panelTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 20,
  },
  panelMeta: {
    fontFamily: fonts.body,
    fontSize: 12.5,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginBottom: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 14,
  },

  chipScroll: { paddingHorizontal: 18, paddingBottom: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '500',
  },
  chipLabelSelected: { fontWeight: '600' },

  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    textAlign: 'center',
    paddingTop: 32,
  },
  dimmed: { opacity: 0.6 },
});
