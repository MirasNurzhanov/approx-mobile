// The two pieces of chrome behaviour added for the iOS 26 pass: the glass
// material, and pulling a sheet down to close it.
//
// What is worth asserting here is narrow, deliberately. Neither a blur radius
// nor the feel of a spring is testable in jsdom, and a test that pretended
// otherwise would pin down the numbers rather than the behaviour. What *is*
// testable is the part that breaks silently:
//
//   - glass falls back to an opaque fill on Android, where `expo-blur` does not
//     sample the backdrop. The version of this bug that ships is a washed-out
//     grey rectangle nobody catches in review, because the reviewer is holding
//     an iPhone;
//   - the wash never drops below the contrast floor whatever a caller asks for,
//     because everything drawn on top keeps the colour token it had when the
//     surface was solid;
//   - a drag closes the sheet through the screen's *own* close function, so a
//     dragged dismiss and a backdrop tap cannot drift apart.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

jest.mock('expo-blur', () => {
  const React = require('react');
  const { View: RNView } = require('react-native');
  return {
    BlurView: (p: Record<string, unknown>) =>
      React.createElement(RNView, { ...p, testID: 'blur' }),
  };
});

// Pin the OS version the render tests run under. Without this they inherit
// whatever jest-expo reports for `Platform.Version`, which is not iOS 26 — so
// `GLASS` would be false and the glass branch below would never be exercised.
// The *rule* itself is covered separately, as a pure function, which is why it
// is one.
jest.mock('../../constants/platform', () => ({
  IOS_MAJOR_VERSION: 26,
  isIOS26OrNewer: true,
  BAR_STYLE_IS_NATIVE: true,
  resolveIOSMajorVersion: () => 26,
  resolvesToNativeBar: () => true,
}));

jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    colors: require('../../constants/theme').lightColors,
    themeMode: 'light',
  }),
}));

// Reanimated's real entry point reaches for the native bridge on import, so it
// is replaced here the same way the feed suites replace it. `withSpring` is
// the only animation `useSheetDrag` builds, and returning the target value is
// enough to assert what was written.
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: (p: unknown) => p, createAnimatedComponent: (c: unknown) => c },
  createAnimatedComponent: (c: unknown) => c,
  useSharedValue: () => ({ get: () => 0, set: () => {}, value: 0 }),
  useAnimatedStyle: () => ({}),
  withSpring: (v: unknown) => v,
  withTiming: (v: unknown) => v,
}));

// Only `scheduleOnRN` is stubbed — a wholesale replacement of this module
// breaks reanimated's own `createSerializable`, which is the sort of failure
// that reads as a bug in the code under test rather than in its mock.
const scheduled: (() => void)[] = [];
jest.mock('react-native-worklets', () => ({
  ...jest.requireActual('react-native-worklets'),
  scheduleOnRN: (fn: () => void) => scheduled.push(fn),
}));

/** Render inside `act`, the way the other suites here do — `create` on its own
 *  leaves the renderer unmounted and every later `.root` throws. */
function draw(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element);
  });
  return tree;
}

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flatten(s) }), {},
    );
  }
  return (style ?? {}) as Record<string, unknown>;
}

/**
 * `tree.root` with the query methods typed.
 *
 * `ReactTestInstance`'s published types omit `findAll`/`findAllByProps` in this
 * version, so every call site would need its own cast. One here instead — the
 * other suites in this directory carry the untyped calls, and there is no
 * reason to add to that.
 */
type Queryable = {
  findAll: (p: (n: Node) => boolean) => Node[];
  findAllByProps: (p: Record<string, unknown>) => Node[];
  findAllByType: (t: unknown) => Node[];
};
type Node = { props: Record<string, unknown> };

function root(tree: ReactTestRenderer): Queryable {
  return tree.root as unknown as Queryable;
}

/** Every backgroundColor in the tree, flattened out of nested style arrays. */
function backgrounds(tree: ReactTestRenderer): string[] {
  return root(tree).findAll(() => true)
    .map((n) => flatten(n.props.style).backgroundColor)
    .filter((c): c is string => typeof c === 'string');
}

// ─── Glass ────────────────────────────────────────────────────────────────────
import {
  GlassBackdrop, GlassSurface, supportsBackdropBlur,
} from '../../components/ui/GlassSurface';

describe('supportsBackdropBlur', () => {
  // The platform rule as a pure function, which is why it is one — see the
  // note on it. The rendering branch below is a single `if` over this value.
  it('is on for iOS 26 and newer', () => {
    expect(supportsBackdropBlur('ios', 26)).toBe(true);
    expect(supportsBackdropBlur('ios', 27)).toBe(true);
  });

  it('is off for older iOS, where the rest of the OS is not glass', () => {
    // Capability is not the question here — expo-blur would blur fine. Glass is
    // a system look, and a blurred button surrounded by opaque system chrome
    // reads as a mistake rather than as native.
    expect(supportsBackdropBlur('ios', 25)).toBe(false);
    expect(supportsBackdropBlur('ios', 18)).toBe(false);
  });

  it('is off for Android, whatever the version number says', () => {
    // The trap this closes: `Platform.Version` is a string on iOS and the API
    // *level* on Android, so Android 14 reports 34. A gate that only compared
    // the number would turn glass on for every modern Android — where
    // `expo-blur` does not sample the backdrop at all, and the result is a flat
    // grey rectangle nobody catches in review because the reviewer is on an
    // iPhone.
    expect(supportsBackdropBlur('android', 34)).toBe(false);
    expect(supportsBackdropBlur('android', 26)).toBe(false);
  });

  it('is off for anything unrecognised rather than defaulting to glass', () => {
    expect(supportsBackdropBlur('web', 26)).toBe(false);
    expect(supportsBackdropBlur('', 0)).toBe(false);
  });
});

