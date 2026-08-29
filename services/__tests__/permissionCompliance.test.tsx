/**
 * The permission rules App Store Review rejected build 31 over, as tests.
 *
 * Guideline 5.1.1(iv) was cited against two things this file pins down:
 *
 *   1. A custom message appeared before the native permission request, and the
 *      user could press "Not Now" and defer Apple's dialog. The primer now has
 *      exactly one action in that state, and `hasEscape` below is the assertion
 *      that stops one creeping back in.
 *
 *   2. Background ("Always") location was requested as a consequence of the map
 *      mounting, rather than of anybody turning on a feature that needs it.
 *
 * The second half of each rule matters as much as the first, and is easier to
 * break by accident:
 *
 *   * The *blocked* state has no native dialog behind it, so it must offer a
 *     way out — Apple asks for Open Settings and Cancel. Removing that Cancel
 *     to be "safe" is its own rejection.
 *   * Background location is still fully supported and must still be
 *     requestable. These tests would fail if it were removed.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppThemeProvider } from '../../context/ThemeContext';

// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockLocation = {
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
};

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...a: unknown[]) => mockLocation.getForegroundPermissionsAsync(...a),
  requestForegroundPermissionsAsync: (...a: unknown[]) => mockLocation.requestForegroundPermissionsAsync(...a),
  getBackgroundPermissionsAsync: (...a: unknown[]) => mockLocation.getBackgroundPermissionsAsync(...a),
  requestBackgroundPermissionsAsync: (...a: unknown[]) => mockLocation.requestBackgroundPermissionsAsync(...a),
}));

jest.mock('expo-image-picker', () => ({
  getCameraPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'undetermined', granted: false, canAskAgain: true })),
  requestCameraPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', granted: true, canAskAgain: true })),
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'undetermined', granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', granted: true, canAskAgain: true })),
}));

// `services/permissions` imports `Linking` from 'react-native', so a mock of
// the internal module path is not what it resolves. Spy on the real one.
import { Linking } from 'react-native';

const mockOpenSettings = jest
  .spyOn(Linking, 'openSettings')
  .mockResolvedValue(undefined as never);

import { usePermissionPrimer } from '../../components/PermissionPrimer';
import {
  backgroundStatus,
  canStillPrompt,
  requestBackground,
  SUPPORTS_BACKGROUND_LOCATION,
  type PermissionState,
} from '../permissions';

const GRANTED = { status: 'granted', granted: true, canAskAgain: true };
const UNDETERMINED = { status: 'undetermined', granted: false, canAskAgain: true };
/** iOS: the dialog was refused and will not be shown again. */
const BLOCKED = { status: 'denied', granted: false, canAskAgain: false };
/** Android: refused, but asking again is still allowed. */
const DENIED = { status: 'denied', granted: false, canAskAgain: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockLocation.getForegroundPermissionsAsync.mockResolvedValue(UNDETERMINED);
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue(GRANTED);
  mockLocation.getBackgroundPermissionsAsync.mockResolvedValue(UNDETERMINED);
  mockLocation.requestBackgroundPermissionsAsync.mockResolvedValue(GRANTED);
});

// ─── Harness ──────────────────────────────────────────────────────────────────
/** Mounts the primer and exposes `ensure`, so a test can drive the real sheet
 *  rather than assert against a reimplementation of it. */
function Harness({ onReady }: { onReady: (ensure: ReturnType<typeof usePermissionPrimer>['ensure']) => void }) {
  const { ensure, primer } = usePermissionPrimer();
  onReady(ensure);
  return primer;
}

async function mountPrimer() {
  let ensure!: ReturnType<typeof usePermissionPrimer>['ensure'];
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <AppThemeProvider>
        <Harness onReady={(e) => { ensure = e; }} />
      </AppThemeProvider>,
    );
  });
  return { tree, ensure: ensure! };
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────
// `@types/react-test-renderer` at the version pinned here does not declare
// `findAll`'s `deep` option, or `ReactTestInstance.findAll` at all — which is
// why the two older feed suites carry a dozen `error TS2339` apiece. One local
// shim instead, so this file adds nothing to that backlog.
interface Instance {
  type: unknown;
  props: Record<string, any>;
  findAll(fn: (n: Instance) => boolean, opts?: { deep?: boolean }): Instance[];
}

