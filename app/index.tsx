import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuraMark } from '@/components/ui/AuraMark';
import { Button } from '@/components/ui/Button';
import { colors, fonts } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';

export default function Index() {
  const { isAuthenticated } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/(tabs)/map');
      return;
    }
    setReady(true);
  }, [isAuthenticated]);

  async function handleCreateAccount() {
    const seen = await AsyncStorage.getItem('onboarding_seen');
    router.push(seen === 'true' ? '/register' : '/onboarding');
  }

  if (!ready) return <View style={styles.root} />;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.hero}>
        <AuraMark size={32} />
        <Text style={styles.wordmark}>AURA</Text>
        <Text style={styles.tagline}>Find your people nearby</Text>
      </View>

      <View style={styles.buttons}>
        <Button
          label="Log in"
          variant="primary"
          size="lg"
          fullWidth
          onPress={() => router.push('/login')}
        />
        <Button
          label="Create account"
          variant="ghost"
          size="lg"
          fullWidth
          onPress={handleCreateAccount}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 32,
  },
  wordmark: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 30,
    color: colors.t1,
    letterSpacing: 30 * 0.34,
    // Mirrors the design's text-indent: recenters the trailing letter-space.
    paddingLeft: 30 * 0.34,
  },
  tagline: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.t2,
    textAlign: 'center',
  },
  buttons: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 12,
  },
});
