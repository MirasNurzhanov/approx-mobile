import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import type { PressableProps, StyleProp, ViewProps, ViewStyle } from 'react-native';

import { IOS_MAJOR_VERSION } from '@/constants/platform';
import { withAlpha } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

/**
 * A piece of floating chrome that lets the screen behind it show through.
 *
 * The one place the app's glass recipe lives. `components/nav/ApproxTabBar` had
 * it inline first — a `BlurView` under a tinted wash, iOS only — and this is
 * that recipe extracted so the map's controls and anything after them get the
 * same treatment rather than each re-deriving it and landing somewhere
 * slightly different.
 *
 * ## Why iOS 26 and newer only
 *
 * `expo-blur` on Android does not blur what is behind the window. It renders a
 * flat translucent fill, which over a map reads as a washed-out grey rectangle
 * with the map faintly visible through it — worse than either a solid button
 * or a real blur, because it looks like a rendering fault rather than a
 * material. So `GLASS` gates it, and Android gets an opaque surface: the same
 * component, the same geometry, a different fill. This is the same call
 * `ApproxTabBar` already makes, and it is deliberately not a TODO — it is the
 * correct output for a platform whose blur does not sample the background.
 *
 * Older iOS is excluded for a different reason: capability is not the question
 * there, consistency is. See `supportsBackdropBlur`.
 *
 * ## Why there is still a wash over the blur
 *
 * A blur on its own takes its colour from whatever is behind it, so a button
 * over a dark park and the same button over a bright road are two different
 * colours, and an icon legible on one disappears on the other. The wash is an
 * opacity floor: enough of the theme's own surface colour to keep contrast
 * predictable, little enough that the movement behind it still reads as depth.
 * `0.55` is lighter than the tab bar's `0.82` on purpose — the bar is a
 * permanent frame that should sit still, and these are small controls floating
 * over a map that is the point of the screen.
 *
 * ## Contrast
 *
 * Everything drawn *on* glass keeps the same token it had on a solid surface
 * (`t2` for a map control's icon). That holds because the wash never drops
 * below the floor above, so the effective background stays within a few
 * percent of `colors.surface` — the ratio an icon was checked against does not
 * move. Lowering `opacity` below ~0.5 would break that, which is why it is a
 * prop with a floor rather than a free number.
 */

/** The iOS release that introduced the Liquid Glass appearance system-wide.
 *  Shared with `constants/platform.ts`, which gates navigation chrome on the
 *  same number for the same reason. */
export const GLASS_MIN_IOS = 26;

/**
 * Whether an OS should draw chrome as glass. See the note above.
 *
 * Two conditions, and the version one is not decoration. `expo-blur` will
 * happily blur on iOS 15, but glass is a *system* look: on a release whose own
 * navigation bars, sheets and controls are opaque, a blurred button in the
 * middle of them does not read as native, it reads as a mistake. It only looks
 * right where the rest of the OS agrees, so it is drawn only there and every
 * older release keeps the solid surface it already had.
 *
 * A pure function taking the OS and version rather than a bare
 * `Platform.OS === 'ios' && …`, for the same reason `constants/platform.ts`
 * splits `resolveIOSMajorVersion` out: the gate can then be tested without
 * mocking react-native. Mocking it is not merely awkward here — resetting the
 * module registry to swap `Platform` hands the component a second copy of
 * React, and the render throws somewhere that names neither the test nor the
 * component.
 */
export function supportsBackdropBlur(os: string, majorVersion: number): boolean {
  return os === 'ios' && majorVersion >= GLASS_MIN_IOS;
}

/** Whether *this* device should. Read once, at import.
 *
 *  `IOS_MAJOR_VERSION` rather than parsing `Platform.Version` again: it is a
 *  string on iOS and a *number* on Android, where it is the API level — so
 *  Android 26 would sail straight past a naive comparison and turn this on for
 *  a platform that cannot do it. That parsing already exists, correctly, in
 *  one place. */
export const GLASS = supportsBackdropBlur(Platform.OS, IOS_MAJOR_VERSION);

/**
 * Below this, the wash stops being an opacity floor and the icon on top starts
 * depending on what the map happens to be showing. Callers can ask for less
 * glass, not for none.
 */
const MIN_OPACITY = 0.5;

/** Extends `ViewProps` so a caller can hand this the accessibility props the
 *  plain `View` it replaced was carrying — a wrapper that silently dropped
 *  `accessibilityLabel` would turn a labelled badge into an unreadable one. */
