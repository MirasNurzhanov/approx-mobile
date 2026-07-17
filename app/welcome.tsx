import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { colors, fonts } from '@/constants/theme';

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.wordmark}>AURA</Text>
          <Text style={styles.tagline}>Find your people nearby</Text>
        </View>

        <View style={styles.buttons}>
          <Button
            label="Get Started"
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => router.push('/onboarding')}
          />
          <Button
            label="Sign In"
            variant="ghost"
            size="lg"
            fullWidth
            onPress={() => router.push('/login')}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
    paddingTop: 80,
    paddingBottom: 32,
  },
  hero: {
    alignItems: 'center',
    gap: 12,
  },
  wordmark: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 52,
    color: colors.teal,
    letterSpacing: 52 * 0.34,
  },
  tagline: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.t2,
  },
  buttons: {
    gap: 12,
  },
});
