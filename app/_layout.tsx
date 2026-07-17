import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect } from 'react';
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
import { useAuth } from '@/context/AuthContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { registerForPushNotifications } from '@/services/notifications';
import '@/services/backgroundLocation';

function AppShell() {
  const { isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    console.log('[Push] registerPushToken called');
    console.log('[Push] isAuthenticated:', isAuthenticated);
    if (isAuthenticated) {
      registerForPushNotifications();
    }
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
      <Stack.Screen name="zone"            options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="profile/[id]"    options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="edit-profile"    options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="search"          options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="leaderboard"     options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="onboarding"      options={{ headerShown: false }} />
      <Stack.Screen name="register"        options={{ headerShown: false }} />
      <Stack.Screen name="interests-setup" options={{ headerShown: false }} />
      <Stack.Screen name="interests"       options={{ headerShown: false, animation: 'slide_from_right' }} />
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
    <ErrorBoundary>
      <ScrollNavProvider>
        <AuthProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <AppShell />
            <StatusBar style="light" />
          </ThemeProvider>
        </AuthProvider>
      </ScrollNavProvider>
    </ErrorBoundary>
  );
}
