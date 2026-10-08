// Where the zone tutorial draws, relative to the bottom nav.
//
// It has to cover the navbar, and on the default nav style that is not a
// zIndex question at all: the bar is the *navigator's* native tab bar
// (`app/(tabs)/_layout` → NativeTabs → UITabBarController / Material 3), drawn
// outside this screen's view tree, where nothing a screen sets can reach it.
// The overlay therefore has to be a `Modal`, which gets its own window.
//
// That is invisible to a renderer — jest cannot see a native tab bar punching
// through a scrim — so what is pinned here is the structure that makes it
// true — unwrap the Modal and the tree still looks correct to everything here
// except the assertions that go looking for it.
//
// `Button` is stubbed for the reason `auraNav` stubs the nav components: it
// pulls in ThemeContext to prove something the theme is not involved in.

import { Modal, StyleSheet, View, type ViewStyle } from 'react-native';
import { act, create, type ReactTestInstance } from 'react-test-renderer';

import {
  ZONE_TUTORIAL_Z_INDEX,
  ZoneTutorialOverlay,
} from '../../components/tutorial/ZoneTutorialOverlay';

/** Speedometer's own container zIndex — a literal in its StyleSheet, repeated
 *  here because it is not exported. The tab bar's drawn variant uses the same. */
const NAV_Z_INDEX = 100;

const NAV_HEIGHT = 200;
const SAFE_BOTTOM = 34;

jest.mock('../../hooks/useNavMetrics', () => ({ useNavHeight: () => 200 }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('../../components/ui/Button', () => ({ Button: () => null }));
// The banner takes the theme accent; any palette will do for layout assertions.
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../constants/theme').colors }),
}));

function renderOverlay(props: Partial<React.ComponentProps<typeof ZoneTutorialOverlay>> = {}) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <ZoneTutorialOverlay onDismiss={props.onDismiss ?? jest.fn()}
                           onTakeMeThere={props.onTakeMeThere ?? jest.fn()} />,
    );
  });
  return tree;
}

const styleOf = (node: ReactTestInstance): ViewStyle =>
  (StyleSheet.flatten(node.props.style) ?? {}) as ViewStyle;

const scrimOf = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType(View).find((n) => n.props.accessibilityViewIsModal);

describe('drawing above the nav', () => {
  it('lives in a Modal, the only thing that clears the native tab bar', () => {
    const modal = renderOverlay().root.findAllByType(Modal)[0];
    expect(modal.props.transparent).toBe(true);
    // Without these the scrim stops at the system bars on Android and the
    // navbar it is meant to cover shows through underneath.
    expect(modal.props.statusBarTranslucent).toBe(true);
    expect(modal.props.navigationBarTranslucent).toBe(true);
  });

  it('puts the scrim inside that Modal rather than beside it', () => {
    const modal = renderOverlay().root.findAllByType(Modal)[0];
    // Searched from the Modal down, not from the root: a scrim that is a
    // sibling of the Modal would satisfy the root but not this.
    expect(modal.findAllByType(View).some((n) => n.props.accessibilityViewIsModal)).toBe(true);
  });

  it('outranks the wheel, which is drawn in-tree and would otherwise cut through', () => {
    const scrim = scrimOf(renderOverlay())!;
    expect(ZONE_TUTORIAL_Z_INDEX).toBeGreaterThan(NAV_Z_INDEX);
    expect(styleOf(scrim).zIndex).toBe(ZONE_TUTORIAL_Z_INDEX);
    // Android orders siblings by elevation first, so that has to clear the
    // wheel's 10 independently.
    expect(styleOf(scrim).elevation).toBeGreaterThan(10);
  });
});

describe('panel placement', () => {
  it('sits clear of the nav, not on top of the thing the copy names', () => {
    // The scrim also carries `bottom: 0`, from absoluteFill — the panel is the
    // other one.
    const panel = renderOverlay().root
      .findAllByType(View)
      .find((n) => !n.props.accessibilityViewIsModal && styleOf(n).bottom !== undefined);
    expect(panel).toBeDefined();
    expect(styleOf(panel!).bottom).toBe(SAFE_BOTTOM + NAV_HEIGHT + 20);
  });
});

describe('dismissal', () => {
  it('takes the Android back button', () => {
    const onDismiss = jest.fn();
    renderOverlay({ onDismiss }).root.findAllByType(Modal)[0].props.onRequestClose();
    expect(onDismiss).toHaveBeenCalled();
  });
});
