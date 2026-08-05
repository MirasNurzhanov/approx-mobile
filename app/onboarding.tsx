import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
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

import { fonts, radius } from '@/constants/theme';
import { markOnboardingSeen } from '@/services/onboarding';

const { width } = Dimensions.get('window');

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const SLIDES: { id: string; icon: IoniconsName; title: string; body: string }[] = [
  {
    id: '1',
    icon: 'people-outline',
    title: 'Find your people',
    body: 'Discover people nearby who share your interests and get in touch with them right away',
  },
  {
    id: '2',
    icon: 'map-outline',
    title: 'Connect instantly',
    body: "See who's around you on the map, tap their profile, and send a Hi to start a conversation",
  },
  {
    id: '3',
    icon: 'people-circle-outline',
    title: 'Build your circle',
    body: 'Join clubs, organise meetups, and grow real friendships around the things you love',
  },
];

const LIGHT = {
  bg:       '#faf9f5',
  surface2: '#FCEEE8',
  t1:       '#2D2A22',
  t2:       '#6B6455',
  teal:     '#E8714A',
  border:   '#E8E4DA',
} as const;

export default function OnboardingScreen() {
  const styles = useMemo(() => makeStyles(LIGHT), []);
  const { bottom } = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const flatRef = useRef<FlatList>(null);

  // FlatList rejects a changing `onViewableItemsChanged`, so this identity has
  // to be created once. `useState` with an initialiser gives that guarantee
  // without a ref that render would then have to read back.
  const [onViewableItemsChanged] = useState(() => {
    return ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const i = viewableItems[0]?.index;
      if (i != null) setIndex(i);
    };
  });

  function goNext() {
    if (index < SLIDES.length - 1) {
      flatRef.current?.scrollToIndex({ index: index + 1, animated: true });
    } else {
      // Recorded here rather than awaited: the write is what stops the intro
      // reappearing after a sign-out, and nobody should watch a spinner for it.
      markOnboardingSeen();
      router.replace('/welcome');
    }
  }

  const isLast = index === SLIDES.length - 1;

  return (
    <View style={styles.root}>
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
            <View style={styles.iconWrap}>
              <Ionicons name={item.icon} size={80} color={LIGHT.teal} />
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {SLIDES.map((slide, i) => (
          <View key={slide.id} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={[styles.footer, { paddingBottom: bottom + 16 }]}>
        <Pressable
          onPress={goNext}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel={isLast ? 'Get Started' : 'Next'}
        >
          <Text style={styles.btnLabel}>{isLast ? 'Get Started' : 'Next'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: typeof LIGHT) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: c.bg,
  },

  slide: {
    width,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },

  iconWrap: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: c.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 44,
  },

  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 28,
    color: c.t1,
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: 0.2,
  },

  body: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: c.t2,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
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
    backgroundColor: c.border,
  },
  dotActive: {
    width: 24,
    borderRadius: 3,
    backgroundColor: c.teal,
  },

  footer: {
    paddingHorizontal: 24,
  },

  btn: {
    backgroundColor: c.teal,
    borderRadius: radius.m,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  btnPressed: { opacity: 0.75 },
  btnLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 17,
    color: c.bg,
  },
});
