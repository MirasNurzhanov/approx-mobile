import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { NAV_ARC_R_OUT } from '@/components/navArc';
import { IconSwift, type IconComponent } from '@/components/ui/icons';
import { useScrollNav } from '@/context/ScrollNavContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { refreshAlertsCount, useAlertsCount } from '@/services/alerts';
import { api } from '@/services/api';
import { MAX_SCALE_FIXED, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// ─── Animated SVG primitives ──────────────────────────────────────────────────
const AnimatedLine   = Animated.createAnimatedComponent(Line);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ─── Geometry ─────────────────────────────────────────────────────────────────
const { width: W } = Dimensions.get('window');
const R_OUT  = NAV_ARC_R_OUT;
const R_IN   = R_OUT * 0.5;
const R_ICO  = (R_OUT + R_IN) / 2;
const SVG_W  = W;
const SVG_H  = R_OUT + 6;
const CX     = W / 2;
const CY     = SVG_H;
const NEEDLE = R_IN - 10;
const SLIM_H = 56; // slim tab bar row height

const SPRING = { damping: 18, stiffness: 150, mass: 0.9 };
const FADE   = { duration: 200, easing: Easing.out(Easing.cubic) };

// ─── Badge indices ────────────────────────────────────────────────────────────
const CHAT_IDX = 2; // 'Chat' is index 2

// ─── Sections ─────────────────────────────────────────────────────────────────
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Section {
  label: string;
  icon?: IoniconName;
  activeIcon?: IoniconName;
  /** A glyph from the app's own icon set, for sections Ionicons has no word
   *  for. Wins over `icon`/`activeIcon` — it carries its own state through
   *  colour, like every other icon on the arc. */
  Glyph?: IconComponent;
  /** Optical size correction for a `Glyph` whose shape doesn't fill its box.
   *  Multiplies the rendered size everywhere the icon appears, so the arc and
   *  the collapsed bar stay in proportion with each other. */
  glyphScale?: number;
  route: string;
  name: string;
  start: number;
  end: number;
  mid: number;
  /** Extra path fragments that should light this wedge. A pushed screen owned
   *  by a section keeps its parent selected instead of falling back to Map. */
  owns?: string[];
}

// Five wedges divide the 0–180° arc into 36° each. The angles are written out
// rather than derived so a section can be nudged without moving its neighbours.
const SECTIONS: Section[] = [
  { label: 'Map',      icon: 'map-outline',         activeIcon: 'map',            route: '/(tabs)/map',      name: 'map',      start: 144, end: 180, mid: 162 },
  { label: 'Profile',  icon: 'person-outline',      activeIcon: 'person',         route: '/(tabs)/profile',  name: 'profile',  start: 108, end: 144, mid: 126 },
  { label: 'Chat',     icon: 'chatbubbles-outline', activeIcon: 'chatbubbles',    route: '/(tabs)/chat',     name: 'chat',     start: 72,  end: 108, mid: 90, owns: ['notification', 'messages', 'clubs', 'create-club'] },
  // The swift is a wide, shallow silhouette — at the same nominal size as the
  // Ionicons around it, which fill their square, it reads smaller than its
  // neighbours. The bump is optical, not a size change.
  { label: 'Swifts',   Glyph: IconSwift, glyphScale: 1.3,                         route: '/(tabs)/swifts',   name: 'swifts',   start: 36,  end: 72,  mid: 54  },
  { label: 'Settings', icon: 'settings-outline',    activeIcon: 'settings-sharp', route: '/(tabs)/settings', name: 'settings', start: 0,   end: 36,  mid: 18  },
];

function SectionGlyph({
  section,
  active,
  size,
  color,
}: {
  section: Section;
  active: boolean;
  size: number;
  color: string;
}) {
  const Glyph = section.Glyph;
  if (Glyph) return <Glyph size={Math.round(size * (section.glyphScale ?? 1))} color={color} />;
  return (
    <Ionicons
      name={(active ? section.activeIcon : section.icon) ?? 'ellipse-outline'}
      size={size}
      color={color}
    />
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toRad(deg: number) { return (deg * Math.PI) / 180; }

function polar(r: number, deg: number) {
  return { x: CX + r * Math.cos(toRad(deg)), y: CY - r * Math.sin(toRad(deg)) };
}

function sectorPath(start: number, end: number, gap = 1.2): string {
  const s  = polar(R_OUT, start + gap);
  const e  = polar(R_OUT, end   - gap);
  const ei = polar(R_IN,  end   - gap);
  const si = polar(R_IN,  start + gap);
  const lg = end - start > 180 ? 1 : 0;
  return [
    `M ${s.x.toFixed(2)} ${s.y.toFixed(2)}`,
    `A ${R_OUT} ${R_OUT} 0 ${lg} 0 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`,
    `L ${ei.x.toFixed(2)} ${ei.y.toFixed(2)}`,
    `A ${R_IN}  ${R_IN}  0 ${lg} 1 ${si.x.toFixed(2)} ${si.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

/** With Alerts gone from the arc, its unread count rides on the Chat wedge —
 *  which is where the feed now lives, as Chat's first tab. Two sources with no
 *  overlap: unread messages, and everything in Alerts. */
function badgeFor(index: number, chatBadge: number, alertsBadge: number): number {
  return index === CHAT_IDX ? chatBadge + alertsBadge : 0;
}

/** "Chat, 3 unread" rather than "Chat" followed by a bare "3". */
function tabLabel(label: string, badge: number): string {
  if (badge <= 0) return label;
  return `${label}, ${badge > 99 ? 'over 99' : badge} unread`;
}

function matchSection(pathname: string): number {
  const idx = SECTIONS.findIndex(
    s =>
      pathname === s.route ||
      pathname.startsWith(s.route) ||
      pathname.endsWith(`/${s.name}`) ||
      (s.owns?.some(fragment => pathname.includes(fragment)) ?? false),
  );
  return idx >= 0 ? idx : 0;
}

const BG_PATH = [
  `M ${(CX - R_OUT).toFixed(2)} ${CY.toFixed(2)}`,
  `A ${R_OUT} ${R_OUT} 0 0 0 ${(CX + R_OUT).toFixed(2)} ${CY.toFixed(2)}`,
  'Z',
].join(' ');

const GLOW_ARC = [
  `M ${(CX - R_OUT).toFixed(2)} ${CY.toFixed(2)}`,
  `A ${R_OUT} ${R_OUT} 0 0 0 ${(CX + R_OUT).toFixed(2)} ${CY.toFixed(2)}`,
].join(' ');

// ─── Component ────────────────────────────────────────────────────────────────
export function Speedometer() {
  const router            = useRouter();
  const pathname          = usePathname();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { collapsed }     = useScrollNav();
  const { colors }        = useTheme();
  const styles            = useMemo(() => makeStyles(colors), [colors]);

  // Which wedge is lit is a pure function of the route, so it is worked out
  // here rather than mirrored into state by an effect — that version repainted
  // the whole arc a second time on every navigation, with the old wedge still
  // lit in between.
  const activeIdx = matchSection(pathname);
  const [chatBadge, setChatBadge] = useState(0);
  // Same store the Alerts tab inside Chat reads, so the wedge badge and the tab
  // badge can never disagree.
  const alertsBadge = useAlertsCount();

  // The needle sweep and the collapse spring are decorative. With Reduce
  // Motion on they jump to the end state instead — the feedback is kept, the
  // movement is not.
  const reduceMotion = useReduceMotion();
  const animate = useCallback(
    <T,>(value: T, spring: boolean) => {
      if (reduceMotion) return value;
      return (spring ? withSpring(value as any, SPRING) : withTiming(value as any, FADE)) as T;
    },
    [reduceMotion],
  );

  // ── Chat badge: unread messages only ─────────────────────────────────────────
  // Pending Hi requests used to be counted here too. They are part of Alerts
  // now, which `alertsBadge` already counts — and this badge adds the two
  // together, so counting requests in both would show every one of them twice.
  const fetchChatBadge = useCallback(async () => {
    try {
      const [unreadRes] = await Promise.allSettled([
        api.get<unknown>('/api/friends/messages/unread/'),
      ]);
      let count = 0;
      if (unreadRes.status === 'fulfilled') {
        const d = unreadRes.value.data;
        if (typeof d === 'number') count += d;
        else if (Array.isArray(d)) count += d.length;
        else if (d && typeof d === 'object') count += Number((d as any).unread_count ?? (d as any).count ?? 0);
      }
      setChatBadge(count);
    } catch {}
  }, []);

  useEffect(() => {
    fetchChatBadge();
    const id = setInterval(fetchChatBadge, 10_000);
    return () => clearInterval(id);
  }, [fetchChatBadge]);

  // Re-fetch on tab focus; optimistic clear when entering a message thread
  useEffect(() => {
    // Chat is where both halves of this badge get read, so entering it is the
    // one navigation that can make either half stale.
    if (pathname.includes('chat')) {
      fetchChatBadge();
      refreshAlertsCount();
    }
    if (pathname.includes('messages')) {
      setChatBadge(0);
      const t = setTimeout(() => fetchChatBadge(), 1500);
      return () => clearTimeout(t);
    }
  }, [pathname, fetchChatBadge]);

  const needleAngle      = useSharedValue(SECTIONS[matchSection(pathname)].mid);
  const containerH       = useSharedValue(SVG_H + safeBottom);
  const collapseProgress = useSharedValue(0); // 0 = full speedometer, 1 = slim bar

  // Sync needle when route changes. The shared value is Reanimated's, not
  // React's, so driving it from an effect is the point of the effect.
  useEffect(() => {
    needleAngle.set(animate(SECTIONS[activeIdx].mid, true));
  }, [activeIdx, animate, needleAngle]);

  // Animate transition when collapsed state or safeBottom changes
  // Declared above the effect that reads it, so on any commit where both run
  // this one lands first and that read sees the current inset.
  const safeBottomRef = useRef(safeBottom);
  const collapsedRef = useRef(collapsed);
  useEffect(() => {
    safeBottomRef.current = safeBottom;
    collapsedRef.current = collapsed;
  });

  useEffect(() => {
    // Immediate layout update for safeBottom change (no spring). `collapsed` is
    // read through the ref rather than depended on: the effect below already
    // owns collapse, and letting it re-run this one would snap the bar to its
    // new height first and swallow that animation.
    containerH.set(collapsedRef.current ? SLIM_H + safeBottom : SVG_H + safeBottom);
  }, [safeBottom, containerH]);

  useEffect(() => {
    containerH.set(animate(
      collapsed ? SLIM_H + safeBottomRef.current : SVG_H + safeBottomRef.current,
      true,
    ));
    collapseProgress.set(animate(collapsed ? 1 : 0, false));
  }, [collapsed, animate, containerH, collapseProgress]);

  function handlePress(idx: number) {
    // The needle still moves on the press, so the arc answers the tap at once.
    // Which wedge is *lit* follows the route, since that is what it reports —
    // lighting it here as well meant a failed navigation left the arc claiming
    // to be somewhere the app never went.
    needleAngle.set(animate(SECTIONS[idx].mid, true));
    router.navigate(SECTIONS[idx].route as any);
  }

  const lineProps = useAnimatedProps(() => {
    const r = (needleAngle.get() * Math.PI) / 180;
    return { x2: CX + NEEDLE * Math.cos(r), y2: CY - NEEDLE * Math.sin(r) };
  });

  const dotProps = useAnimatedProps(() => {
    const r = (needleAngle.get() * Math.PI) / 180;
    return { cx: CX + NEEDLE * Math.cos(r), cy: CY - NEEDLE * Math.sin(r) };
  });

  const containerStyle = useAnimatedStyle(() => ({
    height: containerH.get(),
  }));

  const svgFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(collapseProgress.get(), [0, 1], [1, 0], Extrapolation.CLAMP),
  }));

  const slimFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(collapseProgress.get(), [0, 1], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]}>

      {/* ── Full speedometer (visible when expanded) ── */}
      <View
        pointerEvents={collapsed ? 'none' : 'box-none'}
        style={styles.fullWrap}
      >
        <Animated.View style={svgFadeStyle}>
          {/* SVG — no touch events */}
          <View pointerEvents="none">
            <Svg width={SVG_W} height={SVG_H} style={{ backgroundColor: 'transparent' }}>
              <Path d={BG_PATH} fill={colors.bg} />

              <Path d={GLOW_ARC} fill="none" stroke={colors.teal} strokeWidth={18} strokeLinecap="round" opacity={0.06} />
              <Path d={GLOW_ARC} fill="none" stroke={colors.teal} strokeWidth={10} strokeLinecap="round" opacity={0.12} />
              <Path d={GLOW_ARC} fill="none" stroke={colors.teal} strokeWidth={5}  strokeLinecap="round" opacity={0.30} />
              <Path d={GLOW_ARC} fill="none" stroke={colors.teal} strokeWidth={1.5} strokeLinecap="round" opacity={0.90} />

              {SECTIONS.map((s, i) => (
                <Path
                  key={s.name}
                  d={sectorPath(s.start, s.end)}
                  fill={i === activeIdx ? colors.teal : colors.surface}
                  // Used to be a flat "#000000" at 2px — a hard black ring
                  // around every wedge on top of the gap that already
                  // separates them, and it didn't soften for light mode. The
                  // same border colour every other card and divider in the
                  // app already uses reads as a seam, not a cutout.
                  stroke={colors.border}
                  strokeWidth={1}
                />
              ))}

              <Circle cx={CX} cy={CY} r={R_IN * 0.22} fill={colors.bg} />
              <AnimatedLine
                x1={CX} y1={CY}
                animatedProps={lineProps}
                stroke={colors.t1}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <AnimatedCircle animatedProps={dotProps} r={4} fill={colors.t1} />
              <Circle cx={CX} cy={CY} r={R_IN * 0.09} fill={colors.teal} />
            </Svg>
          </View>

          {/* Icon buttons positioned in the arc */}
          {SECTIONS.map((s, i) => {
            const isActive = i === activeIdx;
            const pos = polar(R_ICO, s.mid);
            const badge = badgeFor(i, chatBadge, alertsBadge);
            return (
              <Pressable
                key={s.name}
                onPress={() => handlePress(i)}
                style={[styles.iconBtn, { left: pos.x - 26, top: pos.y - 24 }]}
                hitSlop={10}
                // One node per tab, so the badge is read as part of the tab
                // ("Chat, 3 unread") instead of as a stray number after it.
                accessible
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={tabLabel(s.label, badge)}
              >
                <SectionGlyph
                  section={s}
                  active={isActive}
                  size={18}
                  color={isActive ? colors.bg : colors.t3}
                />
                <Text
                  numberOfLines={1}
                  // The arc geometry is fixed, so the label is capped rather
                  // than allowed to scale until it clips.
                  maxFontSizeMultiplier={MAX_SCALE_FIXED}
                  style={[styles.label, { color: isActive ? colors.bg : colors.t3 }]}
                >
                  {s.label}
                </Text>
                {badge > 0 && (
                  <View style={styles.badge} importantForAccessibility="no-hide-descendants">
                    <Text style={styles.badgeText} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
                      {badge > 99 ? '99+' : String(badge)}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </Animated.View>

        {/* Safe area spacer */}
        <View style={{ height: safeBottom }} />
      </View>

      {/* ── Slim tab bar (visible when collapsed) ── */}
      <View
        pointerEvents={collapsed ? 'box-none' : 'none'}
        style={styles.slimWrap}
      >
        <Animated.View style={[styles.slimBar, slimFadeStyle]}>
          <View style={styles.slimRow}>
            {SECTIONS.map((s, i) => {
              const isActive = i === activeIdx;
              const badge = badgeFor(i, chatBadge, alertsBadge);
              return (
                <Pressable
                  key={s.name}
                  onPress={() => handlePress(i)}
                  style={styles.slimBtn}
                  hitSlop={10}
                  // The collapsed bar has no visible text at all, so without
                  // this it is six unnamed buttons to a screen reader.
                  accessible
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={tabLabel(s.label, badge)}
                >
                  <View style={{ position: 'relative' }}>
                    <SectionGlyph
                      section={s}
                      active={isActive}
                      size={22}
                      color={isActive ? colors.teal : colors.t3}
                    />
                    {badge > 0 && (
                      <View style={styles.badgeSlim} importantForAccessibility="no-hide-descendants">
                        <Text style={styles.badgeText} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
                          {badge > 99 ? '99+' : String(badge)}
                        </Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={{ height: safeBottom, backgroundColor: colors.bg }} />
        </Animated.View>
      </View>

    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    zIndex: 100,
    elevation: 10,
  },
  // Full speedometer — anchored to the top of the container
  fullWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  // Slim bar — anchored to the bottom of the container
  slimWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  slimBar: {
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  slimRow: {
    height: SLIM_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
  },
  slimBtn: {
    flex: 1,
    height: SLIM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    position: 'absolute',
    width: 52,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  label: {
    // Was 8pt — below the legibility floor. 11 is the smallest size in the
    // scale, and the arc has room for it.
    fontSize: typography.micro,
    fontWeight: '700',
    marginTop: 1,
    letterSpacing: 0.2,
    textAlign: 'center',
    width: 52,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -6,
    // Sized for 10pt text at the 1.4 cap; the old 14pt box clipped it.
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  badgeSlim: {
    position: 'absolute',
    top: -4,
    right: -7,
    // Sized for 10pt text at the 1.4 cap; the old 14pt box clipped it.
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
