import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';

const TEAL        = '#00b4a6';
const PURPLE      = '#8b5cf6';
const N_PARTICLES = 12;
const DISTANCE    = 88;
const CORE_R      = 12;   // → diameter 24
const PARTICLE_R  = 5;    // → diameter 10
const RING_BASE   = 56;   // base diameter for rings

export function AuraLoader() {
  const coreScale    = useRef(new Animated.Value(1)).current;

  const particleAnims = useRef(
    Array.from({ length: N_PARTICLES }, () => new Animated.Value(0)),
  ).current;

  const ringAnims = useRef(
    Array.from({ length: 3 }, () => ({
      scale:   new Animated.Value(1),
      opacity: new Animated.Value(0.55),
    })),
  ).current;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    // ── Core pulse ────────────────────────────────────────────────────────────
    const coreLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(coreScale, {
          toValue:         1.35,
          duration:        900,
          easing:          Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(coreScale, {
          toValue:         1,
          duration:        900,
          easing:          Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    coreLoop.start();

    // ── Particles — staggered shoot-out and return ────────────────────────────
    particleAnims.forEach((anim, i) => {
      const t = setTimeout(() => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue:         1,
              duration:        650,
              easing:          Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue:         0,
              duration:        650,
              easing:          Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ).start();
      }, (i / N_PARTICLES) * 1300);
      timers.push(t);
    });

    // ── Wave rings — staggered expand + fade ──────────────────────────────────
    ringAnims.forEach(({ scale, opacity }, i) => {
      const t = setTimeout(() => {
        Animated.loop(
          Animated.sequence([
            Animated.parallel([
              Animated.timing(scale, {
                toValue:         3.4,
                duration:        1700,
                easing:          Easing.out(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.timing(opacity, {
                toValue:         0,
                duration:        1700,
                easing:          Easing.out(Easing.quad),
                useNativeDriver: true,
              }),
            ]),
            // Reset instantly before next loop
            Animated.parallel([
              Animated.timing(scale,   { toValue: 1,    duration: 0, useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0.55, duration: 0, useNativeDriver: true }),
            ]),
          ]),
        ).start();
      }, (i / 3) * 1700);
      timers.push(t);
    });

    return () => {
      timers.forEach(clearTimeout);
      coreLoop.stop();
      coreScale.stopAnimation();
      particleAnims.forEach((a) => a.stopAnimation());
      ringAnims.forEach(({ scale, opacity }) => {
        scale.stopAnimation();
        opacity.stopAnimation();
      });
    };
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        {/* Wave rings */}
        {ringAnims.map(({ scale, opacity }, i) => (
          <Animated.View
            key={i}
            style={[
              styles.ring,
              {
                opacity,
                borderColor: i === 1 ? PURPLE : TEAL,
                transform: [{ scale }],
              },
            ]}
          />
        ))}

        {/* Particles */}
        {particleAnims.map((anim, i) => {
          const angle = (2 * Math.PI * i) / N_PARTICLES;
          const tx = anim.interpolate({
            inputRange:  [0, 1],
            outputRange: [0, DISTANCE * Math.cos(angle)],
          });
          const ty = anim.interpolate({
            inputRange:  [0, 1],
            outputRange: [0, DISTANCE * Math.sin(angle)],
          });
          return (
            <Animated.View
              key={i}
              style={[
                styles.particle,
                {
                  backgroundColor: i % 2 === 0 ? TEAL : PURPLE,
                  transform: [{ translateX: tx }, { translateY: ty }],
                },
              ]}
            />
          );
        })}

        {/* Core */}
        <Animated.View
          style={[styles.core, { transform: [{ scale: coreScale }] }]}
        />
      </View>

      <Text style={styles.wordmark}>AURA</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 48,
  },
  stage: {
    // Must cover the full visual footprint: particles travel DISTANCE px,
    // rings scale to 3.4× RING_BASE — so use 2×DISTANCE as the stage size.
    width:           DISTANCE * 2,
    height:          DISTANCE * 2,
    alignItems:      'center',
    justifyContent:  'center',
  },
  ring: {
    position:     'absolute',
    width:        RING_BASE,
    height:       RING_BASE,
    borderRadius: RING_BASE / 2,
    borderWidth:  1.5,
  },
  particle: {
    position:     'absolute',
    width:        PARTICLE_R * 2,
    height:       PARTICLE_R * 2,
    borderRadius: PARTICLE_R,
  },
  core: {
    position:      'absolute',
    width:         CORE_R * 2,
    height:        CORE_R * 2,
    borderRadius:  CORE_R,
    backgroundColor: '#ffffff',
    shadowColor:   '#ffffff',
    shadowRadius:  14,
    shadowOpacity: 0.85,
    shadowOffset:  { width: 0, height: 0 },
    elevation:     8,
  },
  wordmark: {
    color:         '#ffffff',
    fontSize:      26,
    fontWeight:    '800',
    letterSpacing: 8,
    textAlign:     'center',
    alignSelf:     'center',
    width:         '100%',
    paddingLeft:   8,
  },
});
