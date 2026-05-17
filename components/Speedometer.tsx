import Animated, {
  useAnimatedProps,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

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

const SPRING = { damping: 18, stiffness: 150, mass: 0.9 };

// ─── Sections ─────────────────────────────────────────────────────────────────
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Section {
  label: string;
  icon: IoniconName;
  activeIcon: IoniconName;
  route: string;
  name: string;   // bare screen name for fallback matching
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

// Matches both '/(tabs)/map' and '/map' — expo-router may omit the group prefix.
function matchSection(pathname: string): number {
  const idx = SECTIONS.findIndex(
    s => pathname === s.route || pathname.startsWith(s.route) || pathname.endsWith(`/${s.name}`),
  );
  return idx >= 0 ? idx : 0;
}

// Full semicircle background fill path.
const BG_PATH = [
  `M ${(CX - R_OUT).toFixed(2)} ${CY.toFixed(2)}`,
  `A ${R_OUT} ${R_OUT} 0 0 0 ${(CX + R_OUT).toFixed(2)} ${CY.toFixed(2)}`,
  'Z',
].join(' ');

// Outer arc only (no fill close) — used for the teal glow stroke.
const GLOW_ARC = [
  `M ${(CX - R_OUT).toFixed(2)} ${CY.toFixed(2)}`,
  `A ${R_OUT} ${R_OUT} 0 0 0 ${(CX + R_OUT).toFixed(2)} ${CY.toFixed(2)}`,
].join(' ');

// ─── Component ────────────────────────────────────────────────────────────────
export function Speedometer() {
  const router   = useRouter();
  const pathname = usePathname();
  const { bottom: safeBottom } = useSafeAreaInsets();

  const [activeIdx, setActiveIdx] = useState(() => matchSection(pathname));
  const needleAngle = useSharedValue(SECTIONS[matchSection(pathname)].mid);

  // Keep needle in sync when the route changes externally.
  useEffect(() => {
    const idx = matchSection(pathname);
    setActiveIdx(idx);
    needleAngle.value = withSpring(SECTIONS[idx].mid, SPRING);
  }, [pathname]);

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

  return (
    <View style={[styles.container, { paddingBottom: safeBottom }]}>
      {/*
        SVG wrapped in pointerEvents="none" so it never intercepts touches.
        All interaction goes through the Pressable buttons rendered below.
      */}
      <View pointerEvents="none">
        <Svg width={SVG_W} height={SVG_H} style={{ backgroundColor: 'transparent' }}>
          {/* Dark semicircle base */}
          <Path d={BG_PATH} fill="#0a0a0a" />

          {/* Teal glow — layered strokes, widest+faintest first */}
          <Path d={GLOW_ARC} fill="none" stroke="#00b4a6" strokeWidth={18} strokeLinecap="round" opacity={0.06} />
          <Path d={GLOW_ARC} fill="none" stroke="#00b4a6" strokeWidth={10} strokeLinecap="round" opacity={0.12} />
          <Path d={GLOW_ARC} fill="none" stroke="#00b4a6" strokeWidth={5}  strokeLinecap="round" opacity={0.30} />
          <Path d={GLOW_ARC} fill="none" stroke="#00b4a6" strokeWidth={1.5} strokeLinecap="round" opacity={0.90} />

          {/* Sectors */}
          {SECTIONS.map((s, i) => (
            <Path
              key={i}
              d={sectorPath(s.start, s.end)}
              fill={i === activeIdx ? '#00b4a6' : '#141414'}
              stroke="#0a0a0a"
              strokeWidth={2}
            />
          ))}

          {/* Hub */}
          <Circle cx={CX} cy={CY} r={R_IN * 0.22} fill="#0a0a0a" />

          {/* Needle */}
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

      {/* Pressable icon buttons — rendered after the SVG wrapper so they sit
          on top in the stacking order and receive all touch events. */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    zIndex: 100,
    elevation: 10,
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
