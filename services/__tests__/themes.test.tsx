// The theme registry, and the context that serves it.
//
// Every screen reads its colours through the same handful of tokens, so a
// palette that looks right as a strip of swatches can still put grey-on-grey
// text on every screen of the app. These are the numbers the palettes were
// tuned against, run over every theme in THEMES — a theme added there is held
// to them without anybody having to remember this file. The nav's own tokens
// have their own contract, in navPalette.test.ts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  colors as darkColors,
  getTheme,
  isThemeId,
  lightColors,
  sageColors,
  THEMES,
} from '../../constants/theme';
import { AppThemeProvider, useTheme } from '../../context/ThemeContext';

// The icon has its own suite (appIcon.test.tsx); here it only has to not be
// the real native module.
jest.mock('../../modules/approx-app-icon', () => ({ setAppIcon: jest.fn(async () => true) }));

const STORAGE_KEY = 'theme_mode_v2';
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** WCAG 2.1 relative luminance, sRGB. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const chan = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the registry', () => {
  it('has one entry per id and per name', () => {
    const ids = THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(THEMES.map((theme) => theme.name)).size).toBe(ids.length);
    for (const id of ids) expect(isThemeId(id)).toBe(true);
  });

  it('keeps Light and Dark on the palettes they have always had', () => {
    expect(getTheme('light').colors).toBe(lightColors);
    expect(getTheme('dark').colors).toBe(darkColors);
  });

  it('rejects anything that is not a theme id', () => {
    for (const value of [null, undefined, '', 'Light', 'sunset', 42]) {
      expect(isThemeId(value)).toBe(false);
    }
  });
});

describe.each(THEMES.map((theme) => [theme.id, theme] as const))('%s theme', (_id, theme) => {
  const p = theme.colors;

  it('uses opaque six-digit hex for every token', () => {
    // Several call sites append an alpha byte to a token (`${colors.red}26`),
    // which only works on a bare #RRGGBB.
    for (const value of Object.values(p)) expect(value).toMatch(HEX);
  });

  it('reads body and secondary text at AA, on the page and on a card', () => {
    for (const ground of [p.bg, p.surface]) {
      expect(contrast(p.t1, ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.t2, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps tertiary text — captions, placeholders — at 3:1 on the page', () => {
    expect(contrast(p.t3, p.bg)).toBeGreaterThanOrEqual(3);
  });

  it('draws its accent at 3:1 against the cards it sits on', () => {
    // A switch's "on" track, a selected tile's border, a link: all of them
    // are the accent on `surface`, and 3:1 is the floor for a control.
    expect(contrast(p.teal, p.surface)).toBeGreaterThanOrEqual(3);
  });

  it('declares the scheme its page actually is', () => {
    // The status bar, keyboard and basemap all follow `scheme`. A dark page
    // declared light would get dark status-bar text on a dark ground.
    expect(theme.scheme).toBe(luminance(p.bg) < 0.2 ? 'dark' : 'light');
  });

  it('has a swatch strip for the picker', () => {
    expect(theme.swatches.length).toBeGreaterThanOrEqual(3);
    // They double as React keys in the picker.
    expect(new Set(theme.swatches).size).toBe(theme.swatches.length);
    for (const hex of theme.swatches) expect(hex).toMatch(HEX);
  });
});

describe('ThemeContext', () => {
  let current!: ReturnType<typeof useTheme>;
  let tree: ReactTestRenderer | null = null;
  function Probe() {
    current = useTheme();
    return <Text>{current.themeId}</Text>;
  }

  async function renderProvider() {
    await act(async () => {
      tree = create(
        <AppThemeProvider>
          <Probe />
        </AppThemeProvider>,
      );
    });
    // Let the storage read settle.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  afterEach(() => {
    act(() => tree?.unmount());
    tree = null;
  });

  it('starts on Light when nothing is stored', async () => {
    await renderProvider();
    expect(current.themeId).toBe('light');
    expect(current.colors).toBe(lightColors);
  });

  it('reads back a stored palette theme, on its light side', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'sage');
    await renderProvider();
    expect(current.themeId).toBe('sage');
    expect(current.colors).toBe(sageColors);
    expect(current.themeMode).toBe('light');
  });

  it('reads back a choice saved before the palette themes existed', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'dark');
    await renderProvider();
    expect(current.themeId).toBe('dark');
    expect(current.themeMode).toBe('dark');
  });

  it('falls back to Light for a stored value it does not know', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'sunset');
    await renderProvider();
    expect(current.themeId).toBe('light');
  });

  it('applies a choice at once and keeps it', async () => {
    await renderProvider();
    await act(async () => { current.setTheme('porcelain'); });
    expect(current.themeId).toBe('porcelain');
    expect(current.colors).toBe(getTheme('porcelain').colors);
    await expect(AsyncStorage.getItem(STORAGE_KEY)).resolves.toBe('porcelain');
  });
});
