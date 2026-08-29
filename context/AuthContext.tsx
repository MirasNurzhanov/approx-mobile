import { router } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { setOnAuthFailure } from '@/services/api';
import { getAccessToken, loginRequest } from '@/services/auth';
import { markOnboardingSeen } from '@/services/onboarding';
import { flushPendingRevocations, performSignOut } from '@/services/signOut';
import type { SocialSignInResult } from '@/services/socialAuth';

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  /** `acceptTerms` is the sign-in screen's agreement checkbox. The server
   *  refuses to issue tokens without it for an account that has not already
   *  agreed to the current Terms, so this is not advisory. */
  login: (email: string, password: string, acceptTerms?: boolean) => Promise<void>;
  /** Finishes a Google/Apple sign-in whose tokens are already stored.
   *
   * Separate from `login` because the credential work happened in
   * services/socialAuth — by the time this is called the session exists, and
   * all that is left is flipping the flag and picking where to land. */
  completeSocialSignIn: (result: SocialSignInResult) => void;
  /** Tears the session down without asking. Used by flows that have already
   * confirmed — account deletion — and by `confirmLogout`. */
  logout: () => Promise<void>;
  /** Asks first, then signs out. What the Sign out buttons call. */
  confirmLogout: () => void;
  /** Teardown is in flight. Sign out revokes the refresh token over the
   * network, which can take up to four seconds on a bad connection — without
   * this the button looks like it did nothing. */
  isSigningOut: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  // A ref, not the state, does the actual gatekeeping: two taps landing in the
  // same tick would both read the pre-render `false`.
  const signingOut = useRef(false);

  useEffect(() => {
    // When the api layer gives up on a session (refresh failed), it redirects
    // to '/' — this keeps isAuthenticated in sync so index doesn't bounce the
    // user straight back into the tabs.
    //
    // Routed through logout() rather than just flipping the flag: an expired
    // session is still a session that ended, and the rest of the teardown —
    // stopping the background location task, dropping account-scoped caches —
    // has to happen whether the user chose it or not. The api layer has
    // already cleared the tokens by this point, so this makes no network call.
    setOnAuthFailure(() => { logout(); });

    // A sign-out that could not reach the server left its refresh token valid.
    // Retry it now that we may have a network again.
    flushPendingRevocations().catch(() => {});

    Promise.all([
      getAccessToken(),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]).then(([token]) => {
      // A device with an account signed in on it has plainly been introduced
      // to the app, whether or not anyone ever pressed through the carousel —
      // which nothing recorded until now. Without this, every existing install
      // would meet the intro once more the first time it signed out.
      if (token) markOnboardingSeen();
      setIsAuthenticated(!!token);
      setIsLoading(false);
    });
  }, []);

  async function login(email: string, password: string, acceptTerms = false) {
    await loginRequest(email, password, acceptTerms);
    markOnboardingSeen();
    setIsAuthenticated(true);
    router.replace('/(tabs)/map');
  }

  function completeSocialSignIn({ created, needsDateOfBirth }: SocialSignInResult) {
    markOnboardingSeen();
    setIsAuthenticated(true);
    // Order matters, and it is not "new users here, old users there". A date of
    // birth is the age gate, so it comes before anything else the app would
    // show — including for the returning account whose first attempt was
    // interrupted before they answered. The birthday screen sends them on to
    // interests itself.
    if (needsDateOfBirth) {
      router.replace('/social-birthday');
    } else if (created) {
      router.replace('/interests-setup');
    } else {
      router.replace('/(tabs)/map');
    }
  }

  async function logout() {
    // Re-entrancy guard. The alert dismisses on press and the button stays
    // tappable for as long as revocation takes, so a second tap is easy — and
    // a second performSignOut() racing the first would try to revoke a refresh
    // token the first one has already deleted, queueing a bogus retry.
    if (signingOut.current) return;
    signingOut.current = true;
    setIsSigningOut(true);

    // Flipped *before* teardown rather than after it. `app/index.tsx` replaces
    // an authenticated user straight back into the tabs, so anything that
    // routes to '/' while this still reads true — the api layer's forced
    // logout, for one — gets bounced onto the map again.
    setIsAuthenticated(false);
    setIsLoading(false);

    try {
      // Revokes the refresh token server-side, unregisters push, stops the
      // background location task and clears account-scoped caches. Never
      // throws: signing out has to succeed locally even with no network.
      await performSignOut();
    } finally {
      // In the finally, so a teardown that somehow threw still lands on the
      // auth screen: by this point the api client is latched shut, and leaving
      // the user inside the tabs with a dead session is the worse failure.
      //
      // dismissAll() first so any modal or pushed screen is gone, then replace
      // rather than navigate — the auth screen becomes the only entry on the
      // stack, so Back cannot return to an authenticated screen.
      //
      // Guarded, because dismissAll() dispatches POP_TO_TOP unconditionally and
      // signing out from a tab is the common case: the root stack holds only
      // `(tabs)` then, nothing pops, and the action falls through to the tab
      // navigator — which cannot handle it either — for a red "action
      // 'POP_TO_TOP' was not handled by any navigator" on every sign out.
      if (router.canDismiss()) router.dismissAll();
      // Straight to the screen with Log in and Create account on it, rather
      // than to '/' — which routes a signed-out user through the intro
      // carousel. Somebody who just signed out has used the app; making them
      // swipe an introduction to reach the login button reads as the sign-out
      // having gone nowhere.
      router.replace('/welcome');
      // Released so the buttons never strand the user on a permanently
      // spinning Sign out.
      signingOut.current = false;
      setIsSigningOut(false);
    }
  }

  function confirmLogout() {
    if (signingOut.current) return;
    Alert.alert(
      'Sign out?',
      "You'll need to sign in again to see your map and chats.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => { logout(); } },
      ],
    );
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated, isLoading, login, completeSocialSignIn,
        logout, confirmLogout, isSigningOut,
      }}
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
