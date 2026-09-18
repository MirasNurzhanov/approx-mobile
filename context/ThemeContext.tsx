import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Appearance, Platform } from 'react-native';

import { colors as darkColors, lightColors, type ColorPalette } from '@/constants/theme';
import { setAppIcon } from '@/modules/approx-app-icon';

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
        const saved = stored === 'light' || stored === 'dark' ? stored : null;
        if (saved) setThemeMode(saved);
        // Android only: bring back in step an icon that drifted — a theme
        // chosen on a build that could not switch icons, say. Only ever the
        // *stored* theme, never the 'light' this state starts with, and on
        // Android a request is just recorded: the swap happens after the user
        // has left the app. Not on iOS, where the change is immediate and
        // announced by a system alert nobody should meet on launch.
        if (Platform.OS === 'android') void setAppIcon(saved ?? 'light');
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
    // The home-screen icon follows the theme. Best-effort and never throws;
    // see modules/approx-app-icon for when each platform applies it.
    void setAppIcon(next);
  };

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
  // only an explicit toggle and the hydrated value above, through a module
  // that never kills the app — see modules/approx-app-icon.
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