const root = (tree: ReactTestRenderer): Instance =>
  tree.root as unknown as Instance;

/** Every button on the sheet, by accessibility label.
 *
 * De-duplicated, because `Pressable` renders a host `View` that inherits its
 * accessibility props — so a single button matches at two or three depths and
 * a raw `findAll` reports it that many times. The set of labels is what these
 * tests are actually about. */
function buttons(tree: ReactTestRenderer): string[] {
  const labels = root(tree)
    .findAll((n) => n.props?.accessibilityRole === 'button', { deep: true })
    .map((n) => String(n.props.accessibilityLabel ?? ''));
  return [...new Set(labels)];
}

/** The outermost node carrying this label, for pressing. */
function button(tree: ReactTestRenderer, label: string) {
  const found = root(tree).findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function',
    { deep: true },
  );
  if (!found.length) throw new Error(`no pressable labelled ${label}`);
  return found[0];
}

/** Anything tappable that does not say what it does.
 *
 * A backdrop dismissal is exactly this shape: a full-screen `Pressable` with an
 * `onPress` and nothing to announce. Catching unlabelled tappables catches it
 * without having to reason about the tree's geometry. */
function unlabelledTappables(tree: ReactTestRenderer): number {
  return root(tree).findAll(
    (n) => typeof n.type === 'string'
      && typeof n.props?.onPress === 'function'
      && !n.props?.accessibilityLabel,
    { deep: true },
  ).length;
}

/**
 * Whether anything on screen would let the user out without answering.
 *
 * Deliberately generous about what counts: the rejection was about the
 * *effect*, so a button called "Later" or "Maybe next time" fails this just as
 * a literal "Not Now" would.
 */
function hasEscape(tree: ReactTestRenderer): boolean {
  const escapeish = /not now|later|skip|maybe|dismiss|close|no thanks|cancel/i;
  return buttons(tree).some((label) => escapeish.test(label));
}

