// The travel-mode sheet, as the person opening it experiences it.
//
// `directions.test.ts` pins the arithmetic and the URL. This pins the part
// that lives between them, which is where the feature can be quietly broken
// without a single unit test noticing:
//
//   - the mode you picked is the mode Google Maps opens with;
//   - a pin four streets away offers walking *first*, which is the whole
//     reason the sheet exists rather than a driving link;
//   - refusing location permission costs you the times and nothing else — the
//     sheet still hands the place to a maps app, which has its own location;
//   - and the sheet never asks for location on its own. iOS allows one dialog
//     per install, the map needs it, and a card spending it from behind a
//     "Directions" button is the cold prompt the permission priming exists to
//     stop.
//
// `expo-location` is mocked at the module boundary rather than through
// `services/permissions`, so the "does not prompt" test is watching the real
// call the real code would make.

import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Linking } from 'react-native';
import * as Location from 'expo-location';

import { DirectionsSheet } from '../../components/DirectionsSheet';
import { AppThemeProvider } from '../../context/ThemeContext';
import { fetchRoute } from '../routing';

const ALMATY = { latitude: 43.238949, longitude: 76.889709 };

/** A point `north` metres north of Almaty. Latitude only, so the distance is
 *  the offset and nothing has to be worked backwards from a longitude. */
function metresNorth(north: number) {
  return { latitude: ALMATY.latitude + north / 111_320, longitude: ALMATY.longitude };
}

const mockLocation = {
  granted: true,
  position: ALMATY as { latitude: number; longitude: number } | null,
};
let mockOnlineAvailable = false;
jest.mock('../routing', () => ({
  routingProviders: () => mockOnlineAvailable ? [{ mode: 'drive', hostname: 'routes.example.test' }] : [],
  routingAvailable: (mode?: string) => mockOnlineAvailable && (mode === undefined || mode === 'drive'),
  fetchRoute: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({
    status: mockLocation.granted ? 'granted' : 'denied',
    canAskAgain: true,
  })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: 'granted',
    canAskAgain: true,
  })),
  getLastKnownPositionAsync: jest.fn(async () =>
    mockLocation.position ? { coords: { ...mockLocation.position, accuracy: 5 }, timestamp: Date.now() } : null,
  ),
  getCurrentPositionAsync: jest.fn(async () =>
    mockLocation.position ? { coords: { ...mockLocation.position, accuracy: 5 }, timestamp: Date.now() } : null,
  ),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'denied', canAskAgain: false })),
}));

jest.mock('expo-image-picker', () => ({
  getCameraPermissionsAsync: jest.fn(async () => ({ status: 'denied', canAskAgain: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: 'denied', canAskAgain: true })),
}));

// The sheet reads the bottom inset for its padding. Same stand-in as every
// other component test here — a provider would need a layout pass that
// react-test-renderer does not do.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'denied', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied', canAskAgain: true })),
}));

const openSpy = jest.spyOn(Linking, 'openURL');
const mounted: ReactTestRenderer[] = [];

/** Mount and let the location effect settle, so the estimates are on screen. */
async function render(node: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<AppThemeProvider>{node}</AppThemeProvider>);
  });
  mounted.push(tree);
  return tree;
}

/** Every string in the tree — see the note in screenHeader.test.tsx for why
 *  this walks the JSON rather than asking Text instances for their children. */
function texts(tree: ReactTestRenderer): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string') return void found.push(node);
    if (Array.isArray(node)) return void node.forEach(walk);
    (node as { children?: unknown[] }).children?.forEach(walk);
  };
  walk(tree.toJSON());
  return found;
}

interface Node { props: Record<string, unknown> }

/**
 * `tree.root`, with the method it actually has.
 *
 * `findAll` is missing from the `ReactTestInstance` type this project resolves
 * — the same stale-typings gap that leaves the pre-existing errors in
 * swiftLocationPrivacy and swiftsFeedPlayback. Narrowed here rather than left
 * to fail so this file adds nothing to that count.
 */
function rootOf(tree: ReactTestRenderer) {
  return tree.root as unknown as {
    findAll(match: (n: Node) => boolean, options?: { deep?: boolean }): Node[];
  };
}