export interface GlassSurfaceProps extends ViewProps {
  children?: ReactNode;
  /** Geometry, border and radius. Supply the same style the solid version had;
   *  this component only replaces the *fill*. */
  style?: StyleProp<ViewStyle>;
  /**
   * How much of `colors.surface` sits over the blur. Clamped to
   * [`MIN_OPACITY`, 1] — see the contrast note above.
   */
  opacity?: number;
  /** `expo-blur`'s intensity. 40 matches the tab bar. */
  intensity?: number;
  /**
   * Which wash sits over the blur.
   *
   * `surface` and `surface2` are the app's own tokens, for chrome over the
   * app's own background — they follow the theme, so the same control is light
   * in light mode and dark in dark mode.
   *
   * `dark` is fixed, and is for chrome floating over *media*: a camera preview,
   * a video, a photo. Those have no theme and no predictable brightness, and
   * the icons on top of them are white in both modes — so a wash that followed
   * the theme would make a white glyph unreadable on a light background half
   * the time. The camera controls and the story viewer's buttons already used
   * hand-written `rgba(0,0,0,0.45)` fills for exactly this reason; this is that
   * fill with a blur behind it.
   */
  tone?: 'surface' | 'surface2' | 'dark';
}

/**
 * The material on its own, as an absolute fill.
 *
 * For the common case that is *not* a wrapper: a `Pressable` whose own style
 * already is the button. Drop this in as its first child and the button keeps
 * owning its geometry, its border and its press state, while the fill behind
 * its icon becomes glass.
 *
 * Two things the host has to provide, and neither can be done from in here:
 * `overflow: 'hidden'` (or the blur is a rectangle behind a rounded button and
 * the corners show as four grey nicks) and a transparent `backgroundColor` (or
 * the solid fill it used to have sits on top of the blur and nothing shows
 * through).
 */
export function GlassBackdrop({
  opacity = 0.55,
  intensity = 40,
  tone = 'surface',
}: Pick<GlassSurfaceProps, 'opacity' | 'intensity' | 'tone'> = {}) {
  const { colors, themeMode } = useTheme();
  const overMedia = tone === 'dark';
  const base = overMedia
    ? '#000000'
    : tone === 'surface2' ? colors.surface2 : colors.surface;

  // Over media the wash is a *scrim*, so the floor that protects contrast on a
  // themed surface would be far too heavy — it would black the camera preview
  // out behind its own controls. The number that matters there is the one that
  // keeps a white glyph legible over an unpredictable frame, which is much
  // lower and is what the hand-written fills already used.
  const wash = overMedia
    ? Math.min(Math.max(opacity, 0.0), 1)
    : Math.min(Math.max(opacity, MIN_OPACITY), 1);

  if (!GLASS) {
    return (
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: overMedia ? withAlpha(base, wash) : base },
        ]}
      />
    );
  }
  return (
    <>
      {/* Decoration only: neither layer may take a touch meant for the control
          it sits behind. */}
      <BlurView
        pointerEvents="none"
        intensity={intensity}
        tint={overMedia ? 'dark' : themeMode === 'dark' ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(base, wash) }]} />
    </>
  );
}

export function GlassSurface({
  children,
  style,
  opacity,
  intensity,
  tone,
  ...rest
}: GlassSurfaceProps) {
  return (
    <View
      // `styles.clip` before `style` so a caller can still override the
      // radius, but *after* nothing — a passed `backgroundColor` would land on
      // top of the blur and hide it. Callers drop theirs; see the map's
      // `nearbyBadge`.
      style={[styles.clip, style]}
      {...rest}
    >
      <GlassBackdrop opacity={opacity} intensity={intensity} tone={tone} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', backgroundColor: 'transparent' },
});

/**
 * A pressable whose fill is glass — the shape almost every icon button in the
 * app already is.
 *
 * Exists because the alternative is the same three-line edit at every call
 * site: drop the `backgroundColor`, add `overflow: 'hidden'`, insert a
 * `<GlassBackdrop />` before the icon. Done thirty times by hand that is thirty
 * chances to forget one of the three, and forgetting the first is invisible on
 * a simulator running the one OS version where glass is off.
 *
 * Takes everything `Pressable` takes, including a function `style` — the
 * `({ pressed }) => [...]` form this codebase uses everywhere — so converting a
 * call site is renaming the element and deleting one style property.
 *
 * The caller still owns size, radius, border and press feedback. This owns the
 * fill and the clipping, and nothing else.
 */
export function GlassIconButton({
  children,
  style,
  opacity,
  intensity,
  tone,
  ...pressable
}: PressableProps & Pick<GlassSurfaceProps, 'opacity' | 'intensity' | 'tone'>) {
  return (
    <Pressable
      {...pressable}
      style={(state) => [
        styles.clip,
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      <GlassBackdrop opacity={opacity} intensity={intensity} tone={tone} />
      {children as ReactNode}
    </Pressable>
  );
}
