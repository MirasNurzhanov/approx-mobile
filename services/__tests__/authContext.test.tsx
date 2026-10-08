// AuthProvider: a context value that only changes when what it carries does, and
// a bootstrap that answers as soon as the stored token has been read.
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';

import { AuthProvider, useAuth } from '../../context/AuthContext';
import { setOnAuthFailure } from '../api';
import { getAccessToken, loginRequest } from '../auth';
import { markOnboardingSeen } from '../onboarding';
import { performSignOut } from '../signOut';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), canDismiss: jest.fn(() => false), dismissAll: jest.fn() },
}));
jest.mock('../api', () => ({ setOnAuthFailure: jest.fn() }));
jest.mock('../auth', () => ({ getAccessToken: jest.fn(), loginRequest: jest.fn(() => Promise.resolve()) }));
jest.mock('../onboarding', () => ({ markOnboardingSeen: jest.fn() }));
jest.mock('../signOut', () => ({
  flushPendingRevocations: jest.fn(() => Promise.resolve()),
  performSignOut: jest.fn(() => Promise.resolve()),
}));

type Auth = ReturnType<typeof useAuth>;
const seen: Auth[] = [];
function Probe() {
  seen.push(useAuth());
  return null;
}
// A parent that re-renders the provider without changing anything it holds.
function Root({ generation }: { generation: number }) {
  return <AuthProvider><Probe key="probe" data-generation={generation} /></AuthProvider>;
}
const current = () => seen[seen.length - 1];

let tree: ReactTestRenderer | undefined;
async function mount() {
  await act(async () => { tree = create(<Root generation={0} />); });
}

beforeEach(() => {
  seen.length = 0;
  jest.clearAllMocks();
  (getAccessToken as jest.Mock).mockResolvedValue('stored-access-token');
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  jest.useRealTimers();
});

describe('bootstrap', () => {
  it('leaves loading safely when secure storage cannot be read', async () => {
    (getAccessToken as jest.Mock).mockRejectedValue(new Error('storage unavailable'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount();
    expect(current().isLoading).toBe(false);
    expect(current().isAuthenticated).toBe(false);
    expect(alert).toHaveBeenCalledWith('Secure storage unavailable', expect.any(String));
    alert.mockRestore();
  });

  it('stops loading as soon as the token read answers, with no fixed wait', async () => {
    jest.useFakeTimers();
    let answer!: (token: string | null) => void;
    (getAccessToken as jest.Mock).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    await act(async () => { tree = create(<Root generation={0} />); });
    expect(current().isLoading).toBe(true);

    await act(async () => { answer('stored-access-token'); });
    // Timers are fake and never advanced: the token read alone ends loading. A
    // bootstrap that still waited on a fixed delay would be loading here.
    expect(current().isLoading).toBe(false);
    expect(current().isAuthenticated).toBe(true);
    expect(markOnboardingSeen).toHaveBeenCalledTimes(1);
  });

  it('opens signed out when no token is stored', async () => {
    (getAccessToken as jest.Mock).mockResolvedValue(null);
    await mount();
    expect(current().isLoading).toBe(false);
    expect(current().isAuthenticated).toBe(false);
    expect(markOnboardingSeen).not.toHaveBeenCalled();
  });
});

describe('context value', () => {
  it('is the same object across re-renders that change nothing it carries', async () => {
    await mount();
    const before = current();
    await act(async () => { tree!.update(<Root generation={1} />); });
    await act(async () => { tree!.update(<Root generation={2} />); });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(current()).toBe(before);
  });

  it('keeps every function identical when the flags change', async () => {
    (getAccessToken as jest.Mock).mockResolvedValue(null);
    await mount();
    const signedOut = current();
    await act(async () => { await signedOut.login('a@example.test', 'pw', true); });
    const signedIn = current();

    expect(signedIn).not.toBe(signedOut);
    expect(signedIn.isAuthenticated).toBe(true);
    expect(signedIn.login).toBe(signedOut.login);
    expect(signedIn.logout).toBe(signedOut.logout);
    expect(signedIn.confirmLogout).toBe(signedOut.confirmLogout);
    expect(signedIn.completeSocialSignIn).toBe(signedOut.completeSocialSignIn);
  });
});

describe('session changes', () => {
  it('signs in with the agreement flag and lands on the map', async () => {
    (getAccessToken as jest.Mock).mockResolvedValue(null);
    await mount();
    await act(async () => { await current().login('a@example.test', 'pw', true); });
    expect(loginRequest).toHaveBeenCalledWith('a@example.test', 'pw', true);
    expect(markOnboardingSeen).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/map');
  });

  it('routes a forced logout from the api layer through the full teardown', async () => {
    await mount();
    expect(current().isAuthenticated).toBe(true);
    const onFailure = (setOnAuthFailure as jest.Mock).mock.calls[0][0] as () => void;
    await act(async () => { onFailure(); });
    expect(performSignOut).toHaveBeenCalledTimes(1);
    expect(current().isAuthenticated).toBe(false);
    expect(current().isSigningOut).toBe(false);
    expect(router.replace).toHaveBeenCalledWith('/welcome');
  });

  it('asks before signing out, and signs out once however often it is confirmed', async () => {
    await mount();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    act(() => { current().confirmLogout(); });
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const signOut = buttons.find((button) => button.text === 'Sign out')!;
    await act(async () => { signOut.onPress!(); signOut.onPress!(); });
    expect(performSignOut).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });
});
