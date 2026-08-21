import { AuraTabBar } from '@/components/nav/AuraTabBar';
import { Speedometer } from '@/components/Speedometer';
import { useNavStyle } from '@/context/NavStyleContext';

interface AuraNavProps {
  /** Name of a NAV_SECTIONS entry to spotlight for a tutorial. Both nav styles
   *  honour it, so a caller never has to know which one is on. */
  highlightSection?: string;
  /**
   * Set this on a screen that is *not* inside the tab navigator — today that
   * is only `/market`, which the root stack pushes above it. Its buttons then
   * navigate by href instead of being `TabTrigger`s, since there is no trigger
   * map above them to refer to. See components/nav/NavTrigger.
   */
  standalone?: boolean;
}

/**
 * The app's bottom nav.
 *
 * Every screen renders this rather than a specific nav, so which one the user
 * picked in Settings is decided in one place. It is drawn per screen instead of
 * once by the tabs layout because it has to float over the map, because
 * Settings hands it a `highlightSection` during the zone tutorial, and because
 * `/market` needs it from outside the tab group entirely.
 */
export function AuraNav({ highlightSection, standalone }: AuraNavProps = {}) {
  const { navStyle, ready } = useNavStyle();

  // Nothing until the stored choice is back. One frame of no nav is invisible;
  // a tab bar that flips to a 200pt arc a frame later is not.
  if (!ready) return null;

  if (navStyle === 'wheel') {
    return <Speedometer highlightSection={highlightSection} standalone={standalone} />;
  }

  // Bar style: the navigator itself is a native tab bar (UITabBarController on
  // iOS, Material 3 on Android — see app/(tabs)/_layout), so a screen inside it
  // draws no nav at all. Drawing one here would be a second bar stacked on the
  // real one.
  //
  // `/market` is the exception, and the reason this component still renders
  // anything on this path: the root stack pushes it *above* the tab navigator,
  // where there is no native bar to inherit.
  if (!standalone) return null;

  return <AuraTabBar highlightSection={highlightSection} standalone />;
}
