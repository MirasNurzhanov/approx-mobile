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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { useScrollNav } from '@/context/ScrollNavContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { refreshAlertsCount, useAlertsCount } from '@/services/alerts';
import { api } from '@/services/api';
import { MAX_SCALE_FIXED, type as typography } from '@/constants/theme';

// ─── Animated SVG primitives ──────────────────────────────────────────────────
const AnimatedLine   = Animated.createAnimatedComponent(Line);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ─── Geometry ─────────────────────────────────────────────────────────────────
const { width: W } = Dimensions.get('window');
const R_OUT  = W / 2 - 4;
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

/**
 * How far above the safe-area inset a control of `width`, inset `fromRight`
 * points from the right edge, has to sit to clear the nav arc.
 *
 * Takes the control's whole footprint rather than a single x on purpose: the
 * arc rises toward the middle of the screen, so a control near the right edge
 * is tallest under its *inner* edge. Measuring at its centre leaves the arc
 * cutting through the bottom corner nearest the middle.
 *
 * Measured against the expanded arc, not the collapsed slim bar: overshooting
 * while collapsed only leaves a larger gap, whereas undershooting overlaps.
 */
export function navArcClearance(fromRight: number, width: number): number {
  const centre = W / 2;
  const near = fromRight;          // the control's right side
  const far = fromRight + width;   // its left side
  // Closest the footprint gets to the arc's apex, where the arc is tallest.
  const d =
    near <= centre && far >= centre
      ? 0
      : Math.min(Math.abs(centre - near), Math.abs(centre - far));
  return d >= R_OUT ? 0 : Math.sqrt(R_OUT * R_OUT - d * d);
}

// ─── Badge indices ────────────────────────────────────────────────────────────
const CHAT_IDX = 2; // 'Chat' is index 2

// ─── Sections ─────────────────────────────────────────────────────────────────
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Section {
  label: string;
  icon: IoniconName;
  activeIcon: IoniconName;
  route: string;
  name: string;
  start: number;
  end: number;
  mid: number;
  /** Extra path fragments that should light this wedge. A pushed screen owned
   *  by a section keeps its parent selected instead of falling back to Map. */
  owns?: string[];
}