/** The pressable whose accessibility label starts with `prefix`. */
function pressableLabelled(tree: ReactTestRenderer, prefix: string): Node {
  const hit = rootOf(tree).findAll(
    (n) =>
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.startsWith(prefix) &&
      typeof n.props.onPress === 'function',
    { deep: true },
  );
  if (!hit.length) throw new Error(`no pressable labelled ${prefix}`);
  return hit[0];
}

async function press(node: Node) {
  await act(async () => { await (node.props.onPress as () => unknown)(); });
}

const sheet = (target: Parameters<typeof DirectionsSheet>[0]['target']) => (
  <DirectionsSheet visible target={target} onClose={() => {}} />
);

beforeEach(() => {
  mockOnlineAvailable = false;
  (fetchRoute as jest.Mock).mockReset().mockResolvedValue({ mode: 'drive', meters: 5_400, seconds: 600 });
  mockLocation.granted = true;
  mockLocation.position = ALMATY;
  openSpy.mockReset();
  openSpy.mockResolvedValue(true);
});
afterEach(() => { act(() => { mounted.splice(0).forEach(tree => tree.unmount()); }); });

afterAll(() => openSpy.mockRestore());

describe('the modes on offer', () => {
  it('lists all four, whatever the distance', async () => {
    const tree = await render(sheet({ ...metresNorth(4_000), title: 'Riverside café' }));
    const strings = texts(tree);
    for (const label of ['Drive', 'Walk', 'Cycle', 'Transit']) {
      expect(strings).toContain(label);
    }
  });

  it('quotes a time and an arrival for each one', async () => {
    const tree = await render(sheet({ ...metresNorth(4_000), title: 'Riverside café' }));
    const strings = texts(tree).join(' | ');
    expect(strings).toMatch(/\d+ min/);
    expect(strings).toMatch(/arrive /);
  });

  it('says how far away it is', async () => {
    const tree = await render(sheet({ ...metresNorth(4_000), title: 'Riverside café' }));
    expect(texts(tree).join(' | ')).toContain('away in a straight line');
  });

  it('refuses to quote a walk across a continent', async () => {
    // 300 km north. Google would answer; the number would be a fiction.
    const tree = await render(sheet({ ...metresNorth(300_000), title: 'Far away' }));
    expect(texts(tree)).toContain('Too far');
  });

  it('says you are already there instead of timing a 20 m walk', async () => {
    const tree = await render(sheet({ ...metresNorth(20), title: 'Right here' }));
    expect(texts(tree).join(' | ')).toContain('You’re already here');
  });
});

describe('which mode is selected first', () => {
  it('defaults to walking for somewhere a few streets away', async () => {
    const tree = await render(sheet({ ...metresNorth(700), title: 'The corner shop' }));
    await press(pressableLabelled(tree, 'Open walk directions'));
    expect(openSpy.mock.calls[0][0]).toContain('travelmode=walking');
  });

  it('defaults to driving for somewhere across the city', async () => {
    const tree = await render(sheet({ ...metresNorth(9_000), title: 'The airport' }));
    await press(pressableLabelled(tree, 'Open drive directions'));
    expect(openSpy.mock.calls[0][0]).toContain('travelmode=driving');
  });

  it('keeps the user’s pick once they have made one', async () => {
    const tree = await render(sheet({ ...metresNorth(9_000), title: 'The airport' }));
    await press(pressableLabelled(tree, 'Transit,'));
    await press(pressableLabelled(tree, 'Open transit directions'));
    expect(openSpy.mock.calls[0][0]).toContain('travelmode=transit');
  });

  it('opens Google Maps, not a search link', async () => {
    const tree = await render(sheet({ ...metresNorth(9_000), title: 'The airport' }));
    await press(pressableLabelled(tree, 'Open drive directions'));
    expect(openSpy.mock.calls[0][0]).toContain('https://www.google.com/maps/dir/?');
  });

  it('does not put the place name in the URL it opens', async () => {
    const tree = await render(sheet({ ...metresNorth(900), title: 'Aisha’s birthday' }));
    await press(pressableLabelled(tree, 'Open '));
    expect(openSpy.mock.calls[0][0]).not.toContain('Aisha');
  });
});

