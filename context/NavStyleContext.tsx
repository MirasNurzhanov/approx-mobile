import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Which bottom nav the app draws.
 *
 * - `bar`   the standard tab bar (components/nav/ApproxTabBar)
 * - `wheel` the speedometer arc (components/Speedometer)
 *
 * The bar is the default on every device and every OS version. The wheel is the
 * app's signature nav but it is also a 200pt-tall arc that covers a third of a
 * small screen and has no counterpart anywhere else in iOS or Android, so it is
 * something you turn on, not something you have to turn off.
 */
export type NavStyle = 'bar' | 'wheel';

interface NavStyleContextValue {
  navStyle: NavStyle;
  setNavStyle: (style: NavStyle) => void;
  /** False until the stored choice has been read back. */
  ready: boolean;
}

const NavStyleContext = createContext<NavStyleContextValue | null>(null);

const STORAGE_KEY = 'nav_style_v1';

export function NavStyleProvider({ children }: { children: React.ReactNode }) {
  const [navStyle, setStyle] = useState<NavStyle>('bar');
  // The nav renders before AsyncStorage answers. Starting from the default and
  // correcting a frame later would flash a tab bar at everyone who chose the
  // wheel, so screens that measure the nav wait for this instead.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'bar' || stored === 'wheel') setStyle(stored);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // The write happens before the setter and off one computed value, for the
  // same reason ThemeContext's toggle does: React may call a state updater more
  // than once, and a save inside one would run twice.
  const setNavStyle = useCallback((next: NavStyle) => {
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    setStyle(next);
  }, []);

  // Kept despite react-doctor/react-compiler-no-manual-memoization: this is a
  // context value, so its identity is what every `useNavStyle()` consumer
  // re-renders on — the nav bar and the wheel among them. `setNavStyle` is
  // memoized to match, since it feeds this dependency array.
  const value = useMemo(
    () => ({ navStyle, setNavStyle, ready }),
    [navStyle, setNavStyle, ready],
  );

  return <NavStyleContext.Provider value={value}>{children}</NavStyleContext.Provider>;
}

export function useNavStyle(): NavStyleContextValue {
  const ctx = useContext(NavStyleContext);
  if (!ctx) throw new Error('useNavStyle must be used within NavStyleProvider');
  return ctx;
}
