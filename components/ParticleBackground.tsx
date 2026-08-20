import { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

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
  const progress = useSharedValue(cfg.phase);

  useEffect(() => {
    // Starting from `cfg.phase` rather than 0 staggers the particles so they
    // don't all begin their cycle in visual sync.
    progress.set(
      withRepeat(
        withTiming(1, {
          duration: cfg.duration * (1 - cfg.phase),
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
      ),
    );
    // `cfg` is fixed for the life of a Particle: it comes from a module-level
    // array and this component never receives a different one.
  }, [progress, cfg.duration, cfg.phase]);

  const style = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: interpolate(p, [0, 0.1, 0.8, 1], [0, cfg.maxOpacity, cfg.maxOpacity * 0.6, 0]),
      transform: [
        { translateX: interpolate(p, [0, 1], [0, cfg.dx]) },
        { translateY: interpolate(p, [0, 1], [0, cfg.dy]) },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: cfg.x,
          top: cfg.y,
          width: cfg.size,
          height: cfg.size,
          borderRadius: cfg.size / 2,
          backgroundColor: '#00b4a6',
        },
        style,
      ]}
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