const SECTIONS: Section[] = [
  { label: 'Map',      icon: 'map-outline',         activeIcon: 'map',            route: '/(tabs)/map',      name: 'map',      start: 150, end: 180, mid: 165 },
  { label: 'Profile',  icon: 'person-outline',      activeIcon: 'person',         route: '/(tabs)/profile',  name: 'profile',  start: 120, end: 150, mid: 135 },
  { label: 'Messages', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles',    route: '/(tabs)/chat',     name: 'chat',     start: 90,  end: 120, mid: 105, owns: ['notification', 'messages', 'clubs', 'create-club'] },
  { label: 'Swifts',   icon: 'play-circle-outline', activeIcon: 'play-circle',    route: '/(tabs)/swifts',   name: 'swifts',   start: 60,  end: 90,  mid: 75  },
  { label: 'Quests',   icon: 'compass-outline',     activeIcon: 'compass',        route: '/(tabs)/quests',   name: 'quests',   start: 30,  end: 60,  mid: 45  },
  { label: 'Settings', icon: 'settings-outline',    activeIcon: 'settings-sharp', route: '/(tabs)/settings', name: 'settings', start: 0,   end: 30,  mid: 15  },
];

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

  const [activeIdx, setActiveIdx] = useState(() => matchSection(pathname));
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

  // Sync needle when route changes
  useEffect(() => {
    const idx = matchSection(pathname);
    setActiveIdx(idx);
    needleAngle.value = animate(SECTIONS[idx].mid, true);
  }, [pathname, animate]);

  // Animate transition when collapsed state or safeBottom changes
  const safeBottomRef = useRef(safeBottom);
  safeBottomRef.current = safeBottom;

  useEffect(() => {
    // Immediate layout update for safeBottom change (no spring)
    containerH.value = collapsed
      ? SLIM_H + safeBottom
      : SVG_H + safeBottom;
  }, [safeBottom]);

  useEffect(() => {
    containerH.value = animate(
      collapsed ? SLIM_H + safeBottomRef.current : SVG_H + safeBottomRef.current,
      true,
    );
    collapseProgress.value = animate(collapsed ? 1 : 0, false);
  }, [collapsed]);

  function handlePress(idx: number) {
    needleAngle.value = animate(SECTIONS[idx].mid, true);
    setActiveIdx(idx);
    router.navigate(SECTIONS[idx].route as any);
  }

  const lineProps = useAnimatedProps(() => {
    const r = (needleAngle.value * Math.PI) / 180;
    return { x2: CX + NEEDLE * Math.cos(r), y2: CY - NEEDLE * Math.sin(r) };
  });

  const dotProps = useAnimatedProps(() => {
    const r = (needleAngle.value * Math.PI) / 180;
    return { cx: CX + NEEDLE * Math.cos(r), cy: CY - NEEDLE * Math.sin(r) };
  });

  const containerStyle = useAnimatedStyle(() => ({
    height: containerH.value,
  }));

  const svgFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(collapseProgress.value, [0, 1], [1, 0], Extrapolation.CLAMP),
  }));

  const slimFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(collapseProgress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
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
              <Path d={BG_PATH} fill="#0a0a0a" />

              <Path d={GLOW_ARC} fill="none" stroke="#00b4a6" strokeWidth={18} strokeLinecap="round" opacity={0.06} />
              <Path d={GLOW_ARC} fill="none" stroke="#00b4a6" strokeWidth={10} strokeLinecap="round" opacity={0.12} />
              <Path d={GLOW_ARC} fill="none" stroke="#00b4a6" strokeWidth={5}  strokeLinecap="round" opacity={0.30} />
              <Path d={GLOW_ARC} fill="none" stroke="#00b4a6" strokeWidth={1.5} strokeLinecap="round" opacity={0.90} />

              {SECTIONS.map((s, i) => (
                <Path
                  key={i}
                  d={sectorPath(s.start, s.end)}
                  fill={i === activeIdx ? '#00b4a6' : '#141414'}
                  stroke="#0a0a0a"
                  strokeWidth={2}
                />
              ))}

              <Circle cx={CX} cy={CY} r={R_IN * 0.22} fill="#0a0a0a" />
              <AnimatedLine
                x1={CX} y1={CY}
                animatedProps={lineProps}
                stroke="#ffffff"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <AnimatedCircle animatedProps={dotProps} r={4} fill="#ffffff" />
              <Circle cx={CX} cy={CY} r={R_IN * 0.09} fill="#00b4a6" />
            </Svg>
          </View>

          {/* Icon buttons positioned in the arc */}
          {SECTIONS.map((s, i) => {
            const isActive = i === activeIdx;
            const pos = polar(R_ICO, s.mid);
            const badge = badgeFor(i, chatBadge, alertsBadge);
            return (
              <Pressable
                key={i}
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
                <Ionicons
                  name={isActive ? s.activeIcon : s.icon}
                  size={18}
                  color={isActive ? '#0a0a0a' : '#555'}
                />
                <Text
                  numberOfLines={1}
                  // The arc geometry is fixed, so the label is capped rather
                  // than allowed to scale until it clips.
                  maxFontSizeMultiplier={MAX_SCALE_FIXED}
                  style={[styles.label, { color: isActive ? '#0a0a0a' : '#444' }]}
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
                  key={i}
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
                    <Ionicons
                      name={isActive ? s.activeIcon : s.icon}
                      size={22}
                      color={isActive ? '#00b4a6' : '#444'}
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
          <View style={{ height: safeBottom, backgroundColor: '#0a0a0a' }} />
        </Animated.View>
      </View>

    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
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
    backgroundColor: '#0a0a0a',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
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
    backgroundColor: '#ef4444',
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
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
