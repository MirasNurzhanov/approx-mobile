import type { Href } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import {
  Badge, Icon, Label, NativeTabs, VectorIcon,
} from 'expo-router/unstable-native-tabs';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleSheet } from 'react-native';

import { NAV_SECTIONS } from '@/components/navSections';
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
// `sf` names the iOS SF Symbol; `md` is a Material Icons name that reaches
// Android through expo-router's `VectorIcon` bridge.
//
// Not the `md` *prop* on `Icon` — that is SDK 56 and later. On SDK 54 the Icon
// element takes a symbol, a bundled Android drawable, or an image source, and
// `VectorIcon` is the supported way to turn an @expo/vector-icons glyph into
// the third of those.
const TAB_ICONS = {
  map: { sf: 'map.fill', md: 'map' },
  profile: { sf: 'person.fill', md: 'person' },
  chat: { sf: 'bubble.left.and.bubble.right.fill', md: 'chat' },
  swifts: { src: require('@/assets/images/tab-swift.png') },
  settings: { sf: 'gearshape.fill', md: 'settings' },
} as const;

/**
 * The real thing: `UITabBarController` on iOS — Liquid Glass and the system
 * minimize-on-scroll behaviour on iOS 26 — and Material 3 bottom navigation on
 * Android. Nothing here draws a tab bar; it describes one and UIKit builds it.
 *
 * On SDK 54 the trigger's parts are *standalone* exports (`Label`, `Icon`,
 * `Badge`) rather than the compound `NativeTabs.Trigger.*` form SDK 56
 * introduced.
 *
 * Icons go through `VectorIcon`, which is expo-router's bridge for
 * SF Symbols on iOS and Material Symbols on Android, which are each platform's
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
            {/* Standalone `Label`/`Icon`/`Badge`, which is the SDK 54 shape.
                SDK 56 made these compound (`NativeTabs.Trigger.Label`); that
                spelling does not resolve in expo-router 6 and is the thing to
                change back if this project moves forward again. */}
            <Label>{s.label}</Label>
            {'src' in icon
              ? <Icon src={icon.src} />
              : (
                <Icon
                  sf={icon.sf}
                  androidSrc={<VectorIcon family={MaterialIcons} name={icon.md} />}
                />
              )}
            {badge ? <Badge>{badge}</Badge> : null}
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
 * The wheel's navigator.
 *
 * A native tab bar cannot be a speedometer arc, so the wheel keeps the headless
 * `expo-router/ui` navigator it has always had: the `TabList` below declares the
 * tabs and draws nothing, and the arc's wedges are `TabTrigger`s referring back
 * to these by name — the "multiple tab bars" pattern from the custom-tabs
 * guide. Screens render `components/AuraNav`, which draws the arc over their
 * own content so it can float above the map.
 */
function WheelLayout() {
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

  return navStyle === 'wheel' ? <WheelLayout /> : <NativeTabsLayout />;
}

const styles = StyleSheet.create({
  declarationOnly: { display: 'none' },
});
