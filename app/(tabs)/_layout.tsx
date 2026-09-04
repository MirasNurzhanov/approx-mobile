import type { Href } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet } from 'react-native';

import { NAV_SECTIONS } from '@/components/navSections';
import { BAR_STYLE_IS_NATIVE } from '@/constants/platform';
import { useNavStyle } from '@/context/NavStyleContext';
import { useTheme } from '@/context/ThemeContext';
import { useNavBadges } from '@/hooks/useNavBadges';

/**
 * Routes in this group that are reachable but are not destinations: three
 * redirect shims kept alive so older links still land somewhere real. The
 * original navigator expressed this as `options={{ href: null }}`.
 *
 * `index` is left out deliberately. Nothing navigates to a bare `/(tabs)`, and
 * a trigger whose href does not resolve is a startup warning for a path the
 * app never uses.
 */
const SHIM_ROUTES = ['explore', 'notifications'] as const;

/**
 * Map is the first tab, which with the router's default `firstRoute` back
 * behaviour is also where Android's back button goes from any other tab, and
 * the tab you can back out of the app from.
 *
 * Stated explicitly because it used to be implicit and wrong: routes sort with
 * `index` first, and `(tabs)/index` is a redirect to Map — so backing out of
 * Map bounced through the shim and landed on Map again, with no way to leave
 * the app from the screen it opens on.
 */
export const unstable_settings = { anchor: 'map' };

/**
 * The icon each section shows in the native tab bar.
 *
 * Four come from `@expo/vector-icons` through expo-router's `VectorIcon`
 * bridge. Swifts is the app's own drawing — the same `IconSwift` the wheel uses
 * — baked to a PNG by `scripts/generate-tab-icons.js`, because `Icon` takes an
 * image or an SF Symbol and rejects any React element that is not `VectorIcon`.
 * Both routes end up as a template image the system tints, so the two kinds sit
 * together without looking pasted in.
 */
// `sf` names the iOS SF Symbol, `md` a Material Symbols name. Both are props
// on `Icon` in SDK 57 and the pair is a supported combination, so the glyph no
// longer has to be bridged through `VectorIcon` to reach Android - which is
// what `androidSrc` did here before, and `androidSrc` is gone in 57.
const TAB_ICONS = {
  map: { sf: 'map.fill', md: 'map' },
  profile: { sf: 'person.fill', md: 'person' },
  // Chat is the app’s own Ionicons `chatbubbles` on both platforms rather than
  // an SF Symbol, which is what it looked like before this bar was native and
  // what the wheel and ApproxTabBar still draw (see navSections). The nearest
  // symbol, `bubble.left.and.bubble.right.fill`, is two bubbles set side by
  // side facing apart; Ionicons’ is two stacked and overlapping, and the pair
  // read as different icons rather than as the same one in two styles.
  //
  // `src` is last in priority on both platforms (iOS `sf` > `xcasset` > `src`,
  // Android `drawable` > `md` > `src`), so naming it alone keeps this one glyph
  // on both.
  chat: { src: <NativeTabs.Trigger.VectorIcon family={Ionicons} name="chatbubbles" /> },
  swifts: { src: require('@/assets/images/tab-swift.png') },
  settings: { sf: 'gearshape.fill', md: 'settings' },
} as const;

/**
 * The real thing — `UITabBarController`, with Liquid Glass and the system
 * minimize-on-scroll behaviour on iOS 26. Nothing here draws a tab bar; it
 * describes one and UIKit builds it. iOS only now: this used to also cover
 * Material 3 bottom navigation on Android, but `react-native-screens`
 * exposes just a colour for that bar's press ripple and a colour for its
 * selected-tab indicator — no way to turn the ripple off, no way to resize
 * or reshape the indicator — so Android gets nothing further from the native
 * component. Android's bar style renders through `HeadlessTabsLayout` below
 * instead, the same navigator the wheel uses, with `components/nav/ApproxTabBar`
 * drawing a bar this app fully controls. See `constants/platform`'s
 * `BAR_STYLE_IS_NATIVE`, which is what decides between the two.
 *
 * On SDK 57 the parts of a trigger are compound - `NativeTabs.Trigger.Label`,
 * `.Icon`, `.Badge` and `.VectorIcon`. The standalone `Label`/`Icon`/`Badge`
 * exports this file used on SDK 54 no longer exist.
 *
 * Icons are SF Symbols on iOS and Material Symbols on Android, which are each
 * own icon set — the same reasoning as the bar itself. Swifts is the exception:
 * it is the app's own drawing, the same `IconSwift` the wheel uses, baked to a
 * PNG by `scripts/generate-tab-icons.js`. `Icon` takes an image, a symbol name
 * or a drawable, and rejects any React element that is not `VectorIcon`, so a
 * component was never an option. Both routes end as a template image the system
 * tints, so the mixture does not read as pasted in.
 */
