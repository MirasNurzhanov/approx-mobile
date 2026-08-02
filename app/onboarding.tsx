import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { colors, fonts, radius } from '@/constants/theme';

const { width } = Dimensions.get('window');

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const SLIDES: { id: string; icon: IoniconsName; title: string; body: string }[] = [
  {
    id: '1',
    icon: 'map-outline',
    title: 'Discover Nearby',
    body: 'Find people with shared interests right around you — no algorithms, just proximity.',
  },
  {
    id: '2',
    icon: 'musical-notes-outline',
    title: "Enter Someone's Zone",
    body: 'Walk near someone and hear their music. Let your vibe speak before you say a word.',
  },
  {
    id: '3',
    icon: 'people-outline',
    title: 'Make Real Connections',
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
    if (index < SLIDES.length - 1) {
      flatRef.current?.scrollToIndex({ index: index + 1, animated: true });
    } else {
      finish();
    }
  }

  const isLast = index === SLIDES.length - 1;

  return (
    <View style={styles.root}>
      {!isLast && (
        <Pressable
          onPress={finish}
          style={[styles.skipBtn, { top: top + 12 }]}
          hitSlop={12}
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      )}

      <FlatList
        ref={flatRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <View style={styles.iconRing}>
              <View style={styles.iconInner}>
                <Ionicons name={item.icon} size={52} color={colors.teal} />
              </View>
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={[styles.footer, { paddingBottom: bottom + 16 }]}>
        <Button
          label={isLast ? 'Get Started' : 'Next'}
          variant="primary"
          size="lg"
          fullWidth
          onPress={goNext}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  skipBtn: {
    position: 'absolute',
    right: 24,
    zIndex: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  skipText: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t3,
  },

  slide: {
    width,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  iconRing: {
    width: 136,
    height: 136,
    borderRadius: 68,
    borderWidth: 1.5,
    borderColor: colors.tealLine,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 44,
  },
  iconInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 28,
    color: colors.t1,
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: 0.2,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t2,
    textAlign: 'center',
    lineHeight: 24,
  },

  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginBottom: 28,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface2,
  },
  dotActive: {
    width: 24,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.teal,
  },

  footer: {
    paddingHorizontal: 24,
  },
});
