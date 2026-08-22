import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { NAV_ARC_R_OUT } from '@/components/navGeometry';
import { NavTrigger } from '@/components/nav/NavTrigger';
import {
  NAV_SECTIONS,
  badgeFor,
  matchSection,
  tabLabel,
  type NavSection,
} from '@/components/navSections';
import { useScrollNav } from '@/context/ScrollNavContext';
import { useNavBadges } from '@/hooks/useNavBadges';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { MAX_SCALE_FIXED, lightColors, type as typography } from '@/constants/theme';
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

// ─── Wedge angles ─────────────────────────────────────────────────────────────
// Where each of the shared NAV_SECTIONS sits on the 0–180° arc. Five wedges of
// 36°, written out rather than derived so one can be nudged without moving its
// neighbours. Keyed by section name so reordering the shared list reorders the
// arc with it.
interface Wedge { start: number; end: number; mid: number }

const WEDGES: Record<string, Wedge> = {
  map:      { start: 144, end: 180, mid: 162 },
  profile:  { start: 108, end: 144, mid: 126 },
  chat:     { start: 72,  end: 108, mid: 90  },
  swifts:   { start: 36,  end: 72,  mid: 54  },
  settings: { start: 0,   end: 36,  mid: 18  },
};

/** The arc's own view of a section: the shared entry plus its angles. */
type Section = NavSection & Wedge;

const SECTIONS: Section[] = NAV_SECTIONS.map((s) => ({ ...s, ...WEDGES[s.name] }));

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


const BG_PATH = [
  `M ${(CX - R_OUT).toFixed(2)} ${CY.toFixed(2)}`,
  `A ${R_OUT} ${R_OUT} 0 0 0 ${(CX + R_OUT).toFixed(2)} ${CY.toFixed(2)}`,
  'Z',
].join(' ');

const GLOW_ARC = [
  `M ${(CX - R_OUT).toFixed(2)} ${CY.toFixed(2)}`,
  `A ${R_OUT} ${R_OUT} 0 0 0 ${(CX + R_OUT).toFixed(2)} ${CY.toFixed(2)}`,
].join(' ');

