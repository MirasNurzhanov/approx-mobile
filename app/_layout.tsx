// Direct from `@react-navigation/native`, which is correct on SDK 54.
//
// SDK 56 is where expo-router started refusing these imports and throwing at
// bundle time, and `expo-router/react-navigation` is the replacement there —
// that path does not exist in expo-router 6, so it cannot be used here. If this
// project moves forward again, this import is the first thing that breaks.
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { useFonts } from 'expo-font';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

import { ApproxLoader } from '@/components/ApproxLoader';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LocationLaunchPrompt } from '@/components/LocationLaunchPrompt';
import { TermsGate } from '@/components/TermsGate';
import { AuthProvider } from '@/context/AuthContext';
import { NavStyleProvider } from '@/context/NavStyleContext';
import { ScrollNavProvider } from '@/context/ScrollNavContext';
import { AppThemeProvider, useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { registerForPushNotifications } from '@/services/notifications';
import { refreshPrivacy } from '@/services/privacy';
import { goInvisible } from '@/services/goInvisible';
import { endStaleSharingSession } from '@/services/sharingSession';
import { refreshAcceptance, useTerms } from '@/services/terms';
import { startNotificationRouting } from '@/services/notificationRouting';
import '@/services/backgroundLocation';

function AppStatusBar() {
  const { themeMode } = useTheme();
  return <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />;
}

function AppShell() {
  const { isLoading, isAuthenticated, logout } = useAuth();

  // Whether this run has landed on an already-active session — resumed from
  // the background, or a stale-session end that failed and left sharing
  // standing (see services/sharingSession.ts). Neither case gets ended
  // automatically, by design, so this is the visible confirmation in front of
  // it: see components/LocationLaunchPrompt.
  const [launchPromptVisible, setLaunchPromptVisible] = useState(false);
  const [launchPromptBusy, setLaunchPromptBusy] = useState(false);

  // Whether this account still owes us an agreement to the current Terms.
  // `null` until the answer is in, so the gate never flashes on and off for
  // somebody who has already agreed. Accounts that signed up after the gate
  // landed answer false immediately and never see it; this exists for the
  // installs that were already signed in when it shipped.
  const { needsAcceptance } = useTerms();

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshAcceptance().catch(() => {});
  }, [isAuthenticated]);

  // Whatever this account's sharing mode was when the app last closed, it was
  // chosen by a run that no longer exists. Ending it here is what makes going
  // visible a per-launch decision rather than a setting that quietly persists.
  // See services/sharingSession.ts for why it presents a token instead of
  // simply pausing — startup races the user's own tap.
  //
  // Gated on being signed in, like the push effect below: there is nobody to
  // pause otherwise. Runs once per process, and only in the foreground.
  useEffect(() => {
    if (!isAuthenticated) return;
    // Re-read afterwards, not before: a screen that mounted first may already
    // have pulled a sharing mode that this call has just ended, and the store
    // would otherwise keep showing the user as visible when they are not.
    endStaleSharingSession()
      .then(() => refreshPrivacy())
      .then((settings) => {
        if (settings && settings.location_sharing !== 'paused') {
          setLaunchPromptVisible(true);
        }
      })
      .catch(() => {});
  }, [isAuthenticated]);

  async function handleGoInvisible() {
    setLaunchPromptBusy(true);
    try {
      await goInvisible();
      setLaunchPromptVisible(false);
    } catch {
      Alert.alert('Could not update', 'Please try again from Privacy & safety.');
    } finally {
      setLaunchPromptBusy(false);
    }
  }

  useEffect(() => {
    console.log('[Push] isAuthenticated:', isAuthenticated);
    if (!isAuthenticated) return;

    console.log('[Push] registering token on app open...');
    registerForPushNotifications().catch(e => console.log('[Push] unhandled:', e?.message ?? e));

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        console.log('[Push] registering token on app open...');
        registerForPushNotifications().catch(e => console.log('[Push] unhandled:', e?.message ?? e));
      }
    });

    return () => sub.remove();
  }, [isAuthenticated]);

  // Tapping a notification opens what it is about. Gated on being signed in
  // for the same reason registration is: every destination is behind auth, and
  // pushing /messages/12 at the login screen would land on a screen that
  // immediately bounces. A tap that arrives while signed out is dropped rather
  // than queued — by the time anyone signs in, it is no longer what they came
  // to the app for.
  useEffect(() => {
    if (!isAuthenticated) return;
    return startNotificationRouting();
  }, [isAuthenticated]);

  if (isLoading) {
    return <ApproxLoader />;
  }

  return (
    <>
      <Stack>
        <Stack.Screen name="index"           options={{ headerShown: false }} />
        <Stack.Screen name="welcome"         options={{ headerShown: false }} />
        <Stack.Screen name="login"           options={{ headerShown: false }} />
        {/* `gestureEnabled: false` for the same reason `social-birthday` below
            sets it: `welcome` pushes `/login`, and signing in *replaces* only
            the login screen, so `welcome` is still underneath the tab group.
            The iOS back-swipe was therefore popping a signed-in user out of the
            app and onto the sign-up screen they are already past. Swiping right
            from the tabs opens the composer instead — see `compose` below and
            the edge strip in `(tabs)/map`. */}
        <Stack.Screen name="(tabs)"          options={{ headerShown: false, gestureEnabled: false }} />
        {/* Slides in from the left because that is the direction the swipe that
            opens it travels — the sheet follows the finger rather than arriving
            from the opposite edge.
            The back gesture is off, and its absence is deliberate. Coming from
            the left, the gesture that should dismiss this travels *left*, and
            react-native-screens on SDK 54 only offers `gestureDirection`
            'horizontal' | 'vertical' — no inverted variant — so the one it would
            give us drags the screen further the way it came. A gesture that
            works backwards is worse than none; the close button is the
            affordance, and it sits under the thumb at the top of the screen. */}
        <Stack.Screen
          name="compose"
          options={{
            headerShown: false,
            animation: 'slide_from_left',
            gestureEnabled: false,
          }}
        />
        <Stack.Screen name="messages/[id]"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="notifications"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="swifts/compose"  options={{ headerShown: false, animation: 'slide_from_bottom' }} />
        <Stack.Screen name="swifts/[id]"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="zone"            options={{ headerShown: false, animation: 'slide_from_right' }} />
        {/* Both draw their own header; without an entry here the navigator adds
            a second, native one above it. */}
        <Stack.Screen name="zone-area"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="zone-apple-music" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="zone-trim"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="profile/[id]"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="edit-profile"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="search"          options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="starred-stories" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="blocked-users"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="privacy"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="connections"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="permissions"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="notification-settings" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="nearby"          options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="edit-links"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="onboarding"      options={{ headerShown: false }} />
        <Stack.Screen name="register"        options={{ headerShown: false }} />
        {/* Google/Apple sign-ups land here for the one thing neither provider
            shares. `gestureEnabled: false` because it is the age gate — swiping
            back out of it would land on a login screen the user is already past. */}
        <Stack.Screen name="social-birthday" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="interests-setup"         options={{ headerShown: false }} />
        <Stack.Screen name="onboarding-profession"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="onboarding-nationality"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="interests"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="clubs/[id]"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="clubs/[id]/chat" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="create-club"     options={{ headerShown: false, animation: 'slide_from_bottom' }} />
        <Stack.Screen name="market"          options={{ headerShown: false, animation: 'slide_from_right' }} />
      </Stack>
      <LocationLaunchPrompt
        visible={launchPromptVisible}
        busy={launchPromptBusy}
        onStayActive={() => setLaunchPromptVisible(false)}
        onGoInvisible={handleGoInvisible}
      />
      {/* Last in the tree so it covers everything, including the location
          prompt above — an account that has not agreed to the Terms should not
          be answering a question about its own visibility first. */}
      <TermsGate
        visible={isAuthenticated && needsAcceptance === true}
        onAccepted={() => refreshAcceptance().catch(() => {})}
        onSignOut={logout}
      />
    </>
  );
}

