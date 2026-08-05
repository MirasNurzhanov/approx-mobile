import { useEffect, useState } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';

const { width, height } = Dimensions.get('window');

const COUNT = 25;

type Config = {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  dx: number;
  dy: number;
  maxOpacity: number;
  phase: number;
};

// Pre-computed once so positions are stable across re-renders
const CONFIGS: Config[] = Array.from({ length: COUNT }, (_, i) => {
  const angle = Math.random() * Math.PI * 2;
  const travel = 40 + Math.random() * 70;
  return {
    id: i,
    x: Math.random() * width,
    y: Math.random() * height,
    size: 2 + Math.random() * 4,
    duration: 9000 + Math.random() * 14000,
    dx: Math.cos(angle) * travel,
    dy: Math.sin(angle) * travel,
    maxOpacity: 0.3 + Math.random() * 0.2,
    phase: Math.random(),
  };
});

function Particle({ cfg }: { cfg: Config }) {
  const [progress] = useState(() => new Animated.Value(cfg.phase));

  useEffect(() => {
    Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: cfg.duration * (1 - cfg.phase),
        useNativeDriver: true,
      })
    ).start(() => {
      // After the first (possibly partial) cycle, reset and loop normally
      progress.setValue(0);
      Animated.loop(
        Animated.timing(progress, {
          toValue: 1,
          duration: cfg.duration,
          useNativeDriver: true,
        })
      ).start();
    });
    // All three are fixed for the life of a Particle: `progress` is built once
    // in the initialiser, and `cfg` comes from a module-level array.
  }, [progress, cfg.duration, cfg.phase]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, cfg.dx] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, cfg.dy] });
  const opacity    = progress.interpolate({
    inputRange: [0, 0.1, 0.8, 1],
    outputRange: [0, cfg.maxOpacity, cfg.maxOpacity * 0.6, 0],
  });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: cfg.x,
        top: cfg.y,
        width: cfg.size,
        height: cfg.size,
        borderRadius: cfg.size / 2,
        backgroundColor: '#00b4a6',
        opacity,
        transform: [{ translateX }, { translateY }],
      }}
    />
  );
}

export function ParticleBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {CONFIGS.map((cfg) => (
        <Particle key={cfg.id} cfg={cfg} />
      ))}
    </View>
  );
}
