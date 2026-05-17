import { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

const { width, height } = Dimensions.get('window');

type ParticleConfig = {
  id: number;
  startX: number;
  startY: number;
  size: number;
  duration: number;
  dy: number;
  dx: number;
  maxOpacity: number;
  initialProgress: number;
};

// Pre-compute once so positions never change between renders
const PARTICLES: ParticleConfig[] = Array.from({ length: 32 }, (_, i) => ({
  id: i,
  startX: Math.random() * width,
  startY: Math.random() * height,
  size: 1.5 + Math.random() * 2.5,
  duration: 9000 + Math.random() * 13000,
  dy: -(45 + Math.random() * 75),
  dx: (Math.random() - 0.5) * 55,
  maxOpacity: 0.12 + Math.random() * 0.28,
  initialProgress: Math.random(), // stagger so they don't all start at once
}));

function Particle({ config }: { config: ParticleConfig }) {
  const progress = useRef(new Animated.Value(config.initialProgress)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: config.duration, useNativeDriver: true })
    ).start();
  }, []);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, config.dy] });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, config.dx] });
  const opacity = progress.interpolate({
    inputRange: [0, 0.08, 0.75, 1],
    outputRange: [0, config.maxOpacity, config.maxOpacity * 0.5, 0],
  });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: config.startX,
        top: config.startY,
        width: config.size,
        height: config.size,
        borderRadius: config.size / 2,
        backgroundColor: '#00b4a6',
        opacity,
        transform: [{ translateX }, { translateY }],
      }}
    />
  );
}

export default function WelcomeScreen() {
  const glowPulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, { toValue: 1, duration: 2800, useNativeDriver: true }),
        Animated.timing(glowPulse, { toValue: 0.45, duration: 2800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.root}>
      {/* Particle layer */}
      {PARTICLES.map((p) => (
        <Particle key={p.id} config={p} />
      ))}

      {/* Content */}
      <View style={styles.content}>
        {/* Logo */}
        <View style={styles.logoWrap}>
          <Animated.View style={[styles.glow, { opacity: glowPulse }]} />
          <Text style={styles.logo}>AURA</Text>
          <Text style={styles.tagline}>Find your people nearby</Text>
        </View>

        {/* Buttons */}
        <View style={styles.buttons}>
          <TouchableOpacity style={styles.loginBtn} onPress={() => router.push('/login')} activeOpacity={0.85}>
            <Text style={styles.loginText}>Login</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.registerBtn} onPress={() => router.push('/register')} activeOpacity={0.85}>
            <Text style={styles.registerText}>Register</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  // ── Logo ──
  logoWrap: {
    alignItems: 'center',
    marginBottom: 72,
  },
  glow: {
    position: 'absolute',
    width: 280,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#00b4a606',
    shadowColor: '#00b4a6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 45,
    elevation: 0,
  },
  logo: {
    fontSize: 72,
    color: '#00b4a6',
    fontWeight: '800',
    letterSpacing: 18,
    textShadowColor: '#00b4a6',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
    marginBottom: 14,
  },
  tagline: {
    color: '#4a4a4a',
    fontSize: 14,
    letterSpacing: 1.8,
  },

  // ── Buttons ──
  buttons: {
    width: '100%',
    gap: 14,
  },
  loginBtn: {
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
  loginText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  registerBtn: {
    width: '100%',
    paddingVertical: 17,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00b4a6',
  },
  registerText: {
    color: '#00b4a6',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
