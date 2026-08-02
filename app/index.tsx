import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { useAuth } from '@/context/AuthContext';

export default function Index() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    router.replace(isAuthenticated ? '/(tabs)/map' : '/onboarding');
  }, [isAuthenticated]);

  return <View style={{ flex: 1, backgroundColor: '#faf9f5' }} />;
}
