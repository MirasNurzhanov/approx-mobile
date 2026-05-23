import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { ParticleBackground } from '@/components/ParticleBackground';
import { useAuth } from '@/context/AuthContext';

export default function Index() {
  const { isAuthenticated } = useAuth();
  const [ready, setReady] = useState(false);
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/(tabs)/map');
      return;
    }
    setReady(true);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!ready) return;
    Animated.timing(fadeIn, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [ready]);

  async function handleGetStarted() {
    const seen = await AsyncStorage.getItem('onboarding_seen');
    router.push(seen === 'true' ? '/welcome' : '/onboarding');
  }

  if (!ready) return <View style={styles.root} />;

  return (
    <View style={styles.root}>
      <ParticleBackground />

      <Animated.View style={[styles.content, { opacity: fadeIn }]}>
        <View style={styles.logoWrap}>
          <Image source={require('../assets/images/icon.png')} style={styles.logoImage} />
          <Text style={styles.logo}>AURA</Text>
          <Text style={styles.tagline}>Find your people nearby</Text>
        </View>

        <TouchableOpacity style={styles.btn} activeOpacity={0.85} onPress={handleGetStarted}>
          <Text style={styles.btnText}>Get Started</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  logoWrap: { alignItems: 'center', marginBottom: 80 },
  logoImage: {
    width: 160,
    height: 160,
    borderRadius: 36,
    marginBottom: 28,
  },
  logo: {
    fontSize: 46,
    color: '#00b4a6',
    fontWeight: '800',
    letterSpacing: 14,
    paddingLeft: 14,
    textAlign: 'center',
    width: '100%',
    textShadowColor: '#00b4a6',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
    marginBottom: 14,
  },
  tagline: { color: '#4a4a4a', fontSize: 14, letterSpacing: 1.8 },

  btn: {
    width: '100%',
    backgroundColor: '#00b4a6',
    paddingVertical: 17,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#00b4a6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
});
