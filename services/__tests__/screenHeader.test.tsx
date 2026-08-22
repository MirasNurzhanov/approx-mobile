// Which navigation bar a screen ends up with.
//
// `platformGate.test.ts` pins the version arithmetic — that iOS 26 answers
// true, and that iOS 25 and every Android API level answer false. This file
// pins what the app does with that answer, which is the half a reader would
// otherwise have to take on trust: when the gate is open the header must be
// *absent* from the React tree and present as native stack options; when it is
// shut the app's own view must render exactly as before.
//
// The gate is mocked rather than `Platform`, because the gate is a module-level
// constant: by the time a test could reassign `Platform.OS`, the real value has
// already been read. It is a getter over a mutable object rather than a
// `resetModules` swap, because resetting the registry mid-file gives the
// component a second copy of React and every hook throws.

import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { AppThemeProvider } from '../../context/ThemeContext';

const mockGate = { isIOS26OrNewer: false };

jest.mock('../../constants/platform', () => ({
  get isIOS26OrNewer() {
    return mockGate.isIOS26OrNewer;
  },
  get IOS_MAJOR_VERSION() {
    return mockGate.isIOS26OrNewer ? 26 : 18;
  },
  resolveIOSMajorVersion: () => (mockGate.isIOS26OrNewer ? 26 : 18),
}));

/** Options handed to the native stack by the most recent render. */
let lastNativeOptions: Record<string, any> | null = null;

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  Stack: {
    Screen: (props: { options?: Record<string, any> }) => {
      lastNativeOptions = props.options ?? null;
      return null;
    },
  },
}));

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<AppThemeProvider>{element}</AppThemeProvider>);
  });
  return tree;
}

/**
 * Every string rendered anywhere in the tree.
 *
 * Walks the JSON rather than `findAllByType(Text)`: a test instance's
 * `children` exposes child *instances*, not the raw strings inside them, so
 * that route finds the Text nodes and reports every one of them as empty.
 */
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

beforeEach(() => {
  lastNativeOptions = null;
  mockGate.isIOS26OrNewer = false;
});

describe('iOS 26 and newer', () => {
  beforeEach(() => {
    mockGate.isIOS26OrNewer = true;
  });

  it('hands the header to the native stack and draws none of its own', () => {
    const tree = render(<ScreenHeader title="Blocked users" />);

    expect(lastNativeOptions).toMatchObject({ headerShown: true, title: 'Blocked users' });
    expect(texts(tree)).not.toContain('Blocked users');
  });

  it('leaves the system appearance alone', () => {
    render(<ScreenHeader title="Permissions" />);

    // The one that matters most: `header` replaces UINavigationBar wholesale
    // with a React component. Setting it would turn this path back into the
    // recreation it exists to avoid, and nothing else here would notice.
    expect(lastNativeOptions).not.toHaveProperty('header');

    // Any of these would replace part of what UIKit draws with something
    // static, which is what this whole path exists to avoid.
    expect(lastNativeOptions).not.toHaveProperty('headerStyle');
    expect(lastNativeOptions).not.toHaveProperty('headerTransparent');
    expect(lastNativeOptions).not.toHaveProperty('headerBackground');
    expect(lastNativeOptions).not.toHaveProperty('headerBlurEffect');
    expect(lastNativeOptions).not.toHaveProperty('scrollEdgeEffects');
    // A tint is the one thing UIKit expects an app to supply.
    expect(typeof lastNativeOptions?.headerTintColor).toBe('string');
  });

  it('keeps the subtitle, which the system bar has no room for', () => {
    const tree = render(<ScreenHeader title="Links" subtitle="3 of 5" />);
    expect(texts(tree)).toContain('3 of 5');
  });

  it('sends a trailing action to UIKit as a native bar button item', () => {
    const onPress = jest.fn();
    const tree = render(
      <ScreenHeader title="Edit Profile" action={{ label: 'Save', onPress, prominent: true }} />,
    );

    const items = lastNativeOptions?.unstable_headerRightItems?.();
    expect(items).toEqual([
      expect.objectContaining({
        type: 'button',
        label: 'Save',
        variant: 'prominent',
        disabled: false,
      }),
    ]);

    // The button is UIKit's; the handler is still ours, and still runs.
    items[0].onPress();
    expect(onPress).toHaveBeenCalledTimes(1);

    // And it is not also drawn as a React view over the native bar.
    expect(texts(tree)).not.toContain('Save');
  });

  it('attaches a native UISearchController and routes its events', () => {
    const onChangeText = jest.fn();
    const onSubmit = jest.fn();
    const onCancel = jest.fn();
    const tree = render(
      <ScreenHeader
        title="Search"
        search={{ placeholder: 'Search by username', autoFocus: true, onChangeText, onSubmit, onCancel }}
      />,
    );

    const opts = lastNativeOptions?.headerSearchBarOptions;
    expect(opts).toMatchObject({ placeholder: 'Search by username', autoFocus: true });

    // The field is UIKit's; the handlers are still ours. Events arrive wrapped
    // as native synthetic events.
    opts.onChangeText({ nativeEvent: { text: 'ada' } });
    opts.onSearchButtonPress({ nativeEvent: { text: 'ada' } });
    opts.onCancelButtonPress();
    expect(onChangeText).toHaveBeenCalledWith('ada');
    expect(onSubmit).toHaveBeenCalledWith('ada');
    expect(onCancel).toHaveBeenCalledTimes(1);

    // And no TextInput of ours is drawn alongside it.
    expect(texts(tree)).not.toContain('Search by username');
  });

  it('sets no search bar for a screen that did not ask for one', () => {
    render(<ScreenHeader title="Permissions" />);
    expect(lastNativeOptions).not.toHaveProperty('headerSearchBarOptions');
  });

  it('sets no header items for a screen with no action', () => {
    render(<ScreenHeader title="Your connections" />);
    expect(lastNativeOptions).not.toHaveProperty('unstable_headerRightItems');
  });

  it('ignores a screen’s own header markup', () => {
    const tree = render(
      <ScreenHeader title="Zone Music">
        <Text>a bespoke header</Text>
      </ScreenHeader>,
    );

    expect(lastNativeOptions).toMatchObject({ title: 'Zone Music' });
    expect(texts(tree)).not.toContain('a bespoke header');
  });
});

// One suite, because iOS 25 and Android reach it by the same route: the gate
// answers false. Which platforms those are is `platformGate.test.ts`'s job.
describe('iOS 25 and older, Android, and everywhere else', () => {
  it('draws the app’s own navigation bar and sets no native header', () => {
    const tree = render(<ScreenHeader title="Notifications" subtitle="What matters" />);

    expect(lastNativeOptions).toBeNull();
    expect(texts(tree)).toEqual(expect.arrayContaining(['Notifications', 'What matters']));
  });

  it('renders a screen’s existing header markup untouched', () => {
    const tree = render(
      <ScreenHeader title="Zone Music">
        <Text>a bespoke header</Text>
      </ScreenHeader>,
    );

    expect(lastNativeOptions).toBeNull();
    expect(texts(tree)).toContain('a bespoke header');
    // The children *are* the header here — the shared fallback must not also run.
    expect(texts(tree)).not.toContain('Zone Music');
  });

  it('draws a trailing action as an ordinary button', () => {
    const onPress = jest.fn();
    const tree = render(<ScreenHeader title="Edit Profile" action={{ label: 'Save', onPress }} />);

    expect(texts(tree)).toContain('Save');
  });
});