function NativeTabsLayout() {
  const { colors } = useTheme();
  const badges = useNavBadges();
  const chatBadge = badges.chat + badges.alerts;

  return (
    <NativeTabs
      tintColor={colors.navActive}
      backgroundColor={colors.navBg}
      iconColor={{ default: colors.navInactive, selected: colors.navActive }}
      labelStyle={{
        default: { color: colors.navInactive },
        selected: { color: colors.navActive },
      }}
      badgeBackgroundColor={colors.red}
      // The native version of the tuck-away the JS bar used to hand-roll.
      // iOS 26 only; older iOS ignores it.
      minimizeBehavior="onScrollDown"
    >
      {NAV_SECTIONS.map((s) => {
        const icon = TAB_ICONS[s.name as keyof typeof TAB_ICONS];
        const badge = s.name === 'chat' && chatBadge > 0
          ? (chatBadge > 99 ? '99+' : String(chatBadge))
          : undefined;
        return (
          <NativeTabs.Trigger key={s.name} name={s.name}>
            <NativeTabs.Trigger.Label>{s.label}</NativeTabs.Trigger.Label>
            {'src' in icon
              ? <NativeTabs.Trigger.Icon src={icon.src} />
              : <NativeTabs.Trigger.Icon sf={icon.sf} md={icon.md} />}
            {badge
              ? <NativeTabs.Trigger.Badge>{badge}</NativeTabs.Trigger.Badge>
              : null}
          </NativeTabs.Trigger>
        );
      })}

      {SHIM_ROUTES.map((name) => (
        <NativeTabs.Trigger key={name} name={name} hidden />
      ))}
    </NativeTabs>
  );
}

/**
 * The navigator behind both the wheel and Android's bar style.
 *
 * A native tab bar cannot be a speedometer arc, and — see `NativeTabsLayout`'s
 * doc comment — Android's Material 3 bar cannot have its ripple turned off or
 * its indicator resized, so neither wants `NativeTabs` as its navigator.
 * Both keep the headless `expo-router/ui` navigator instead: the `TabList`
 * below declares the tabs and draws nothing, and the visible bar — the arc's
 * wedges, or `ApproxTabBar`'s items — is `TabTrigger`s referring back to these
 * by name, the "multiple tab bars" pattern from the custom-tabs guide.
 * Screens render `components/ApproxNav`, which draws whichever one floats over
 * their own content.
 */
function HeadlessTabsLayout() {
  return (
    <Tabs>
      <TabSlot />

      <TabList style={styles.declarationOnly}>
        {NAV_SECTIONS.map((s) => (
          <TabTrigger key={s.name} name={s.name} href={s.route as Href} />
        ))}
        {SHIM_ROUTES.map((name) => (
          <TabTrigger key={name} name={name} href={`/(tabs)/${name}` as Href} />
        ))}
      </TabList>
    </Tabs>
  );
}

export default function TabsLayout() {
  const { navStyle, ready } = useNavStyle();

  // Which navigator this is cannot change without remounting the whole tab
  // tree, so it waits for the stored choice rather than mounting the default
  // and swapping a frame later. The launch loader is still up for this stretch.
  if (!ready) return null;

  // Bar style is the real native tab bar only where that component has
  // anything to offer — iOS. Everywhere else (Android's bar style, and the
  // wheel on every platform) routes through the same headless navigator and
  // lets the screen draw its own bar; see HeadlessTabsLayout and ApproxNav.
  return navStyle === 'bar' && BAR_STYLE_IS_NATIVE
    ? <NativeTabsLayout />
    : <HeadlessTabsLayout />;
}

const styles = StyleSheet.create({
  declarationOnly: { display: 'none' },
});