describe('GlassSurface', () => {
  // jest-expo runs these as iOS, so this is the glass branch.
  it('blurs the backdrop', () => {
    const tree = draw(<GlassSurface />);
    expect(root(tree).findAllByProps({ testID: 'blur' }).length).toBeGreaterThan(0);
  });

  it('keeps the wash above the contrast floor however little is asked for', () => {
    const tree = draw(<GlassBackdrop opacity={0} />);
    const alphas = backgrounds(tree)
      .filter((c) => c.startsWith('rgba'))
      .map((c) => Number(c.split(',').pop()!.replace(')', '')));
    expect(alphas.length).toBeGreaterThan(0);
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0.5);
  });

  it('paints no background of its own, which would cover the blur', () => {
    const tree = draw(<GlassSurface style={{ borderRadius: 12 }} />);
    const outer = root(tree).findAllByType(View)[0];
    const style = flatten(outer.props.style);
    expect(style.backgroundColor).toBe('transparent');
    // And it clips, or the blur shows as four grey nicks outside the radius.
    expect(style.overflow).toBe('hidden');
    // The caller's own style still lands.
    expect(style.borderRadius).toBe(12);
  });

  it('washes chrome over media in black rather than in the theme colour', () => {
    // Camera controls and video badges carry white glyphs in both themes, so a
    // wash that followed the theme would make them unreadable on a light
    // background half the time.
    const tree = draw(<GlassBackdrop tone="dark" opacity={0.45} />);
    const washes = backgrounds(tree).filter((c) => c.startsWith('rgba'));
    expect(washes.length).toBeGreaterThan(0);
    washes.forEach((c) => expect(c.startsWith('rgba(0,0,0,')).toBe(true));
  });

  it('lets an over-media wash go below the themed contrast floor', () => {
    // The floor exists to keep a themed surface's own contrast predictable.
    // Applied to a scrim it would black out the camera preview behind its own
    // controls, which is the opposite of what the material is for.
    const tree = draw(<GlassBackdrop tone="dark" opacity={0.3} />);
    const alphas = backgrounds(tree)
      .filter((c) => c.startsWith('rgba'))
      .map((c) => Number(c.split(',').pop()!.replace(')', '')));
    expect(Math.min(...alphas)).toBeCloseTo(0.3);
  });

  it('forwards the accessibility props of the View it replaced', () => {
    const tree = draw(<GlassSurface accessible accessibilityLabel="3 people nearby" />);
    expect(
      root(tree).findAllByProps({ accessibilityLabel: '3 people nearby' }).length,
    ).toBeGreaterThan(0);
  });
});

// ─── Drag to dismiss ──────────────────────────────────────────────────────────
describe('useSheetDrag', () => {
  // `Gesture.Pan()` builds a config object rather than running anything, so its
  // handlers can be pulled off and called with a synthetic event. That is the
  // whole of what these assert: the thresholds, and which function a release
  // runs.
  type Handlers = {
    onUpdate: (e: object) => void;
    onEnd: (e: object, ok: boolean) => void;
  };

  beforeEach(() => {
    scheduled.length = 0;
  });

  function build(height: number, onDismiss: () => void, set: (v: number) => void = () => {}) {
    const { useSheetDrag } = require('../../components/ui/useSheetDrag');
    // useSheetDrag calls no React hooks - it only assembles a Gesture
    // object, so driving it from a plain helper is safe. The rule fires on
    // the `use` prefix alone.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const gesture = useSheetDrag({
      sheetY: { get: () => 0, set, value: 0 },
      height,
      onDismiss,
    });
    return {
      handlers: gesture.handlers as Handlers,
      flush: () => scheduled.splice(0).forEach((f) => f()),
    };
  }

  function release(height: number, e: { translationY?: number; velocityY?: number }) {
    const onDismiss = jest.fn();
    const { handlers, flush } = build(height, onDismiss);
    handlers.onEnd({ translationY: 0, velocityY: 0, ...e }, true);
    flush();
    return onDismiss;
  }

  it('closes when dragged past a third of the sheet', () => {
    expect(release(600, { translationY: 260 })).toHaveBeenCalledTimes(1);
  });

  it('springs back from a short drag instead of closing', () => {
    expect(release(600, { translationY: 40 })).not.toHaveBeenCalled();
  });

  it('closes on a fast flick that never travelled far', () => {
    // Distance alone would refuse this, and a flick is how most people
    // actually dismiss a sheet.
    expect(release(600, { translationY: 30, velocityY: 1400 })).toHaveBeenCalledTimes(1);
  });

  it('ignores a slow drift at the end of a drag that went nowhere', () => {
    expect(release(600, { translationY: 30, velocityY: 200 })).not.toHaveBeenCalled();
  });

  it('never lifts the sheet above its resting position', () => {
    // A sheet that can be flung upward has a second, undefined resting place —
    // and a visible gap under it.
    const values: number[] = [];
    const { handlers } = build(600, jest.fn(), (v) => values.push(v));
    handlers.onUpdate({ translationY: -200 });
    handlers.onUpdate({ translationY: 120 });
    expect(values).toEqual([0, 120]);
  });

  it('dismisses through the caller function rather than animating itself away', () => {
    // The property that keeps one close path: a dragged dismiss runs the same
    // teardown as a backdrop tap.
    const onDismiss = jest.fn();
    const values: number[] = [];
    const { handlers, flush } = build(600, onDismiss, (v) => values.push(v));
    handlers.onEnd({ translationY: 400, velocityY: 0 }, true);
    flush();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Nothing was written to the offset on the way out — the screen's own
    // close animation owns that.
    expect(values).toEqual([]);
  });
});