interface SpeedometerProps {
  /** Name of a NAV_SECTIONS entry (e.g. 'settings') to spotlight — every other
   *  wedge dims and this one pulses coral. Used by the zone tutorial to point
   *  at Settings without a static colour override fighting the arc's own
   *  active/inactive colours once the tutorial ends. */
  highlightSection?: string;
  /** Set on `/market`, which sits outside the tab navigator. See NavTrigger. */
  standalone?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
/**
 * The wheel nav — the app's original bottom navigation, now an opt-in
 * alternative to the tab bar (Settings → Preferences → Wheel navigation bar).
 * Screens render `components/AuraNav` rather than this directly.
 */
export function Speedometer({ highlightSection, standalone }: SpeedometerProps = {}) {
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
  // Shared with the tab bar, so the two nav styles can never show different
  // counts for the same inbox.
  const badges = useNavBadges();

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

  // Coral pulse for the tutorial-spotlighted wedge. A plain 0↔1 loop rather
  // than routing through `animate`: this one has to keep running the whole
  // time the tutorial is up, not settle once like every other value here.
  const highlightPulse = useSharedValue(0);
  useEffect(() => {
    highlightPulse.set(
      highlightSection && !reduceMotion
        ? withRepeat(
            withSequence(
              withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }),
              withTiming(0, { duration: 650, easing: Easing.in(Easing.cubic) }),
            ),
            -1,
          )
        : 0,
    );
  }, [highlightSection, reduceMotion, highlightPulse]);
  const highlightStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + highlightPulse.get() * 0.45,
    transform: [{ scale: 1 + highlightPulse.get() * 0.18 }],
  }));

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

  /**
   * The needle sweeps on the press rather than on arrival, so the arc answers
   * the tap at once. Which wedge is *lit* still follows the route, since that
   * is what it reports — lighting it here as well meant a failed navigation
   * left the arc claiming to be somewhere the app never went.
   *
   * Navigation itself is NavTrigger's, which runs this first and then hands
   * the move to the navigator.
   */
  function sweepNeedle(idx: number) {
    needleAngle.set(animate(SECTIONS[idx].mid, true));
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
              <Path d={BG_PATH} fill={colors.navBg} />

              <Path d={GLOW_ARC} fill="none" stroke={colors.navActive} strokeWidth={18} strokeLinecap="round" opacity={0.06} />
              <Path d={GLOW_ARC} fill="none" stroke={colors.navActive} strokeWidth={10} strokeLinecap="round" opacity={0.12} />
              <Path d={GLOW_ARC} fill="none" stroke={colors.navActive} strokeWidth={5}  strokeLinecap="round" opacity={0.30} />
              <Path d={GLOW_ARC} fill="none" stroke={colors.navActive} strokeWidth={1.5} strokeLinecap="round" opacity={0.90} />

              {SECTIONS.map((s, i) => (
                <Path
                  key={s.name}
                  d={sectorPath(s.start, s.end)}
                  // Opaque both ways. An unselected wedge used to be a 12%
                  // wash of the inactive text colour, which put a grey veil
                  // over the whole dial in light mode; `navWedge` is that same
                  // colour flattened in dark mode and plain white in light, so
                  // the arc is a solid surface and the selected wedge is the
                  // only coloured thing on it.
                  fill={i === activeIdx ? colors.navActive : colors.navWedge}
                  // Used to be a flat "#000000" at 2px — a hard black ring
                  // around every wedge on top of the gap that already
                  // separates them, and it didn't soften for light mode. The
                  // same border colour every other card and divider in the
                  // app already uses reads as a seam, not a cutout.
                  stroke={colors.navBorder}
                  // 1.5 rather than 1: now that an unselected wedge is the
                  // same colour as the arc behind it, this seam is the only
                  // thing that makes the dial read as segmented at all.
                  strokeWidth={1.5}
                />
              ))}

              <Circle cx={CX} cy={CY} r={R_IN * 0.22} fill={colors.navBg} />
              <AnimatedLine
                x1={CX} y1={CY}
                animatedProps={lineProps}
                stroke={colors.navActive}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <AnimatedCircle animatedProps={dotProps} r={4} fill={colors.navActive} />
              <Circle cx={CX} cy={CY} r={R_IN * 0.09} fill={colors.navActive} />
            </Svg>
          </View>

          {/* Icon buttons positioned in the arc */}
          {SECTIONS.map((s, i) => {
            const isActive = i === activeIdx;
            const pos = polar(R_ICO, s.mid);
            const badge = badgeFor(i, badges.chat, badges.alerts);
            const isHighlighted = highlightSection === s.name;
            const isDimmed = !!highlightSection && !isHighlighted;
            const wedgeColor = isHighlighted ? lightColors.coral : isActive ? colors.navOnActive : colors.navInactive;
            return (
              <NavTrigger
                key={s.name}
                section={s}
                selected={isActive}
                label={tabLabel(s.label, badge)}
                standalone={standalone}
                onPress={() => sweepNeedle(i)}
                style={[
                  styles.iconBtn,
                  { left: pos.x - 26, top: pos.y - 24 },
                  isDimmed && styles.tutorialDimmed,
                ]}
              >
                <Animated.View style={isHighlighted ? highlightStyle : undefined}>
                  <SectionGlyph section={s} active={isActive} size={18} color={wedgeColor} />
                </Animated.View>
                <Text
                  numberOfLines={1}
                  // The arc geometry is fixed, so the label is capped rather
                  // than allowed to scale until it clips.
                  maxFontSizeMultiplier={MAX_SCALE_FIXED}
                  style={[styles.label, { color: wedgeColor }]}
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
              </NavTrigger>
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
              const badge = badgeFor(i, badges.chat, badges.alerts);
              const isHighlighted = highlightSection === s.name;
              const isDimmed = !!highlightSection && !isHighlighted;
              const wedgeColor = isHighlighted ? lightColors.coral : isActive ? colors.navActive : colors.navInactive;
              return (
                // The collapsed bar has no visible text at all, so without the
                // spoken label NavTrigger attaches it is five unnamed buttons
                // to a screen reader.
                <NavTrigger
                  key={s.name}
                  section={s}
                  selected={isActive}
                  label={tabLabel(s.label, badge)}
                  standalone={standalone}
                  onPress={() => sweepNeedle(i)}
                  style={[styles.slimBtn, isDimmed && styles.tutorialDimmed]}
                >
                  <Animated.View style={[{ position: 'relative' }, isHighlighted && highlightStyle]}>
                    <SectionGlyph section={s} active={isActive} size={22} color={wedgeColor} />
                    {badge > 0 && (
                      <View style={styles.badgeSlim} importantForAccessibility="no-hide-descendants">
                        <Text style={styles.badgeText} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
                          {badge > 99 ? '99+' : String(badge)}
                        </Text>
                      </View>
                    )}
                  </Animated.View>
                </NavTrigger>
              );
            })}
          </View>
          <View style={{ height: safeBottom, backgroundColor: colors.navBg }} />
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
    backgroundColor: colors.navBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.navBorder,
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
  tutorialDimmed: { opacity: 0.35 },
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
