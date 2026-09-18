/* eslint-disable @typescript-eslint/no-require-imports -- Jest factories run before imports. */
// The signed-out screens follow the app's theme.
//
// They used to be pinned to the light palette, so signing out of a dark app
// dropped the user onto a cream login page. Each screen is rendered in both
// themes here, and the dark render may not carry any of the light palette's
// surface or accent colours anywhere in its tree.

import { StyleSheet, TextInput } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { colors as darkColors, lightColors } from '../../constants/theme';

let mockMode: 'light' | 'dark' = 'dark';
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => {
    const theme = require('../../constants/theme');
    return {
      colors: mockMode === 'dark' ? theme.colors : theme.lightColors,
      themeMode: mockMode,
      toggleTheme: () => {},
    };
  },
}));
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ login: jest.fn(), confirmLogout: jest.fn(), completeSocialSignIn: jest.fn() }),
}));
jest.mock('../../services/terms', () => ({
  ACCEPT_TERMS_PAYLOAD: { accept_terms: true },
  openDocument: jest.fn(),
  refreshDocuments: jest.fn(() => Promise.resolve({})),
  useTerms: () => ({ documents: { terms_url: 't', guidelines_url: 'g', privacy_url: 'p' } }),
}));
jest.mock('../../services/socialAuth', () => ({
  isAppleAvailable: () => Promise.resolve(true),
  isGoogleAvailable: true,
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
  SocialSignInCancelled: class extends Error {},
  SocialSignInError: class extends Error {},
}));
jest.mock('../../services/api', () => ({ api: { get: jest.fn(), patch: jest.fn() }, BASE_URL: 'http://api.test' }));
jest.mock('../../services/auth', () => ({ loginRequest: jest.fn() }));
jest.mock('../../services/onboarding', () => ({ markOnboardingSeen: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const LoginScreen = require('../../app/login').default;
const RegisterScreen = require('../../app/register').default;
const WelcomeScreen = require('../../app/welcome').default;
const OnboardingScreen = require('../../app/onboarding').default;
const SocialBirthdayScreen = require('../../app/social-birthday').default;
const SocialAuthButtons = require('../../components/SocialAuthButtons').default;

/** Light-palette values that have no business in a dark render. */
const LIGHT_ONLY = [lightColors.bg, lightColors.surface2, lightColors.teal, lightColors.t1, '#E8E4F5']
  .map((c) => c.toLowerCase());

function colourValues(node: ReactTestInstance): string[] {
  const style = StyleSheet.flatten(node.props.style) ?? {};
  const values = [
    style.backgroundColor, style.color, style.borderColor,
    node.props.placeholderTextColor, node.props.selectionColor,
  ];
  return values.filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase());
}

function allColours(tree: ReactTestRenderer): string[] {
  return tree.root.findAll((n) => typeof n.type === 'string').flatMap(colourValues);
}

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(element); });
  return tree;
}

const screens: [string, () => React.ReactElement][] = [
  ['login', () => <LoginScreen />],
  ['register', () => <RegisterScreen />],
  ['welcome', () => <WelcomeScreen />],
  ['onboarding', () => <OnboardingScreen />],
  ['social birthday', () => <SocialBirthdayScreen />],
];

describe.each(screens)('%s screen', (_name, element) => {
  it('paints the dark palette when the app is dark', async () => {
    mockMode = 'dark';
    const tree = await render(element());
    const colours = allColours(tree);
    expect(colours).toContain(darkColors.bg.toLowerCase());
    expect(colours.filter((c) => LIGHT_ONLY.includes(c))).toEqual([]);
    act(() => tree.unmount());
  });

  it('keeps the light palette when the app is light', async () => {
    mockMode = 'light';
    const tree = await render(element());
    expect(allColours(tree)).toContain(lightColors.bg.toLowerCase());
    act(() => tree.unmount());
  });
});

describe('login inputs', () => {
  it('use the theme for placeholder and caret, so they stay legible on dark', async () => {
    mockMode = 'dark';
    const tree = await render(<LoginScreen />);
    for (const input of tree.root.findAllByType(TextInput)) {
      expect(input.props.placeholderTextColor).toBe(darkColors.t3);
      expect(input.props.selectionColor).toBe(darkColors.teal);
    }
    act(() => tree.unmount());
  });
});

describe('social sign-in buttons', () => {
  const circles = (tree: ReactTestRenderer) =>
    tree.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityLabel?.startsWith('Continue with'));

  it("use each provider's dark-background style in dark mode", async () => {
    mockMode = 'dark';
    const tree = await render(<SocialAuthButtons acceptedTerms />);
    const [google, apple] = circles(tree).map((n) => StyleSheet.flatten(n.props.style));
    expect(google.backgroundColor).toBe('#131314');
    expect(apple.backgroundColor).toBe('#FFFFFF');
    act(() => tree.unmount());
  });

  it("use each provider's light style in light mode", async () => {
    mockMode = 'light';
    const tree = await render(<SocialAuthButtons acceptedTerms />);
    const [google, apple] = circles(tree).map((n) => StyleSheet.flatten(n.props.style));
    expect(google.backgroundColor).toBe('#FFFFFF');
    expect(apple.backgroundColor).toBe('#000000');
    act(() => tree.unmount());
  });
});
