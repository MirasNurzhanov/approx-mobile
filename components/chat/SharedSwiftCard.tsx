import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import type { SharedSwift } from '@/services/directMessages';

/**
 * A Swift sent into a conversation: who made it, its poster at the Swift's own
 * portrait shape, and its caption — tapping opens it. `swift` is absent when the
 * reader can no longer watch it, and the card says so rather than drawing an
 * empty bubble.
 */
export function SharedSwiftCard({ swift }: { swift?: SharedSwift }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();

  if (!swift) {
    return (
      <View style={[styles.card, styles.unavailable]}>
        <Ionicons name="videocam-off-outline" size={20} color={colors.t3} />
        <Text style={styles.unavailableText}>This Swift is no longer available</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/swifts/[id]', params: { id: swift.id } })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Swift by ${swift.author.username}${swift.caption ? `: ${swift.caption}` : ''}. Opens it.`}
    >
      <Text style={styles.author} numberOfLines={1}>@{swift.author.username}</Text>
      <View style={styles.poster}>
        {swift.thumbnail_url ? (
          <Image source={{ uri: swift.thumbnail_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}
        <View style={styles.play}>
          <Ionicons name="play" size={22} color="#FFFFFF" />
        </View>
      </View>
      {swift.caption ? (
        <Text style={styles.caption} numberOfLines={2}>{swift.caption}</Text>
      ) : null}
    </Pressable>
  );
}

const WIDTH = 180;

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  card: {
    width: WIDTH,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.8 },
  author: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.t1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  poster: {
    width: WIDTH,
    height: (WIDTH * 16) / 9,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.t2,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  unavailable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
  },
  unavailableText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t3,
  },
});
