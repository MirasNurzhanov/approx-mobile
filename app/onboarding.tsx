import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');
const COLOR_TEAL = '#00b4a6';

const CARDS = [
  {
    id: '1',
    emoji: '🗺️',
    title: 'Discover nearby people',
    body: 'Find people with shared interests right around you — no algorithms, just proximity.',
  },
  {
    id: '2',
    emoji: '🎵',
    title: "Enter someone's Zone",
    body: 'Walk near someone and hear their music. Let your vibe speak before you say a word.',
  },
  {
    id: '3',
    emoji: '⚔️',
    title: 'Complete Quests',
    body: 'Earn Aura Points by completing challenges and climb to the top of the leaderboard.',
  },
  {
    id: '4',
    emoji: '👥',
    title: 'Make real connections',
    body: 'Go from stranger to friend in real life. Every connection starts with being in the same place.',
  },
];

async function finish() {
  await AsyncStorage.setItem('onboarding_seen', 'true');
  router.replace('/welcome');
}

export default function OnboardingScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const flatRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null) setIndex(i);
  }).current;

  function goNext() {
    if (index < CARDS.length - 1) {
      flatRef.current?.scrollToIndex({ index: index + 1, animated: true });
    } else {
      finish();
    }
  }

  const isLast = index === CARDS.length - 1;

  return (
    <View style={styles.root}>
      {/* Skip — top right, hidden on last slide */}
      {!isLast && (
        <TouchableOpacity
          onPress={finish}
          activeOpacity={0.7}
          style={[styles.skipBtn, { top: top + 12 }]}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}

      <FlatList
        ref={flatRef}
        data={CARDS}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.iconRing}>
              <View style={styles.iconInner}>
                <Text style={styles.emoji}>{item.emoji}</Text>
              </View>
            </View>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardBody}>{item.body}</Text>
          </View>
        )}
      />

      {/* Dot indicators */}
      <View style={styles.dots}>
        {CARDS.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      {/* Footer — full-width Next / Get Started */}
      <View style={[styles.footer, { paddingBottom: bottom + 24 }]}>
        <TouchableOpacity onPress={goNext} activeOpacity={0.85} style={styles.nextBtn}>
          <Text style={styles.nextText}>{isLast ? 'Get Started' : 'Next'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },

  // ── Skip ──
  skipBtn: {
    position: 'absolute',
    right: 24,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  skipText: { color: '#555', fontSize: 15, fontWeight: '500' },

  // ── Card ──
  card: {
    width,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  iconRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1.5,
    borderColor: `${COLOR_TEAL}40`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
    shadowColor: COLOR_TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 10,
  },
  iconInner: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: `${COLOR_TEAL}12`,
    borderWidth: 1,
    borderColor: `${COLOR_TEAL}30`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 38 },
  cardTitle: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: 0.3,
  },
  cardBody: {
    color: '#666',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    letterSpacing: 0.2,
  },

  // ── Dots ──
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 32,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2a2a2a' },
  dotActive: { width: 22, backgroundColor: COLOR_TEAL },

  // ── Footer ──
  footer: { paddingHorizontal: 24 },
  nextBtn: {
    backgroundColor: COLOR_TEAL,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: COLOR_TEAL,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  nextText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
});
