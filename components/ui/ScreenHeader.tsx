import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconBack } from '@/components/ui/icons';
import { isIOS26OrNewer } from '@/constants/platform';
import { fonts, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

/** A trailing action such as Save. Becomes a real UIBarButtonItem on iOS 26. */
export interface ScreenHeaderAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** The screen's primary action. Gets UIKit's `prominent` treatment. */
  prominent?: boolean;
}

/**
 * A search field in the navigation bar.
 *
 * On iOS 26 this is a real `UISearchController` attached to the screen's
 * `navigationItem` — the arrangement Apple's own navigation-bar sample uses.
 * Everywhere else it is ignored, and the screen keeps whatever field it draws
 * for itself.
 */
export interface ScreenHeaderSearch {
  placeholder?: string;
  autoFocus?: boolean;
  onChangeText: (text: string) => void;
  /** The keyboard's Search key. */
  onSubmit?: (text: string) => void;
  onCancel?: () => void;
}

interface ScreenHeaderProps {
  /** Shown as the navigation bar title on iOS 26, and as the heading below it
   *  everywhere else. */
  title: string;
  /**
   * A line of context under the title.
   *
   * UINavigationBar has no subtitle slot that react-native-screens exposes, so
   * on iOS 26 this becomes a caption directly beneath the system bar rather
   * than being dropped — it is content, not decoration.
   */
  subtitle?: string;
  /** Trailing action. Native bar button on iOS 26, a text button otherwise. */
  action?: ScreenHeaderAction;
  /** Search field. A native UISearchController on iOS 26, ignored otherwise. */
  search?: ScreenHeaderSearch;
  /** Trailing non-interactive content, e.g. a saving spinner. Fallback only —
   *  UIKit has no bar button item for "a spinner". */
  accessory?: React.ReactNode;
  /** Where the back button goes. Defaults to `router.back()`, which is also
   *  what the native back button does, so most screens can leave it. */
  onBack?: () => void;
  /**
   * The screen's existing header markup, rendered verbatim when the system is
   * not drawing one. Screens whose header is the standard title-over-subtitle
   * row leave this out and get that layout for free.
   */
  children?: React.ReactNode;
}

/**
 * The one place the app decides who draws a screen's navigation bar.
 *
 * On iOS 26 and newer this renders no view at all. It sets the native stack's
 * options instead, so UIKit draws a real UINavigationBar — which is the only
 * way to get the Liquid Glass appearance, the system back button with the
 * previous screen's title, and the scroll-edge behaviour. Deliberately minimal
 * options: no `headerStyle` background, no `headerTransparent`, no
 * `scrollEdgeEffects` override, because each of those replaces part of the
 * system appearance with something static. Only `headerTintColor` is set, and a
 * tint is what UIKit expects an app to supply.
 *
 * Everywhere else — iOS 25 and below, Android, web — it renders the app's own
 * header exactly as before. Nothing about that path changed.
 *
 * Screens pair this with `useScreenTopInset`, which stops them padding for a
 * status bar the system header has already accounted for.
 */
