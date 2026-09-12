/**
 * The size-class contract, pinned against the two poses of an iPhone Duo.
 *
 * These are not arbitrary numbers. The cover display is ~466pt wide and the
 * inner display is ~669pt, and the whole design rests on those landing either
 * side of one threshold. A well-meaning tweak to the breakpoint that put both
 * on the same side would collapse the feature silently — the app would still
 * run, it would just stop adapting.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  contentColumn,
  MAX_TEXT_COLUMN,
  REGULAR_WIDTH_BREAKPOINT,
  useLayoutSize,
  type LayoutSize,
} from '../../hooks/useLayout';

let mockDimensions = { width: 393, height: 852, scale: 3, fontScale: 1 };

// Hoisted above the imports by babel-plugin-jest-hoist. The factory only builds
// the accessor — `mockDimensions` is read when a test calls it, long after the
// binding is initialised — so the apparent order here is not a use-before-init.
jest.mock('react-native', () => ({
  useWindowDimensions: () => mockDimensions,
}));

/** Points, not pixels: 1398 × 2034 px and 1878 × 2670 px at their render scale. */
const DUO_FOLDED = { width: 466, height: 678 };
const DUO_UNFOLDED = { width: 669, height: 951 };

let captured: LayoutSize;

function Probe() {
  captured = useLayoutSize();
  return null;
}

/** Mount the hook at a given window size and hand back what it computed. */
function layoutAt(width: number, height: number): LayoutSize {
  mockDimensions = { ...mockDimensions, width, height };
  act(() => { create(<Probe />); });
  return captured;
}

describe('iPhone Duo poses land on opposite sides of the breakpoint', () => {
  it('reads the folded cover display as compact width', () => {
    const layout = layoutAt(DUO_FOLDED.width, DUO_FOLDED.height);
    expect(layout.widthClass).toBe('compact');
    expect(layout.isRegularWidth).toBe(false);
    expect(layout.columns).toBe(1);
  });

  it('reads the unfolded inner display as regular in BOTH dimensions', () => {
    // The distinguishing fact about this display: it reports like an iPad, not
    // like a large phone. Height matters as much as width.
    const layout = layoutAt(DUO_UNFOLDED.width, DUO_UNFOLDED.height);
    expect(layout.widthClass).toBe('regular');
    expect(layout.heightClass).toBe('regular');
    expect(layout.isRegularWidth).toBe(true);
    expect(layout.columns).toBe(2);
  });

  it('keeps clearance on both sides of the threshold', () => {
    // Not tuned to the device: there is real room either way, so a slightly
    // different Duo, or a case that insets the window, still classifies right.
    expect(REGULAR_WIDTH_BREAKPOINT - DUO_FOLDED.width).toBeGreaterThan(100);
    expect(DUO_UNFOLDED.width - REGULAR_WIDTH_BREAKPOINT).toBeGreaterThan(50);
  });
});

describe('ordinary iPhones are unaffected', () => {
  it.each([
    ['iPhone SE', 320, 568],
    ['iPhone 13 mini', 375, 812],
    ['iPhone 15', 393, 852],
    ['iPhone 15 Pro Max', 430, 932],
  ])('%s stays compact width', (_name, width, height) => {
    const layout = layoutAt(width, height);
    expect(layout.widthClass).toBe('compact');
    expect(layout.columns).toBe(1);
  });

  it('lets a compact column use the full width', () => {
    const layout = layoutAt(393, 852);
    expect(contentColumn(layout).maxWidth).toBe(393);
  });
});

describe('the threshold itself', () => {
  it('is inclusive at the boundary', () => {
    expect(layoutAt(REGULAR_WIDTH_BREAKPOINT, 900).widthClass).toBe('regular');
    expect(layoutAt(REGULAR_WIDTH_BREAKPOINT - 1, 900).widthClass).toBe('compact');
  });

  it('caps a regular-width column rather than letting it stretch', () => {
    const layout = layoutAt(DUO_UNFOLDED.width, DUO_UNFOLDED.height);
    expect(layout.maxContentWidth).toBe(MAX_TEXT_COLUMN);
    expect(layout.maxContentWidth).toBeLessThan(DUO_UNFOLDED.width);
    expect(contentColumn(layout).alignSelf).toBe('center');
  });

  it('widens the gutter when there is room for it', () => {
    expect(layoutAt(DUO_UNFOLDED.width, DUO_UNFOLDED.height).gutter)
      .toBeGreaterThan(layoutAt(DUO_FOLDED.width, DUO_FOLDED.height).gutter);
  });
});

describe('the fold is live, not a launch-time fact', () => {
  it('re-classifies when the window changes under a mounted component', () => {
    mockDimensions = { ...mockDimensions, ...DUO_FOLDED };
    let tree: ReactTestRenderer;
    act(() => { tree = create(<Probe />); });
    expect(captured.isRegularWidth).toBe(false);

    // The user opens the phone mid-task. The component is not remounted; the
    // window simply reports a different size, which is what makes carrying
    // state across the fold possible at all.
    mockDimensions = { ...mockDimensions, ...DUO_UNFOLDED };
    act(() => { tree!.update(<Probe />); });
    expect(captured.isRegularWidth).toBe(true);
    expect(captured.columns).toBe(2);

    // ...and closes it again.
    mockDimensions = { ...mockDimensions, ...DUO_FOLDED };
    act(() => { tree!.update(<Probe />); });
    expect(captured.isRegularWidth).toBe(false);
    expect(captured.columns).toBe(1);
  });
});
