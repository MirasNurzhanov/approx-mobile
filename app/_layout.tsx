import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect } from 'react';

import { AuraLoader } from '@/components/AuraLoader';
import { AuthProvider } from '@/context/AuthContext';
import { ScrollNavProvider } from '@/context/ScrollNavContext';
import { useAuth } from '@/context/AuthContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { registerForPushNotifications } from '@/services/notifications';

function AppShell() {
  const { isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
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
  const colorScheme = useColorScheme();

  return (
    <ScrollNavProvider>
      <AuthProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AppShell />
          <StatusBar style="light" />
        </ThemeProvider>
      </AuthProvider>
    </ScrollNavProvider>
  );
}
