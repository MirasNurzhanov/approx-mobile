// The home-screen icon follows the in-app theme.
//
// Two halves: the JS wrapper over the local native module
// (modules/approx-app-icon), and ThemeContext, which decides *when* to ask.
// The "when" is what broke a previous version: it asked with the default
// 'light' before storage had answered, and the library it used force-stopped
// the app to apply it. So the rules pinned here are that a request only ever
// carries the stored or the chosen theme, and that iOS — where a request is
// applied at once, under a system alert — is never asked on launch.
//
// There are two icons and more themes than that: each theme asks for the icon
// of its light or dark side.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Text } from 'react-native';
import { act, create } from 'react-test-renderer';

import type { ThemeId } from '../../constants/theme';
import { AppThemeProvider, useTheme } from '../../context/ThemeContext';
import { getAppIcon, isAppIconSwitchingAvailable, setAppIcon } from '../../modules/approx-app-icon';

// Built inside the factory: the imports above are hoisted and load the wrapper,
// which asks for the module, before any statement of this file has run.
jest.mock('expo', () => {
  const native = {
    setIcon: jest.fn(async (_name: string) => true),
    getIcon: jest.fn(async () => 'light'),
  };
  return { requireOptionalNativeModule: jest.fn(() => native), __native: native };
});
const mockNative = (jest.requireMock('expo') as { __native: {
  setIcon: jest.Mock<Promise<boolean>, [string]>;
  getIcon: jest.Mock<Promise<string>, []>;
} }).__native;

const STORAGE_KEY = 'theme_mode_v2';
const originalOS = Platform.OS;

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

let choose: (id: ThemeId) => void = () => {};
function Probe() {
  const { themeMode, setTheme } = useTheme();
  choose = setTheme;
  return <Text>{themeMode}</Text>;
}

async function renderProvider() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <AppThemeProvider>
        <Probe />
      </AppThemeProvider>,
    );
  });
  // Let the storage read and the request it triggers settle.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return tree;
}

const requested = () => mockNative.setIcon.mock.calls.map(([name]) => name);

beforeEach(async () => {
  mockNative.setIcon.mockReset().mockResolvedValue(true);
  mockNative.getIcon.mockReset().mockResolvedValue('light');
  await AsyncStorage.clear();
});

afterAll(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

describe('the native wrapper', () => {
  it('passes a request through and reports its answer', async () => {
    expect(isAppIconSwitchingAvailable()).toBe(true);
    mockNative.setIcon.mockResolvedValueOnce(false);
    await expect(setAppIcon('dark')).resolves.toBe(false);
    expect(mockNative.setIcon).toHaveBeenCalledWith('dark');

    mockNative.getIcon.mockResolvedValueOnce('dark');
    await expect(getAppIcon()).resolves.toBe('dark');
  });

  it('turns a native failure into false rather than a rejection', async () => {
    mockNative.setIcon.mockRejectedValueOnce(new Error('launcher refused'));
    await expect(setAppIcon('dark')).resolves.toBe(false);
    mockNative.getIcon.mockRejectedValueOnce(new Error('no activity'));
    await expect(getAppIcon()).resolves.toBeNull();
  });

  it('is a harmless no-op in a build without the module', async () => {
    let wrapper!: typeof import('../../modules/approx-app-icon');
    jest.isolateModules(() => {
      require('expo').requireOptionalNativeModule.mockReturnValue(null);
      wrapper = require('../../modules/approx-app-icon');
    });
    expect(wrapper.isAppIconSwitchingAvailable()).toBe(false);
    await expect(wrapper.setAppIcon('dark')).resolves.toBe(false);
    await expect(wrapper.getAppIcon()).resolves.toBeNull();
    expect(mockNative.setIcon).not.toHaveBeenCalled();
  });
});

describe('when ThemeContext asks for an icon', () => {
  it('asks for the new theme on every choice, on both platforms', async () => {
    for (const os of ['ios', 'android'] as const) {
      setPlatform(os);
      mockNative.setIcon.mockClear();
      await AsyncStorage.setItem(STORAGE_KEY, 'light');
      const tree = await renderProvider();
      mockNative.setIcon.mockClear();

      await act(async () => { choose('dark'); });
      expect(tree.root.findByType(Text).props.children).toBe('dark');
      await act(async () => { choose('light'); });

      expect(requested()).toEqual(['dark', 'light']);
      act(() => tree.unmount());
    }
  });

  it('asks for the icon of a palette theme’s side — light, for all of them today', async () => {
    setPlatform('ios');
    await AsyncStorage.setItem(STORAGE_KEY, 'dark');
    const tree = await renderProvider();

    await act(async () => { choose('lagoon'); });
    expect(tree.root.findByType(Text).props.children).toBe('light');
    expect(requested()).toEqual(['light']);
  });

  it('on Android, brings a stored palette theme’s icon in line on launch', async () => {
    setPlatform('android');
    await AsyncStorage.setItem(STORAGE_KEY, 'orchid');
    await renderProvider();
    expect(requested()).toEqual(['light']);
  });

  it('on Android, brings the icon in line with the stored theme — never the default', async () => {
    setPlatform('android');
    await AsyncStorage.setItem(STORAGE_KEY, 'dark');
    await renderProvider();
    expect(requested()).toEqual(['dark']);
  });

  it('on Android with nothing stored, asks for the primary icon once storage has answered', async () => {
    setPlatform('android');
    await renderProvider();
    expect(requested()).toEqual(['light']);
  });

  it('on iOS, never asks on launch, where the change would raise a system alert', async () => {
    setPlatform('ios');
    await AsyncStorage.setItem(STORAGE_KEY, 'dark');
    const tree = await renderProvider();
    expect(tree.root.findByType(Text).props.children).toBe('dark');
    expect(mockNative.setIcon).not.toHaveBeenCalled();
  });

  it('asks nothing when the stored theme cannot be read', async () => {
    setPlatform('android');
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage unavailable'));
    await renderProvider();
    expect(mockNative.setIcon).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
