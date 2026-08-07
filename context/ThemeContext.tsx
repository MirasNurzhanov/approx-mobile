import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Appearance } from 'react-native';

import { colors as darkColors, lightColors, type ColorPalette } from '@/constants/theme';

interface ThemeContextValue {
  colors: ColorPalette;
  themeMode: 'dark' | 'light';
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'theme_mode_v2';

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('light');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark') setThemeMode(stored);
      })
      .catch(() => {});
  }, []);

  const toggleTheme = () => {
    // `next` is computed here rather than from inside the updater, and the
    // write happens before the setter, because React is free to call a state
    // updater more than once — which would have repeated the save. One value
    // feeds both the store and the state, so the two cannot disagree.
    const next = themeMode === 'dark' ? 'light' : 'dark';
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    setThemeMode(next);
  };

  // `Appearance.setColorScheme` is what stops the *native* chrome — keyboards,
  // system alerts, scroll indicators, the text-selection menu — from staying on
  // whatever the phone is set to while the app itself is the other way round.
  // The app's theme is its own setting and deliberately does not follow the OS,
  // so without this a light app on a dark phone gets a black keyboard.
  //
  // The home-screen icon deliberately does *not* follow the theme any more.
  // Swapping it on Android means enabling a different `activity-alias`, which
  // does not restart the app but force-stops it — `moveTaskToBack(true)`, then
  // `finishAffinity()` + `killProcess()` half a second later. There is no
  // window in which that is not a crash from the user's point of view, and it
  // fired on launch: this effect ran with the default 'light' before
  // AsyncStorage had returned the real theme, and Android reports a cold start
  // (and any permission dialog) as AppState 'background', which is what the
  // queue flushed on. A themed icon is not worth the session.
  useEffect(() => {
    // Guarded: react-native-web has no such method, and this runs on the web
    // build too.
    Appearance.setColorScheme?.(themeMode);
  }, [themeMode]);

  const activeColors = themeMode === 'dark' ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ colors: activeColors, themeMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within AppThemeProvider');
  return ctx;
}
