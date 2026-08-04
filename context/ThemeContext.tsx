import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Appearance } from 'react-native';

import { colors as darkColors, lightColors, type ColorPalette } from '@/constants/theme';
import { setDesiredAppIcon } from '@/services/appIcon';

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

  const toggleTheme = useCallback(() => {
    setThemeMode((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  // Two things outside React have to follow the theme too.
  //
  // The icon is queued rather than swapped: it only lands when the app next
  // goes to the background, because changing it in the foreground restarts the
  // app on Android and raises a system alert on iOS. See services/appIcon.
  //
  // `Appearance.setColorScheme` is what stops the *native* chrome — keyboards,
  // system alerts, scroll indicators, the text-selection menu — from staying on
  // whatever the phone is set to while the app itself is the other way round.
  // The app's theme is its own setting and deliberately does not follow the OS,
  // so without this a light app on a dark phone gets a black keyboard.
  useEffect(() => {
    setDesiredAppIcon(themeMode);
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
