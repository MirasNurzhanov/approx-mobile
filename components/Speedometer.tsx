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
import { useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { useScrollNav } from '@/context/ScrollNavContext';

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
}

const SECTIONS: Section[] = [
  { label: 'Map',      icon: 'map-outline',           activeIcon: 'map',            route: '/(tabs)/map',           name: 'map',           start: 150, end: 180, mid: 165 },
  { label: 'Profile',  icon: 'person-outline',        activeIcon: 'person',         route: '/(tabs)/profile',       name: 'profile',       start: 120, end: 150, mid: 135 },
  { label: 'Chat',     icon: 'chatbubbles-outline',   activeIcon: 'chatbubbles',    route: '/(tabs)/chat',          name: 'chat',          start: 90,  end: 120, mid: 105 },
  { label: 'Alerts',   icon: 'notifications-outline', activeIcon: 'notifications',  route: '/(tabs)/notifications', name: 'notifications', start: 60,  end: 90,  mid: 75  },
  { label: 'Quests',   icon: 'compass-outline',       activeIcon: 'compass',        route: '/(tabs)/quests',        name: 'quests',        start: 30,  end: 60,  mid: 45  },
  { label: 'Settings', icon: 'settings-outline',      activeIcon: 'settings-sharp', route: '/(tabs)/settings',      name: 'settings',      start: 0,   end: 30,  mid: 15  },
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

function matchSection(pathname: string): number {
  const idx = SECTIONS.findIndex(
    s => pathname === s.route || pathname.startsWith(s.route) || pathname.endsWith(`/${s.name}`),
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

  const needleAngle      = useSharedValue(SECTIONS[matchSection(pathname)].mid);
  const containerH       = useSharedValue(SVG_H + safeBottom);
  const collapseProgress = useSharedValue(0); // 0 = full speedometer, 1 = slim bar

  // Sync needle when route changes
  useEffect(() => {
    const idx = matchSection(pathname);
    setActiveIdx(idx);
    needleAngle.value = withSpring(SECTIONS[idx].mid, SPRING);
  }, [pathname]);

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
    containerH.value = withSpring(
      collapsed ? SLIM_H + safeBottomRef.current : SVG_H + safeBottomRef.current,
      SPRING,
    );
    collapseProgress.value = withTiming(collapsed ? 1 : 0, FADE);
  }, [collapsed]);

  function handlePress(idx: number) {
    needleAngle.value = withSpring(SECTIONS[idx].mid, SPRING);
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
            return (
              <Pressable
                key={i}
                onPress={() => handlePress(i)}
                style={[styles.iconBtn, { left: pos.x - 22, top: pos.y - 24 }]}
                hitSlop={10}
              >
                <Ionicons
                  name={isActive ? s.activeIcon : s.icon}
                  size={18}
                  color={isActive ? '#0a0a0a' : '#555'}
                />
                <Text style={[styles.label, { color: isActive ? '#0a0a0a' : '#444' }]}>
                  {s.label}
                </Text>
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
              return (
                <Pressable
                  key={i}
                  onPress={() => handlePress(i)}
                  style={styles.slimBtn}
                  hitSlop={10}
                >
                  <Ionicons
                    name={isActive ? s.activeIcon : s.icon}
                    size={22}
                    color={isActive ? '#00b4a6' : '#444'}
                  />
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
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 8,
    fontWeight: '700',
    marginTop: 1,
    letterSpacing: 0.2,
  },
});
