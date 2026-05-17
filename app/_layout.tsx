import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { AuthProvider } from '@/context/AuthContext';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="messages/[id]" options={{ headerShown: false, animation: 'slide_from_right' }} />
          <Stack.Screen name="zone" options={{ headerShown: false, animation: 'slide_from_right' }} />
          <Stack.Screen name="profile/[id]" options={{ headerShown: false, animation: 'slide_from_right' }} />
          <Stack.Screen name="edit-profile" options={{ headerShown: false, animation: 'slide_from_right' }} />
          <Stack.Screen name="register" options={{ headerShown: false }} />
          <Stack.Screen name="interests-setup" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="light" />
      </ThemeProvider>
    </AuthProvider>
  );
}
