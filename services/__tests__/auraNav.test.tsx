// Who draws the bottom nav.
//
// Bar style is a real native tab bar only where `BAR_STYLE_IS_NATIVE` says so
// (iOS) — the navigator owns it there
// (`app/(tabs)/_layout` → NativeTabs → UITabBarController), so a screen inside
// the tab group must draw nothing. Screens still call `AuraNav`
// unconditionally, which makes "renders nothing" a behaviour worth pinning:
// get it wrong and every tab screen stacks a second bar on top of the real
// one, and nothing else in the suite would notice.
//
// `react-native-screens`' Android Material 3 bar cannot have its own press
// ripple turned off or its selected-tab indicator resized, so Android's bar
// style is never native — every screen there draws `AuraTabBar` itself, the
// same as `/market` does on iOS (the one screen the root stack pushes above
// the tab navigator, where there is no native bar to inherit from either).
//
// All three components are stubbed and asserted on by call, not by output.
// The branch is the whole subject here; rendering the real ones would drag in
// Reanimated worklets, an SVG arc and a ten-second badge poll to prove
// something none of them are involved in.

import { act, create } from 'react-test-renderer';

import { AuraNav } from '../../components/AuraNav';

const mockNav = { navStyle: 'bar' as 'bar' | 'wheel', ready: true };
const mockPlatform = { BAR_STYLE_IS_NATIVE: true };
const mockBar = jest.fn(() => null);
const mockWheel = jest.fn(() => null);

jest.mock('../../context/NavStyleContext', () => ({
  useNavStyle: () => ({ ...mockNav, setNavStyle: jest.fn() }),
}));
jest.mock('../../constants/platform', () => ({
  get BAR_STYLE_IS_NATIVE() {
    return mockPlatform.BAR_STYLE_IS_NATIVE;
  },
}));
jest.mock('../../components/nav/AuraTabBar', () => ({ AuraTabBar: () => mockBar() }));
jest.mock('../../components/Speedometer', () => ({ Speedometer: () => mockWheel() }));

function render(element: React.ReactElement): void {
  act(() => {
    create(element);
  });
}

beforeEach(() => {
  mockNav.navStyle = 'bar';
  mockNav.ready = true;
  mockPlatform.BAR_STYLE_IS_NATIVE = true;
  mockBar.mockClear();
  mockWheel.mockClear();
});

describe('bar style — native (iOS)', () => {
  it('draws nothing inside the tab navigator — the navigator owns the bar', () => {
    render(<AuraNav />);
    expect(mockBar).not.toHaveBeenCalled();
    expect(mockWheel).not.toHaveBeenCalled();
  });

  it('draws one on /market, which sits above the navigator', () => {
    render(<AuraNav standalone />);
    expect(mockBar).toHaveBeenCalled();
    expect(mockWheel).not.toHaveBeenCalled();
  });
});

describe('bar style — custom (Android)', () => {
  beforeEach(() => {
    mockPlatform.BAR_STYLE_IS_NATIVE = false;
  });

  it('draws AuraTabBar inside the tab navigator too — there is no native bar to inherit', () => {
    render(<AuraNav />);
    expect(mockBar).toHaveBeenCalled();
    expect(mockWheel).not.toHaveBeenCalled();
  });

  it('draws one on /market the same way', () => {
    render(<AuraNav standalone />);
    expect(mockBar).toHaveBeenCalled();
    expect(mockWheel).not.toHaveBeenCalled();
  });
});

describe('wheel style', () => {
  beforeEach(() => {
    mockNav.navStyle = 'wheel';
  });

  it('draws the arc inside the tab navigator', () => {
    render(<AuraNav />);
    expect(mockWheel).toHaveBeenCalled();
    expect(mockBar).not.toHaveBeenCalled();
  });

  it('draws the arc on /market too', () => {
    render(<AuraNav standalone />);
    expect(mockWheel).toHaveBeenCalled();
  });

  it('draws the arc on Android too — the wheel does not care which platform it is on', () => {
    mockPlatform.BAR_STYLE_IS_NATIVE = false;
    render(<AuraNav />);
    expect(mockWheel).toHaveBeenCalled();
    expect(mockBar).not.toHaveBeenCalled();
  });
});

describe('before the stored choice is known', () => {
  it('draws nothing rather than guessing', () => {
    mockNav.ready = false;
    render(<AuraNav />);
    render(<AuraNav standalone />);
    expect(mockBar).not.toHaveBeenCalled();
    expect(mockWheel).not.toHaveBeenCalled();
  });
});
