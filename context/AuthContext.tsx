import { router } from 'expo-router';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { setOnAuthFailure } from '@/services/api';
import { getAccessToken, loginRequest } from '@/services/auth';
import { flushPendingRevocations, performSignOut } from '@/services/signOut';

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Tears the session down without asking. Used by flows that have already
   * confirmed — account deletion — and by `confirmLogout`. */
  logout: () => Promise<void>;
  /** Asks first, then signs out. What the Sign out buttons call. */
  confirmLogout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // When the api layer gives up on a session (refresh failed), it redirects
    // to '/' — this keeps isAuthenticated in sync so index doesn't bounce the
    // user straight back into the tabs.
    setOnAuthFailure(() => setIsAuthenticated(false));

    // A sign-out that could not reach the server left its refresh token valid.
    // Retry it now that we may have a network again.
    flushPendingRevocations().catch(() => {});

    Promise.all([
      getAccessToken(),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]).then(([token]) => {
      setIsAuthenticated(!!token);
      setIsLoading(false);
    });
  }, []);

  async function login(email: string, password: string) {
    await loginRequest(email, password);
    setIsAuthenticated(true);
    router.replace('/(tabs)/map');
  }

  async function logout() {
    // Revokes the refresh token server-side, unregisters push, stops the
    // background location task and clears account-scoped caches. Never throws:
    // signing out has to succeed locally even with no network.
    await performSignOut();
    setIsAuthenticated(false);
    setIsLoading(false);
    // dismissAll() first so any modal or pushed screen is gone, then replace
    // rather than navigate — the auth screen becomes the only entry on the
    // stack, so Back cannot return to an authenticated screen.
    router.dismissAll();
    router.replace('/');
  }

  function confirmLogout() {
    Alert.alert(
      'Sign out?',
      "You'll need to sign in again to see your map, chats and quests.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => { logout(); } },
      ],
    );
  }

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, isLoading, login, logout, confirmLogout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
