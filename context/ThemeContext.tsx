import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Appearance, Platform } from 'react-native';

import { getTheme, isThemeId, type ColorPalette, type ThemeId } from '@/constants/theme';
import { setAppIcon } from '@/modules/approx-app-icon';

interface ThemeContextValue {
  colors: ColorPalette;
  /** Which of the app's themes is active. See THEMES in constants/theme. */
  themeId: ThemeId;
  /**
   * The active theme's light or dark side. What the status bar, native chrome,
   * blur tints and basemap follow — each has only the two versions, so the
   * palette themes map onto one of them rather than getting their own.
   */
  themeMode: 'dark' | 'light';
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Holds a theme id. The key predates the palette themes, and 'light' / 'dark'
// are still ids, so a choice saved before them reads back unchanged.
const STORAGE_KEY = 'theme_mode_v2';

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>('light');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        const saved = isThemeId(stored) ? stored : null;
        if (saved) setThemeId(saved);
        // Android only: bring back in step an icon that drifted — a theme
        // chosen on a build that could not switch icons, say. Only ever the
        // *stored* theme, never the 'light' this state starts with, and on
        // Android a request is just recorded: the swap happens after the user
        // has left the app. Not on iOS, where the change is immediate and
        // announced by a system alert nobody should meet on launch.
        if (Platform.OS === 'android') void setAppIcon(getTheme(saved ?? 'light').scheme);
      })
      .catch(() => {});
  }, []);

  const setTheme = (next: ThemeId) => {
    // The write happens before the setter, and both take the same value, so
    // the store and the state cannot disagree.
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    setThemeId(next);
    // The home-screen icon follows the theme's light or dark side — there are
    // only the two icons. Best-effort and never throws; asking for the icon
    // already showing is a no-op on both platforms, so moving between two
    // light themes raises no system alert. See modules/approx-app-icon.
    void setAppIcon(getTheme(next).scheme);
  };

  const theme = getTheme(themeId);
  const themeMode = theme.scheme;

  // `Appearance.setColorScheme` is what stops the *native* chrome — keyboards,
  // system alerts, scroll indicators, the text-selection menu — from staying on
  // whatever the phone is set to while the app itself is the other way round.
  // The app's theme is its own setting and deliberately does not follow the OS,
  // so without this a light app on a dark phone gets a black keyboard.
  //
  // The home-screen icon is *not* driven from here. An earlier version did,
  // through `@mozzius/expo-dynamic-app-icon`, and it crashed sessions: this
  // effect ran with the default 'light' before AsyncStorage had answered, and
  // that library force-stops the app to apply a change. The icon now follows
  // only an explicit choice and the hydrated value above, through a module
  // that never kills the app — see modules/approx-app-icon.
  useEffect(() => {
    // Guarded: react-native-web has no such method, and this runs on the web
    // build too.
    Appearance.setColorScheme?.(themeMode);
  }, [themeMode]);

  return (
    <ThemeContext.Provider value={{ colors: theme.colors, themeId, themeMode, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within AppThemeProvider');
  return ctx;
}