export function ScreenHeader({
  title,
  subtitle,
  action,
  search,
  accessory,
  onBack,
  children,
}: ScreenHeaderProps) {
  const { colors } = useTheme();

  // The latest handlers, read at call time. Kept in refs so the memo below can
  // depend on stable primitives only: `options` is passed to Stack.Screen,
  // which calls navigation.setOptions from an effect keyed on that object, and
  // a fresh object every render would set options on every render.
  const actionRef = useRef(action);
  const searchRef = useRef(search);
  useEffect(() => {
    actionRef.current = action;
    searchRef.current = search;
  });

  const actionLabel = action?.label;
  const actionDisabled = action?.disabled ?? false;
  const actionProminent = action?.prominent ?? false;
  const searchPlaceholder = search?.placeholder;
  const searchAutoFocus = search?.autoFocus ?? false;
  const hasSearch = !!search;
  const tint = colors.teal;

  const nativeOptions = useMemo(() => {
    if (!isIOS26OrNewer) return null;
    return {
      headerShown: true,
      title,
      // A tint, not a background: it colours the back chevron and the title
      // without replacing the material behind them.
      headerTintColor: tint,
      // Chevron only. UIKit's default puts the previous screen's title beside
      // it, which coming out of a tab means the back button reads "Map" or
      // "Settings" — the name of a tab, next to the name of the screen you are
      // on. `minimal` is the system's own option for this, so the long-press
      // history menu still works.
      headerBackButtonDisplayMode: 'minimal' as const,
      ...(actionLabel
        ? {
            // The native bar-button API. Marked unstable by React Navigation,
            // taken deliberately: a React view in `headerRight` is drawn *over*
            // the bar and gets none of UIKit's iOS 26 treatment, which is the
            // whole point of this path. Supported by the installed
            // @react-navigation/native-stack 7.15.1.
            unstable_headerRightItems: () => [
              {
                type: 'button' as const,
                label: actionLabel,
                variant: actionProminent ? ('prominent' as const) : ('done' as const),
                disabled: actionDisabled,
                onPress: () => actionRef.current?.onPress(),
              },
            ],
          }
        : null),
      ...(hasSearch
        ? {
            // react-native-screens hands this straight to
            // `navigationItem.searchController`, which is the same wiring
            // Apple's ToolbarSystemSearchViewController demonstrates. The
            // events arrive as native synthetic events, hence `nativeEvent`.
            headerSearchBarOptions: {
              placeholder: searchPlaceholder,
              autoFocus: searchAutoFocus,
              autoCapitalize: 'none' as const,
              onChangeText: (e: { nativeEvent: { text: string } }) =>
                searchRef.current?.onChangeText(e.nativeEvent.text),
              onSearchButtonPress: (e: { nativeEvent: { text: string } }) =>
                searchRef.current?.onSubmit?.(e.nativeEvent.text),
              onCancelButtonPress: () => searchRef.current?.onCancel?.(),
            },
          }
        : null),
    };
  }, [
    title,
    tint,
    actionLabel,
    actionDisabled,
    actionProminent,
    hasSearch,
    searchPlaceholder,
    searchAutoFocus,
  ]);

  if (nativeOptions) {
    return (
      <>
        <Stack.Screen options={nativeOptions} />
        {subtitle ? <NativeSubtitle text={subtitle} colors={colors} /> : null}
      </>
    );
  }

  if (children) return <>{children}</>;

  return (
    <FallbackHeader
      title={title}
      subtitle={subtitle}
      action={action}
      accessory={accessory}
      onBack={onBack}
      colors={colors}
    />
  );
}

/** The subtitle, on the iOS 26 path where the system bar has no room for it. */
function NativeSubtitle({ text, colors }: { text: string; colors: ColorPalette }) {
  const styles = makeStyles(colors);
  return <Text style={styles.nativeSubtitle}>{text}</Text>;
}

/** The app's own header: back chevron, title over subtitle, trailing slot. */
function FallbackHeader({
  title,
  subtitle,
  action,
  accessory,
  onBack,
  colors,
}: Omit<ScreenHeaderProps, 'children'> & { colors: ColorPalette }) {
  const styles = makeStyles(colors);

  // No safe-area inset here on purpose: the screen's root still applies it, via
  // `useScreenTopInset`. Owning it in both places would push every one of these
  // headers down by a second status bar.
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack ?? (() => router.back())}
        hitSlop={12}
        style={({ pressed }) => pressed && styles.pressed}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <IconBack size={22} color={colors.t1} />
      </Pressable>

      <View style={styles.headerText}>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      {action ? (
        <Pressable
          onPress={action.onPress}
          disabled={action.disabled}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!action.disabled }}
        >
          <Text style={[styles.action, action.disabled && styles.actionDisabled]}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}

      {accessory}
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerText: { flex: 1, gap: 2 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.title,
    color: colors.t1,
  },
  subtitle: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3 },
  action: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.teal,
  },
  actionDisabled: { color: colors.t3 },
  pressed: { opacity: 0.6 },
  // Sits directly under the system navigation bar, so it carries the screen's
  // horizontal gutter but none of the header's vertical padding.
  nativeSubtitle: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    color: colors.t3,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
});