// ─── 5.1.1(iv) · the pre-permission sheet ─────────────────────────────────────
describe('the sheet that precedes a native permission dialog', () => {
  it('offers exactly one action, and it is Continue', async () => {
    const { tree, ensure } = await mountPrimer();
    act(() => { void ensure('location'); });
    await act(async () => {});

    expect(buttons(tree)).toEqual(['Continue']);
  });

  it('has no way to defer the dialog — this is the rejection', async () => {
    const { tree, ensure } = await mountPrimer();
    act(() => { void ensure('location'); });
    await act(async () => {});

    expect(hasEscape(tree)).toBe(false);
  });

  it('cannot be dismissed by the Android back button either', async () => {
    const { tree, ensure } = await mountPrimer();
    act(() => { void ensure('location'); });
    await act(async () => {});

    const modal = root(tree).findAll(
      (n) => typeof n.type !== 'string' && n.props?.onRequestClose,
      { deep: true },
    )[0];
    act(() => { modal.props.onRequestClose(); });
    await act(async () => {});

    // Still up, and still one button: back is a no-op while a dialog is
    // pending, for the same reason there is no Not Now.
    expect(buttons(tree)).toEqual(['Continue']);
  });

  it('has no tappable backdrop', async () => {
    const { tree, ensure } = await mountPrimer();
    act(() => { void ensure('location'); });
    await act(async () => {});

    // Nothing tappable that does not announce itself — which is what a
    // dismissing backdrop always is.
    expect(unlabelledTappables(tree)).toBe(0);
  });

  it('goes straight to the OS when Continue is pressed', async () => {
    // Undetermined when the sheet decides to show, granted on the re-read that
    // follows the request — which is how the real sequence looks.
    mockLocation.getForegroundPermissionsAsync
      .mockResolvedValueOnce(UNDETERMINED)
      .mockResolvedValue(GRANTED);

    const { tree, ensure } = await mountPrimer();
    let granted: boolean | undefined;
    act(() => { void ensure('location').then((g) => { granted = g; }); });
    await act(async () => {});

    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();

    await act(async () => { button(tree, 'Continue').props.onPress(); });

    expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(granted).toBe(true);
  });

  it('reports the user’s refusal rather than re-asking', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue(BLOCKED);
    mockLocation.getForegroundPermissionsAsync
      .mockResolvedValueOnce(UNDETERMINED)
      .mockResolvedValue(BLOCKED);

    const { tree, ensure } = await mountPrimer();
    let granted: boolean | undefined;
    act(() => { void ensure('location').then((g) => { granted = g; }); });
    await act(async () => {});

    await act(async () => { button(tree, 'Continue').props.onPress(); });

    expect(granted).toBe(false);
    expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

// ─── 5.1.1(iv) · the state with no dialog behind it ───────────────────────────
describe('the sheet shown when the OS will not ask again', () => {
  beforeEach(() => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(BLOCKED);
  });

  it('offers Open Settings and Cancel', async () => {
    const { tree, ensure } = await mountPrimer();
    act(() => { void ensure('location'); });
    await act(async () => {});

    expect(buttons(tree)).toEqual(['Open system settings', 'Cancel']);
  });

  it('keeps a way out, because there is no dialog to defer', async () => {
    const { tree, ensure } = await mountPrimer();
    act(() => { void ensure('location'); });
    await act(async () => {});

    // The inverse of the assertion above, and just as load-bearing: removing
    // this Cancel would strand the user on a sheet with one button that leaves
    // the app.
    expect(hasEscape(tree)).toBe(true);
  });

  it('deep-links to the app’s own settings', async () => {
    const { tree, ensure } = await mountPrimer();
    act(() => { void ensure('location'); });
    await act(async () => {});

    await act(async () => {
      button(tree, 'Open system settings').props.onPress();
    });

    expect(mockOpenSettings).toHaveBeenCalled();
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('never shows at all when the permission is already granted', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(GRANTED);
    const { tree, ensure } = await mountPrimer();

    let granted: boolean | undefined;
    await act(async () => { granted = await ensure('location'); });

    expect(granted).toBe(true);
    expect(buttons(tree)).toEqual([]);
  });
});

describe('canStillPrompt', () => {
  it('separates the two sheet shapes', () => {
    const prompts: PermissionState[] = ['undetermined', 'denied'];
    const settings: PermissionState[] = ['blocked', 'restricted'];
    prompts.forEach((s) => expect(canStillPrompt(s)).toBe(true));
    settings.forEach((s) => expect(canStillPrompt(s)).toBe(false));
  });
});

// ─── 5.1.1(iv) · when background location is asked for ────────────────────────
describe('background location', () => {
  it('is still supported — this is not a removal', () => {
    expect(SUPPORTS_BACKGROUND_LOCATION).toBe(true);
  });

  it('is not asked for while foreground is ungranted', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(UNDETERMINED);

    expect(await backgroundStatus()).toBe('needs_foreground');
    expect(await requestBackground()).toBe('needs_foreground');
    expect(mockLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('goes through the iOS upgrade prompt once foreground is granted', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(GRANTED);
    mockLocation.getBackgroundPermissionsAsync
      .mockResolvedValueOnce(DENIED)
      .mockResolvedValue(GRANTED);

    expect(await requestBackground()).toBe('granted');
    expect(mockLocation.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not prompt again when Always is already granted', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(GRANTED);
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue(GRANTED);

    expect(await backgroundStatus()).toBe('granted');
    expect(await requestBackground()).toBe('granted');
    expect(mockLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports a refusal as a refusal, not an error', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(GRANTED);
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue(DENIED);

    expect(await requestBackground()).toBe('declined');
  });

  it('says so when iOS will not show the upgrade prompt any more', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(GRANTED);
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue(BLOCKED);

    expect(await backgroundStatus()).toBe('needs_settings');
    expect(await requestBackground()).toBe('needs_settings');
    // No point asking: the answer would be the same and the dialog never
    // appears, leaving a button that looks broken.
    expect(mockLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });
});
