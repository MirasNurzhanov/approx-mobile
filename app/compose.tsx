import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconClose, IconImage, IconSwift } from '@/components/ui/icons';
import { fonts, radius, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// What swiping right from the map opens: the two things a person can publish.
//
// It is a chooser rather than a camera, because the two are not one capture
// with a switch on it. A story is a photo or some words pinned where you are
// and gone in 24 hours; a Swift is a video that is trimmed, scored and kept.
// Both composers already exist and each asks for what it needs — the story
// sheet on the map, `/swifts/compose` for the other — so this hands off to
// them rather than growing a third capture path that would have to feed both.
//
// Story routes through the map because the story composer is a modal that
// lives there (see `composerOpen` in `(tabs)/map`), and it needs the map's
// current coordinate to decide whether the story is a pin. `replace`, not
// `push`, on both paths: this screen is a fork in the road, and coming back
// from the composer should land on the map rather than here.

interface OptionProps {
  Icon: typeof IconImage;
  title: string;
  detail: string;
  onPress: () => void;
  accessibilityHint: string;
}

function Option({ Icon, title, detail, onPress, accessibilityHint }: OptionProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
    >
      <View style={styles.tileRing}>
        <Icon size={26} color={colors.teal} />
      </View>
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileDetail}>{detail}</Text>
      </View>
    </Pressable>
  );
}

export default function ComposeScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { top, bottom } = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Create</Text>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <IconClose size={20} color={colors.t1} />
        </Pressable>
      </View>

      <View style={[styles.body, { paddingBottom: bottom + 24 }]}>
        <Option
          Icon={IconImage}
          title="Story"
          detail="A photo or a few words, pinned where you are. Gone in 24 hours."
          accessibilityHint="Opens the story composer on the map"
          onPress={() =>
            router.replace({ pathname: '/(tabs)/map', params: { compose: 'story' } })
          }
        />
        <Option
          Icon={IconSwift}
          title="Swift"
          detail="A short video — trim it, add a track, and it stays on your profile."
          accessibilityHint="Opens the Swift composer"
          onPress={() => router.replace('/swifts/compose')}
        />
      </View>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.6 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 26,
    color: colors.t1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  body: { flex: 1, paddingHorizontal: 20, paddingTop: 8, gap: 12 },

  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileRing: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
  },
  tileText: { flex: 1, gap: 4 },
  tileTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  tileDetail: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.t3,
  },
});
