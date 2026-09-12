import { View, Text, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { fonts } from '@/constants/theme'
import type { ColorPalette } from '@/constants/theme'
import { useTheme } from '@/context/ThemeContext'
import { PresenceDot } from '@/components/PresenceDot'
import type { Presence } from '@/services/presence'

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE_MAP: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 44,
  lg: 56,
  xl: 80,
}

/** Presence badge scaled to the avatar. Below `sm` there is no room for a dot
 * that stays legible, so those sizes carry no badge. */
const DOT_MAP: Record<AvatarSize, number> = {
  xs: 0,
  sm: 9,
  md: 11,
  lg: 13,
  xl: 16,
}

interface AvatarProps {
  uri?: string | null
  name?: string
  size?: AvatarSize
  /** Teal ring shorthand */
  active?: boolean
  /** Explicit ring color — overrides active (e.g. blue=friend, orange=connected, grey=stranger) */
  ringColor?: string
  /**
   * Online/offline badge. Absent or null renders no badge at all — the API
   * omits presence for viewers who may not see it, and a grey "offline" dot
   * would both misreport that and make hiding detectable.
   */
  presence?: Presence | null
  /**
   * Draws the accent ring that means "this person has a live story".
   *
   * A second ring outside the tier one rather than a different colour for it:
   * the inner ring answers "who is this to me" and this answers "is there
   * something to open", and collapsing them into one colour would make a
   * friend with a story indistinguishable from a connection without one.
   */
  storyRing?: boolean
  /**
   * Draws the outermost ring, meaning "this person has Swifts".
   *
   * A third ring rather than a second colour on the story one, for the same
   * reason `storyRing` is separate from the tier ring: each answers a
   * different question, and merging any two makes a person with one thing to
   * open indistinguishable from a person with the other. Outermost because it
   * is the least time-critical of the three — a story expires in 24h, a Swift
   * does not.
   *
   * Purple, not teal: teal already means "live story" on this exact control,
   * and two concentric teal rings would read as one thick one.
   */
  swiftRing?: boolean
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  ring: {
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyRing: {
    borderWidth: 2,
    borderColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swiftRing: {
    borderWidth: 2,
    borderColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presence: { position: 'absolute', right: -1, bottom: -1 },
  container: {
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: {
    fontFamily: fonts.display,
    fontWeight: '600',
    color: colors.t2,
  },
})

export function Avatar({
  uri, name, size = 'md', active = false, ringColor, presence, storyRing = false,
  swiftRing = false,
}: AvatarProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const dim = SIZE_MAP[size]
  const dot = DOT_MAP[size]
  const fontSize = Math.round(dim * 0.38)
  const initials = name
    ? name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  const borderColor = ringColor ?? (active ? colors.teal : 'transparent')

  const inner = (
    <View
      style={[
        styles.ring,
        { width: dim + 4, height: dim + 4, borderRadius: (dim + 4) / 2, borderColor },
      ]}
    >
      <View style={[styles.container, { width: dim, height: dim, borderRadius: dim / 2 }]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: dim, height: dim, borderRadius: dim / 2 }}
            contentFit="cover"
          />
        ) : (
          <Text style={[styles.initials, { fontSize }]}>{initials}</Text>
        )}
      </View>
      {dot > 0 && (
        <View style={styles.presence}>
          {/* The halo is the page background, so the badge reads as sitting on
              top of the avatar rather than as part of the photo. */}
          <PresenceDot presence={presence} size={dot} haloColor={colors.bg} />
        </View>
      )}
    </View>
  )

  // Each ring wraps the last, so one costs nothing where it is not asked for
  // and the avatar underneath keeps whatever ring it already had.
  const withStory = storyRing ? (
    <View
      style={[
        styles.storyRing,
        { width: dim + 12, height: dim + 12, borderRadius: (dim + 12) / 2 },
      ]}
    >
      {inner}
    </View>
  ) : inner

  if (!swiftRing) return withStory

  // Sized off whatever it is wrapping, so a Swift ring sits just outside a
  // story ring when there is one and just outside the avatar when there is not
  // — rather than leaving a gap the width of a ring that was never drawn.
  const outer = dim + (storyRing ? 20 : 12)
  return (
    <View
      style={[
        styles.swiftRing,
        { width: outer, height: outer, borderRadius: outer / 2 },
      ]}
    >
      {withStory}
    </View>
  )
}
