import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { usePathname } from 'expo-router';
import { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

import { NAV_BAR_GAP, NAV_BAR_H, NAV_BAR_INSET } from '@/components/navGeometry';
import { NavTrigger } from '@/components/nav/NavTrigger';
import {
  NAV_SECTIONS,
  badgeFor,
  matchSection,
  tabLabel,
  type NavSection,
} from '@/components/navSections';
import { useScrollNav } from '@/context/ScrollNavContext';
import { useTheme } from '@/context/ThemeContext';
import { useNavBadges } from '@/hooks/useNavBadges';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { MAX_SCALE_FIXED, lightColors, type as typography, withAlpha } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';

const FADE = { duration: 220, easing: Easing.out(Easing.cubic) };

/**
 * On iOS the bar is glass: a blur with a tinted wash over it, the way every
 * system bar has looked since iOS 26 made the tab bar a floating capsule. On
 * Android `expo-blur` falls back to a flat translucent fill that reads as a
 * washed-out rectangle, so it gets the solid colour instead.
 */
const GLASS = Platform.OS === 'ios';

function SectionGlyph({
  section,
  active,
  size,
  color,
}: {
  section: NavSection;
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

interface ApproxTabBarProps {
  /** Name of a NAV_SECTIONS entry (e.g. 'settings') to spotlight — every other
   *  item dims and this one pulses coral. Same contract the wheel honours, so
   *  the zone tutorial can point at Settings without caring which nav is on. */
  highlightSection?: string;
  /** True on any screen outside the tab navigator — today just `/market`.
   *  See NavTrigger. Every screen inside the navigator draws this on Android,
   *  where it *is* the bar style — see constants/platform's
   *  `BAR_STYLE_IS_NATIVE` and components/ApproxNav. */
  standalone?: boolean;
}

/**
 * The app's default nav, and — see `BAR_STYLE_IS_NATIVE` — Android's only one
 * for bar style: `react-native-screens`' Material 3 bottom nav exposes just a
 * colour for its press ripple and a colour for its selected-tab indicator, no
 * way to turn the ripple off and no way to resize or reshape the indicator,
 * so this draws Android's bar itself instead. iOS keeps the real
 * `UITabBarController` and only reaches this component on `/market`.
 *
 * A floating capsule rather than an edge-to-edge bar: that is the shape iOS 26
 * uses, it keeps the map visible under both ends, and it gives the same result
 * on older iOS and on Android instead of one layout for the newest phones and
 * another for everything else.
 *
 * The selected tab fills its *whole* item — icon, label and all — rather than
 * sitting a small pill behind just the icon. Each item is already its own
 * flex slice of the row, so a fill sized to the slice reads as one of several
 * divided sections lighting up, not a badge floating over a shared bar. No tab
 * has a press state of its own (no ripple, no opacity dip): the fill lighting
 * up *is* the feedback, and it lands the instant the route changes rather
 * than racing a separate animation to say the same thing.
 */
export function ApproxTabBar({ highlightSection, standalone }: ApproxTabBarProps = {}) {
  const pathname = usePathname();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { collapsed } = useScrollNav();
  const { colors, themeMode } = useTheme();
  const reduceMotion = useReduceMotion();
  // Kept despite react-doctor/react-compiler-no-manual-memoization: dropping it
  // is not a no-op. Compiling this file with and without the wrapper shrinks
  // this component's cache from 42 slots to 10 — the compiler stops caching
  // `makeStyles(colors)` and every `styles.*` read that hangs off it. Same
  // finding as `ApproxLoader`; the bar renders on every screen.
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Which item is lit is a pure function of the route, so it is worked out on
  // render rather than mirrored into state by an effect. Read from the path
  // rather than from the trigger's own `isFocused` so the standalone bar on
  // `/market`, which has no trigger map, resolves it the same way.
  const activeIdx = matchSection(pathname);
  const badges = useNavBadges();

  // Scrolling down tucks the bar away and idling brings it back — the same
  // signal the wheel collapses on, and the same thing iOS 26's own
  // `minimizeBehavior` does with a native tab bar. Reduce Motion gets the end
  // state with no travel.
  const hideDistance = NAV_BAR_H + NAV_BAR_GAP + safeBottom;
  const hideStyle = useAnimatedStyle(() => {
    const y = collapsed ? hideDistance : 0;
    const o = collapsed ? 0 : 1;
    return reduceMotion
      ? { transform: [{ translateY: y }], opacity: o }
      : { transform: [{ translateY: withTiming(y, FADE) }], opacity: withTiming(o, FADE) };
  }, [collapsed, hideDistance, reduceMotion]);

  return (
    <Animated.View
      style={[styles.root, { bottom: safeBottom + NAV_BAR_GAP }, hideStyle]}
      // `box-none` so the margins either side of the capsule stay transparent
      // to touch and the map keeps panning through them — unlike the wheel,
      // which has to absorb its whole rectangle.
      pointerEvents={collapsed ? 'none' : 'box-none'}
      accessibilityRole="tablist"
    >
      <View style={styles.bar}>
        {GLASS && (
          <BlurView
            intensity={40}
            tint={themeMode === 'dark' ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        )}
        <View style={[StyleSheet.absoluteFill, styles.fill]} />

        <View style={styles.row}>
          {NAV_SECTIONS.map((s, i) => {
            const isActive = i === activeIdx;
            const badge = badgeFor(i, badges.chat, badges.alerts);
            const isHighlighted = highlightSection === s.name;
            const isDimmed = !!highlightSection && !isHighlighted;
            // The highlighted state overrides "active": a tutorial pointing
            // at Settings still pulses coral even if Settings is the screen
            // you are already on.
            const showActiveFill = isActive && !isHighlighted;
            // Icon and label now share one filled section rather than a pill
            // wrapping just the icon, so both need the fill's contrast colour
            // rather than the bar-background one the label used to sit on.
            const contentColor = isHighlighted
              ? lightColors.coral
              : showActiveFill
                ? colors.navOnActive
                : colors.navInactive;

            return (
              <NavTrigger
                key={s.name}
                section={s}
                selected={isActive}
                label={tabLabel(s.label, badge)}
                standalone={standalone}
                style={[styles.item, isDimmed && styles.dimmed]}
              >
                <View
                  style={[
                    styles.sectionFill,
                    showActiveFill && { backgroundColor: colors.navActive },
                    isHighlighted && { backgroundColor: withAlpha(lightColors.coral, 0.18) },
                  ]}
                >
                  <View style={styles.iconWrap}>
                    <SectionGlyph section={s} active={isActive} size={20} color={contentColor} />
                    {badge > 0 && (
                      <View style={styles.badge} importantForAccessibility="no-hide-descendants">
                        <Text style={styles.badgeText} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
                          {badge > 99 ? '99+' : String(badge)}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text
                    numberOfLines={1}
                    // The bar's height is fixed, so the label is capped rather
                    // than allowed to scale until it clips.
                    maxFontSizeMultiplier={MAX_SCALE_FIXED}
                    style={[styles.label, { color: contentColor }, isActive && styles.labelActive]}
                  >
                    {s.label}
                  </Text>
                </View>
              </NavTrigger>
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: {
    position: 'absolute',
    left: NAV_BAR_INSET,
    right: NAV_BAR_INSET,
    zIndex: 100,
    elevation: 10,
    // The shadow lives out here rather than on `bar`, which clips to its own
    // bounds to contain the blur — and a layer that clips to its bounds clips
    // its own shadow away with everything else. Same radius so the shadow
    // follows the capsule instead of boxing it.
    borderRadius: NAV_BAR_H / 2,
    boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
  },
  bar: {
    height: NAV_BAR_H,
    // A capsule, not a rounded rectangle: half the height, so the ends stay
    // circular whatever NAV_BAR_H is set to.
    borderRadius: NAV_BAR_H / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.navBorder,
    // Clips the blur and the fill to the capsule.
    overflow: 'hidden',
  },
  // Sits over the blur. Nearly opaque on iOS so the bar still reads as white
  // (or black) rather than as whatever is scrolling underneath it, and fully
  // opaque on Android where there is no blur to show through.
  fill: { backgroundColor: GLASS ? withAlpha(colors.navBg, 0.82) : colors.navBg },
  row: {
    flex: 1,
    flexDirection: 'row',
    // `stretch`, not `center`: each item fills the row's full height, so its
    // section fill does too rather than sitting a small pill in the middle
    // of a taller, uncoloured slice.
    alignItems: 'stretch',
    // No padding, deliberately. Any inset here leaves a band of bar showing
    // outside the first and last sections, so Map's fill stops short of the
    // capsule's left cap and Settings' of its right — the selected section
    // reads as floating inside the bar rather than as part of it. At zero the
    // outer sections run right into the caps, and `bar`'s `overflow: hidden`
    // trims them to the curve. Only `gap` separates the sections now, which
    // is interior and so never touches the two ends.
    gap: 4,
  },
  // Every item is its own flex slice of the row; a fill sized to `flex: 1`
  // fills that whole slice, which is what makes the selected one read as one
  // of several divided sections lighting up rather than a pill floating over
  // a shared bar. `999` rather than a computed half-height caps it at a full
  // capsule however tall the slice ends up being — which at full row height is
  // exactly the cap radius `bar` uses, so the outer sections trace its ends.
  item: { flex: 1 },
  sectionFill: {
    flex: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.35 },
  label: {
    fontSize: typography.micro,
    fontWeight: '600',
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  labelActive: { fontWeight: '800' },
  badge: {
    position: 'absolute',
    // `iconWrap` hugs the glyph tightly now (it used to be a wider pill with
    // the icon centred inside it), so the badge sits closer in to land back
    // on the icon's own corner instead of drifting into empty space.
    top: -6,
    right: -8,
    // Sized for 10pt text at the 1.4 cap.
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.red,
    // The ring is what keeps the count readable when Chat is the selected tab
    // in light mode: red on the orange pill is barely a boundary on its own.
    borderWidth: 2,
    borderColor: colors.navBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
