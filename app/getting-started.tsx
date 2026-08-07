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

import { IconImage, IconLocate, IconPeople, type IconComponent } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { markGuideSeen } from '@/services/guide';

// The three things a new account cannot work out by looking.
//
// Shown once, to people who have just registered, and never again — see
// services/guide for how "once" is actually enforced. The intro carousel on
// app/onboarding.tsx is a different thing and is deliberately left alone: that
// one sells the app to someone who has not signed up yet, in three sentences
// about people and places. This one is the manual, and it is only worth reading
// once you have an account to use it with.
//
// Three slides because there are exactly three things here that a curious
// person will not find by tapping around:
//
//   1. The zone is *off* when you arrive (`zone_active` defaults False), and
//      the switch for it is in Settings, which is the last place you look when
//      the thing you want is on the map.
//   2. Stories are dropped by long-pressing the map. There is no button. A
//      gesture with no affordance is invisible until someone says it out loud,
//      and this is the only place the app says it.
//   3. Clubs live behind the Chat tab, which nobody expects, because "chat" and
//      "clubs" are not the same word.
//
// Everything else — the markers, Hi, the profile, the feed — announces itself
// with a tappable thing on screen, and a slide explaining a button people have
// already pressed is a slide they resent. Music zones are deliberately absent
// too: nothing about them matters until you have a track, and Zone Music
// explains itself when you get there.
//
// Themed rather than hardcoded light like the pre-auth screens: by this point
// the user is signed in and the rest of the app respects their theme.

interface Slide {
  id: string;
  icon: IconComponent;
  title: string;
  body: string;
  /** Where the thing actually is. Kept apart from `body` and styled as a
   *  breadcrumb because it is the half people come back for — the explanation
   *  is read once, the path is what they need again next week. */
  where: string;
}

const SLIDES: Slide[] = [
  {
    id: 'zone',
    icon: IconLocate,
    title: 'Turn on your zone',
    body:
      'Your zone is the circle drawn around you on the map, and anyone inside it is in your zone. It starts switched off, so nothing is drawn until you turn it on. Zone size sets how far it reaches — a radius from a single street upwards, or the real border of your district or city.',
    where: 'Settings → Zone on the map',
  },
  {
    id: 'stories',
    icon: IconImage,
    title: 'Leave a story on the map',
    body:
      'Press and hold the map to post a story at wherever you are — a few words, and a photo if you want one. It stays for 24 hours and anyone nearby can open it and react. Tap the bubbles you see to read what other people have left.',
    where: 'Long-press the map · your own are in Profile → My stories',
  },
  {
    id: 'clubs',
    icon: IconPeople,
    title: 'Join a club',
    body:
      'Clubs are local groups, usually around a shared interest, and the ones you can discover are the ones near you. Joining gets you the group chat and its meetups, which appear as pins on the map. If nothing fits, make your own in a couple of taps.',
    where: 'Chat → Clubs',
  },
];

const { width } = Dimensions.get('window');

export default function GettingStartedScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { top, bottom } = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);

  // FlatList rejects a changing `onViewableItemsChanged`, so this identity has
  // to be created once — same constraint, same fix, as app/onboarding.tsx.
  const [onViewableItemsChanged] = useState(() => {
    return ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const i = viewableItems[0]?.index;
      if (i != null) setIndex(i);
    };
  });

  /** Done with, by either door. `replace`, not `push`: the sign-up chain is
   *  behind this screen and there is nothing back there worth returning to. */
  function finish() {
    // Not awaited. The write is what stops the guide coming back, and nobody
    // should watch a spinner for a key-value set — a failure costs one repeat
    // showing, which is cheaper than a tap that appears to do nothing.
    markGuideSeen();
    router.replace('/(tabs)/map');
  }

  function goNext() {
    if (index < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    } else {
      finish();
    }
  }

  const isLast = index === SLIDES.length - 1;

  return (
    <View style={styles.root}>
      {/* Skip is always available. This is help, not a gate, and a guide you
          cannot leave is worse than no guide — the one thing it must never do
          is stand between someone and the app they just signed up for. */}
      <View style={[styles.topRow, { paddingTop: top + 8 }]}>
        <Text style={styles.eyebrow}>How Aura works</Text>
        <Pressable
          onPress={finish}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip the guide"
        >
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item: slide }) => {
          const Icon = slide.icon;
          return (
            <View style={styles.slide}>
              {/* The same glyph the user will meet on the row they are being
                  sent to — Settings' zone row, Profile's stories row, the
                  people icon on a club. A guide that draws its own picture of a
                  feature teaches you to look for the wrong thing. */}
              <View style={styles.iconWrap}>
                <Icon size={44} color={colors.teal} />
              </View>

              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.body}>{slide.body}</Text>

              <View style={styles.whereChip}>
                <Text style={styles.whereText}>{slide.where}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.dots}>
        {SLIDES.map((slide, i) => (
          <View key={slide.id} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={[styles.footer, { paddingBottom: bottom + 16 }]}>
        <Button
          label={isLast ? 'Start using Aura' : 'Next'}
          size="lg"
          fullWidth
          onPress={goNext}
          accessibilityLabel={isLast ? 'Start using Aura' : 'Next tip'}
        />
      </View>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  eyebrow: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.t3,
  },
  skip: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t3,
  },

  slide: {
    width,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },

  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },

  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 26,
    color: colors.t1,
    textAlign: 'center',
    marginBottom: 14,
    letterSpacing: 0.2,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t2,
    textAlign: 'center',
    lineHeight: 23,
    maxWidth: 320,
  },

  whereChip: {
    marginTop: 22,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  whereText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.t2,
    textAlign: 'center',
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
    backgroundColor: colors.border,
  },
  dotActive: {
    width: 24,
    borderRadius: 3,
    backgroundColor: colors.teal,
  },

  footer: { paddingHorizontal: 24 },
});
