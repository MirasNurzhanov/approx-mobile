import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect } from 'react';
import { AppState } from 'react-native';
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

import { AuraLoader } from '@/components/AuraLoader';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthProvider } from '@/context/AuthContext';
import { ScrollNavProvider } from '@/context/ScrollNavContext';
import { AppThemeProvider, useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { registerForPushNotifications } from '@/services/notifications';
import '@/services/backgroundLocation';

function AppStatusBar() {
  const { themeMode } = useTheme();
  return <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />;
}

function AppShell() {
  const { isLoading, isAuthenticated } = useAuth();

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

  if (isLoading) {
    return <AuraLoader />;
  }

  return (
    <Stack>
      <Stack.Screen name="index"           options={{ headerShown: false }} />
      <Stack.Screen name="welcome"         options={{ headerShown: false }} />
      <Stack.Screen name="login"           options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)"          options={{ headerShown: false }} />
      <Stack.Screen name="messages/[id]"   options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="notifications"   options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="swifts/compose"  options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <Stack.Screen name="zone"            options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="profile/[id]"    options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="edit-profile"    options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="search"          options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="saved-stories"   options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="blocked-users"   options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="privacy"         options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="connections"     options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="permissions"     options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="nearby"          options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="edit-links"      options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="onboarding"      options={{ headerShown: false }} />
      <Stack.Screen name="register"        options={{ headerShown: false }} />
      <Stack.Screen name="interests-setup" options={{ headerShown: false }} />
      <Stack.Screen name="interests"       options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="clubs/[id]"      options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="clubs/[id]/chat" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="create-club"     options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <Stack.Screen name="market"          options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="modal"           options={{ presentation: 'modal', title: 'Modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error('[FATAL]', error.message, error.stack);
  });

  const [fontsLoaded] = useFonts({
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

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppThemeProvider>
        <ErrorBoundary>
          <ScrollNavProvider>
            <AuthProvider>
              <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                <AppShell />
                <AppStatusBar />
              </ThemeProvider>
            </AuthProvider>
          </ScrollNavProvider>
        </ErrorBoundary>
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}
