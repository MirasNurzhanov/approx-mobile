import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { hasSeenOnboarding } from '@/services/onboarding';

// Where the app opens. Three destinations, and the distinction between the last
// two is the one that matters: the intro carousel is a *first run*, not a
// signed-out state. Sending everyone signed-out through it means somebody who
// signs out — or whose session simply expires overnight — has to swipe an
// introduction to the app they already use before they can reach the login
// button. `onboarding_seen` is per device rather than per account, and signing
// out deliberately leaves it in place (see services/signOut).
//
// This decision is made exactly once per mount, not on every `isAuthenticated`
// change. This screen stays alive in the stack after its own `replace()` —
// which is *why* it originally re-ran on every later flip of the flag — and an
// unconditional "authenticated → map" here raced any other screen's own
// post-auth routing. AuthContext.completeSocialSignIn needs a fresh social
// sign-up to land on /social-birthday or /interests-setup instead of the map;
// that call was landing correctly and then getting silently overwritten a
// beat later by this effect, because effects run after the synchronous
// `router.replace` that set it up. Every other path (password login,
// register) happened to want /(tabs)/map too, which is the only reason this
// was never visible before social sign-in existed.
export default function Index() {
  const { isAuthenticated, isLoading } = useAuth();
  const { colors } = useTheme();
  const decided = useRef(false);

  useEffect(() => {
    // The real answer isn't in yet — acting on the default `false` here would
    // send a genuinely signed-in user to the carousel for a flash before the
    // second, correct pass fixed it. Waiting costs nothing: ApproxLoader is
    // already covering the screen for this same stretch.
    if (isLoading || decided.current) return;
    decided.current = true;

    let cancelled = false;

    (async () => {
      if (isAuthenticated) {
        router.replace('/(tabs)/map');
        return;
      }
      const seen = await hasSeenOnboarding();
      if (cancelled) return;
      // A storage read that fails falls through to the carousel, which is the
      // harmless direction to be wrong in: it is skippable in three taps and
      // ends at the same place.
      router.replace(seen ? '/welcome' : '/onboarding');
    })();

    return () => { cancelled = true; };
  }, [isAuthenticated, isLoading]);

  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
