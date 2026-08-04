/**
 * The app icon follows the theme, but only when the app is not being looked at.
 *
 * The deferral is the whole point of services/appIcon — an immediate swap
 * restarts the app on Android and raises a system alert on iOS — so these pin
 * *when* the change lands, not just that it does.
 */
import { AppState } from 'react-native';

// `mock`-prefixed so jest's factory hoisting will let the closure reference
// them; the factory runs before the module body does.
const mockSetAppIcon = jest.fn();
const mockGetAppIcon = jest.fn(() => 'DEFAULT');
// What `requireOptionalNativeModule('ExpoDynamicAppIcon')` reports. Real by
// default, so the existing behavioural tests exercise the actual wrapper
// module below; the "native module truly absent" tests override it to null.
const mockRequireOptionalNativeModule = jest.fn<object | null, [string]>(() => ({}));

// `virtual`, because the native module is not resolvable in a Node test run.
jest.mock(
  '@mozzius/expo-dynamic-app-icon',
  () => ({
    setAppIcon: (name: string | null) => mockSetAppIcon(name),
    getAppIcon: () => mockGetAppIcon(),
  }),
  { virtual: true },
);

jest.mock('expo', () => ({
  ...jest.requireActual('expo'),
  requireOptionalNativeModule: (name: string) => mockRequireOptionalNativeModule(name),
}));

const setAppIcon = mockSetAppIcon;
const getAppIcon = mockGetAppIcon;

/** Grab the listener appIcon registered, and drive it by hand. */
function emit(state: 'active' | 'inactive' | 'background') {
  const spy = AppState.addEventListener as unknown as jest.Mock;
  for (const [, handler] of spy.mock.calls) handler(state);
}

describe('app icon', () => {
  let appIcon: typeof import('../appIcon');

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    getAppIcon.mockReturnValue('DEFAULT');
    // Present by default — most tests are about the deferral logic, not about
    // detecting absence. See the "native module is not present" block below
    // for the case this overrides.
    mockRequireOptionalNativeModule.mockReturnValue({});
    jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as never);
    // The app is in the foreground unless a test says otherwise.
    Object.defineProperty(AppState, 'currentState', {
      value: 'active',
      configurable: true,
    });
    appIcon = require('../appIcon');
  });

  afterEach(() => {
    appIcon.resetAppIconQueue();
    jest.restoreAllMocks();
  });

  it('does not touch the icon while the app is in the foreground', () => {
    appIcon.setDesiredAppIcon('dark');
    expect(setAppIcon).not.toHaveBeenCalled();
  });

  it('applies the change once the app goes to the background', () => {
    appIcon.setDesiredAppIcon('dark');
    emit('background');
    expect(setAppIcon).toHaveBeenCalledWith('dark');
  });

  it('ignores the iOS inactive half-step', () => {
    // App switcher open, or an incoming call. The user may come straight back,
    // and on iOS the alert would be sitting there when they did.
    appIcon.setDesiredAppIcon('dark');
    emit('inactive');
    expect(setAppIcon).not.toHaveBeenCalled();
  });

  it('collapses repeated toggles into one change', () => {
    appIcon.setDesiredAppIcon('dark');
    appIcon.setDesiredAppIcon('light');
    appIcon.setDesiredAppIcon('dark');
    emit('background');
    expect(setAppIcon).toHaveBeenCalledTimes(1);
    expect(setAppIcon).toHaveBeenCalledWith('dark');
  });

  it('skips a swap that would change nothing', () => {
    // Matters on Android especially: setting the icon already in use still
    // restarts the app.
    getAppIcon.mockReturnValue('dark');
    appIcon.setDesiredAppIcon('dark');
    emit('background');
    expect(setAppIcon).not.toHaveBeenCalled();
  });

  it('does not re-apply on a second backgrounding', () => {
    appIcon.setDesiredAppIcon('dark');
    emit('background');
    getAppIcon.mockReturnValue('dark');
    emit('background');
    expect(setAppIcon).toHaveBeenCalledTimes(1);
  });

  it('applies immediately when the app is already backgrounded', () => {
    Object.defineProperty(AppState, 'currentState', {
      value: 'background',
      configurable: true,
    });
    appIcon.setDesiredAppIcon('dark');
    expect(setAppIcon).toHaveBeenCalledWith('dark');
  });

  it('retries at the next backgrounding when the swap fails', () => {
    setAppIcon.mockImplementationOnce(() => {
      throw new Error('launcher said no');
    });
    appIcon.setDesiredAppIcon('dark');
    emit('background');
    expect(setAppIcon).toHaveBeenCalledTimes(1);

    emit('background');
    expect(setAppIcon).toHaveBeenCalledTimes(2);
  });

  it('reports the default icon as the light theme', () => {
    getAppIcon.mockReturnValue('DEFAULT');
    expect(appIcon.currentAppIcon()).toBe('light');
  });

  it('reports an explicitly set icon', () => {
    getAppIcon.mockReturnValue('dark');
    expect(appIcon.currentAppIcon()).toBe('dark');
  });

  it('drops the queued change when reset', () => {
    appIcon.setDesiredAppIcon('dark');
    appIcon.resetAppIconQueue();
    emit('background');
    expect(setAppIcon).not.toHaveBeenCalled();
  });

  // Regression coverage for a real crash: Expo Go, and any dev client built
  // before this plugin was added, have no 'ExpoDynamicAppIcon' native module
  // at all. `@mozzius/expo-dynamic-app-icon` resolves its native side by
  // calling expo-modules-core's `requireNativeModule`, which *throws* the
  // instant that package is first loaded if the module isn't there — and
  // Metro's dev-mode loader reports a module's first-load error as fatal
  // before a surrounding try/catch ever runs, producing a red LogBox screen
  // that looks like an app crash. `nativeIcons()` must never call `require()`
  // on the wrapper package until `requireOptionalNativeModule` — the
  // non-throwing presence check — has confirmed it is safe to.
  describe('when the native module is not present', () => {
    beforeEach(() => {
      mockRequireOptionalNativeModule.mockReturnValue(null);
    });

    it('never requires the wrapper package', () => {
      appIcon.setDesiredAppIcon('dark');
      emit('background');
      expect(setAppIcon).not.toHaveBeenCalled();
      expect(getAppIcon).not.toHaveBeenCalled();
    });

    it('does not register an AppState listener', () => {
      appIcon.setDesiredAppIcon('dark');
      expect(AppState.addEventListener).not.toHaveBeenCalled();
    });

    it('reports no current icon rather than throwing', () => {
      expect(() => appIcon.currentAppIcon()).not.toThrow();
      expect(appIcon.currentAppIcon()).toBeNull();
    });
  });
});