// Installed once, at module scope, and chained rather than replaced.
//
// This used to sit in RootLayout's render body, which meant re-registering it
// on every render — and, far worse, it replaced React Native's own handler
// without ever calling it. A genuinely fatal error was written to the console
// and then swallowed: no red box in development, no crash report in production,
// nothing for the next person to work from. A crash reported as "it just closes
// with no message" is exactly what that looks like from the outside.
//
// `getGlobalHandler` is guarded because it is not part of the documented
// surface; if it is ever missing, chaining is skipped rather than throwing here
// and taking the launch down with it.
const previousErrorHandler = ErrorUtils.getGlobalHandler?.();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  console.error('[FATAL]', isFatal ? '(fatal)' : '(non-fatal)', error?.message, error?.stack);
  previousErrorHandler?.(error, isFatal);
});

export default function RootLayout() {
  // `fontError` is read, not ignored. `useFonts` reports a failure by setting
  // it and leaving `loaded` false forever — so a bare `if (!loaded) return null`
  // renders a permanently blank screen when a font fails to load, with the
  // splash already dismissed behind it. From the user's side that is
  // indistinguishable from the app failing to start, and because a font load
  // can fail intermittently it is the kind of fault that clears on the next try.
  //
  // A missing font is a cosmetic problem; a blank screen is not. Render either
  // way and let the system fall back.
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk: SpaceGrotesk_400Regular,
    'SpaceGrotesk-Medium': SpaceGrotesk_500Medium,
    'SpaceGrotesk-SemiBold': SpaceGrotesk_600SemiBold,
    'SpaceGrotesk-Bold': SpaceGrotesk_700Bold,
    Inter: Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold': Inter_700Bold,
  });

  const colorScheme = useColorScheme();

  useEffect(() => {
    if (fontError) console.warn('[Fonts] failed to load, falling back:', fontError.message);
  }, [fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppThemeProvider>
        <ErrorBoundary>
          <ScrollNavProvider>
            <NavStyleProvider>
              <AuthProvider>
                <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                  <AppShell />
                  <AppStatusBar />
                </ThemeProvider>
              </AuthProvider>
            </NavStyleProvider>
          </ScrollNavProvider>
        </ErrorBoundary>
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}
