import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { hasSeenOnboarding } from '@/services/onboarding';

// Where the app opens. Three destinations, and the distinction between the last
// two is the one that matters: the intro carousel is a *first run*, not a
// signed-out state. Sending everyone signed-out through it means somebody who
// signs out — or whose session simply expires overnight — has to swipe an
// introduction to the app they already use before they can reach the login
// button. `onboarding_seen` is per device rather than per account, and signing
// out deliberately leaves it in place (see services/signOut).
export default function Index() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
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
  }, [isAuthenticated]);

  return <View style={{ flex: 1, backgroundColor: '#faf9f5' }} />;
}
