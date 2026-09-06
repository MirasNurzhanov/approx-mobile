/* eslint-disable @typescript-eslint/no-require-imports -- Jest mock factories load their dependencies after hoisting. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import SwiftsScreen from '../../app/(tabs)/swifts';
import { ApproxNav } from '../../components/ApproxNav';
import { Speedometer } from '../../components/Speedometer';
import { NavTrigger } from '../../components/nav/NavTrigger';
import { NAV_WHEEL_SLIM_H } from '../../components/navGeometry';

let mockPathname = '/swifts';
let mockCollapsed = false;
const mockNavigate = jest.fn();

jest.mock('expo-router', () => ({
  usePathname: () => mockPathname,
  router: { navigate: (...args: unknown[]) => mockNavigate(...args) },
}));
jest.mock('expo-router/ui', () => ({
  TabTrigger: ({ name, onPress, ...props }: any) => {
    const React = require('react');
    const { Pressable } = require('react-native');
    return React.createElement(Pressable, {
      ...props,
      testID: `nav-${name}`,
      onPress: () => { onPress?.(); mockNavigate(name); },
    });
  },
}));
jest.mock('../../components/swifts/SwiftsFeed', () => ({ SwiftsFeed: () => null }));
jest.mock('../../components/nav/ApproxTabBar', () => ({ ApproxTabBar: () => null }));
jest.mock('../../context/NavStyleContext', () => ({
  useNavStyle: () => ({ navStyle: 'wheel', ready: true }),
}));
jest.mock('../../context/ScrollNavContext', () => ({
  useScrollNav: () => ({ collapsed: mockCollapsed }),
}));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: require('../../constants/theme').lightColors }),
}));
jest.mock('../../hooks/useNavBadges', () => ({
  useNavBadges: () => ({ chat: 0, alerts: 0 }),
}));
jest.mock('../../hooks/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/ui/icons', () => ({ IconSwift: 'IconSwift' }));
jest.mock('react-native-svg', () => ({
  __esModule: true, default: 'Svg', Circle: 'Circle', Line: 'Line', Path: 'Path',
}));
jest.mock('react-native-reanimated', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    Easing: { out: (v: unknown) => v, in: (v: unknown) => v, cubic: 0 },
    Extrapolation: { CLAMP: 0 },
    interpolate: (v: number, _input: number[], output: number[]) => output[v === 0 ? 0 : 1],
    useAnimatedProps: (fn: () => unknown) => fn(),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useSharedValue: (initial: unknown) => {
      const ref = React.useRef(initial);
      return React.useMemo(() => ({
        get: () => ref.current,
        set: (value: unknown) => { ref.current = value; },
      }), []);
    },
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    withRepeat: (v: unknown) => v,
    withSequence: (v: unknown) => v,
  };
});

// Both tabs remain mounted, as they do in TabSlot after the first visit.
function CachedTabs() {
  return <><SwiftsScreen /><ApproxNav /></>;
}

it('keeps the cached Swifts bar compact and usable across repeated tab changes and idle expansion', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<CachedTabs />); });
  const swiftScreen = () => renderer.root.findByType(SwiftsScreen);
  const swiftNav = () => swiftScreen().findByType(Speedometer);
  const assertCompact = () => {
    // No invisible wheel buttons or arc should survive over the video.
    expect(swiftNav().findAllByType(NavTrigger)).toHaveLength(5);
    const container = swiftNav().findAllByType(View)[0];
    expect(StyleSheet.flatten(container.props.style).height).toBe(NAV_WHEEL_SLIM_H + 24);
    expect(swiftNav().findAllByType('Svg' as any)).toHaveLength(0);
  };
  try {
    assertCompact();
    for (let visit = 0; visit < 3; visit++) {
      mockPathname = '/map';
      mockCollapsed = false;
      act(() => { renderer.update(<CachedTabs />); });
      assertCompact();
      const mapNav = renderer.root.findAllByType(Speedometer)[1];
      expect(mapNav.findAllByType('Svg' as any)).toHaveLength(1);

      mockPathname = '/swifts';
      for (const scrolling of [true, false]) {
        mockCollapsed = scrolling;
        act(() => { renderer.update(<CachedTabs />); });
        assertCompact();
      }
      const buttons = swiftNav().findAllByType(NavTrigger);
      for (const button of buttons) {
        mockNavigate.mockClear();
        act(() => { button.findByProps({ testID: `nav-${button.props.section.name}` }).props.onPress(); });
        expect(mockNavigate).toHaveBeenCalledWith(button.props.section.name);
      }
    }
  } finally {
    act(() => { renderer.unmount(); });
  }
});