describe('without location permission', () => {
  beforeEach(() => { mockLocation.granted = false; });

  it('says what is missing and offers a way to fix it', async () => {
    const tree = await render(sheet({ ...metresNorth(2_000), title: 'Riverside café' }));
    const strings = texts(tree).join(' | ');
    expect(strings).toContain('Turn on location');
    expect(strings).toContain('Allow');
  });

  it('never asks for it on its own', async () => {
    // The cold-prompt rule. Mounting the sheet must read the permission and
    // stop there; the OS dialog only appears if the user presses "Allow".
    await render(sheet({ ...metresNorth(2_000), title: 'Riverside café' }));
    expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('still hands the place to Google Maps, with the mode chosen', async () => {
    const tree = await render(sheet({ ...metresNorth(2_000), title: 'Riverside café' }));
    await press(pressableLabelled(tree, 'Cycle'));
    await press(pressableLabelled(tree, 'Open cycle directions'));
    expect(openSpy.mock.calls[0][0]).toContain('travelmode=bicycling');
  });

  it('quotes no times it cannot stand behind', async () => {
    const tree = await render(sheet({ ...metresNorth(2_000), title: 'Riverside café' }));
    expect(texts(tree).join(' | ')).not.toMatch(/arrive /);
  });
});

describe('when the fix fails', () => {
  it('says so and offers a retry rather than a permission it already has', async () => {
    mockLocation.position = null;
    const tree = await render(sheet({ ...metresNorth(2_000), title: 'Riverside café' }));
    const strings = texts(tree).join(' | ');
    expect(strings).toContain('Couldn’t get a fix');
    expect(strings).toContain('Retry');
    expect(strings).not.toContain('Turn on location');
  });
});

describe('an approximate destination', () => {
  it('says the last few minutes are a guess', async () => {
    const tree = await render(
      sheet({ ...metresNorth(2_000), title: 'Where a Swift was made', approximate: true }),
    );
    expect(texts(tree).join(' | ')).toContain('not an exact spot');
  });

  it('stays quiet about it for an exact one', async () => {
    const tree = await render(sheet({ ...metresNorth(2_000), title: 'Riverside café' }));
    expect(texts(tree).join(' | ')).not.toContain('not an exact spot');
  });
});

describe('the estimate is labelled as one', () => {
  it('says the times are not live, every time it shows any', async () => {
    const tree = await render(sheet({ ...metresNorth(4_000), title: 'Riverside café' }));
    expect(texts(tree).join(' | ')).toContain('Estimated from distance');
  });
});

describe('online route disclosure', () => {
  beforeEach(() => { mockOnlineAvailable = true; });

  it('shows the provider while keeping the initial estimates offline', async () => {
    const tree = await render(sheet({ ...metresNorth(4_000), title: 'Destination' }));
    expect(texts(tree).join(' ')).toContain('routes.example.test');
    expect(texts(tree)).toContain('Modelled estimate');
    expect(fetchRoute).not.toHaveBeenCalled();
  });

  it('requests routes only after a press and labels supported and modelled modes separately', async () => {
    const tree = await render(sheet({ ...metresNorth(4_000), title: 'Destination' }));
    await press(pressableLabelled(tree, 'Check road routes'));
    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(fetchRoute).toHaveBeenCalledWith(ALMATY, metresNorth(4_000), 'drive', expect.anything());
    expect(texts(tree)).toContain('Road route');
    expect(texts(tree)).toContain('Modelled estimate');
    expect(texts(tree).join(' ')).toContain('Road routes for Drive. Other modes remain estimates');
    expect(texts(tree).join(' ')).not.toContain('Your location stays on this phone');
  });

  it('requires a new road-check press for a different destination', async () => {
    const tree = await render(sheet({ ...metresNorth(4_000), title: 'First destination' }));
    await press(pressableLabelled(tree, 'Check road routes'));
    await act(async () => {
      tree.update(<AppThemeProvider>{sheet({ ...metresNorth(6_000), title: 'Second destination' })}</AppThemeProvider>);
    });
    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(pressableLabelled(tree, 'Check road routes')).toBeTruthy();
  });

  it('starts offline again when a sheet is closed and reopened', async () => {
    const target = { ...metresNorth(4_000), title: 'Destination' };
    const tree = await render(sheet(target));
    await press(pressableLabelled(tree, 'Check road routes'));
    await act(async () => {
      tree.update(<AppThemeProvider><DirectionsSheet visible={false} target={target} onClose={() => {}} /></AppThemeProvider>);
    });
    await act(async () => { tree.update(<AppThemeProvider>{sheet(target)}</AppThemeProvider>); });
    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(pressableLabelled(tree, 'Check road routes')).toBeTruthy();
  });
});
