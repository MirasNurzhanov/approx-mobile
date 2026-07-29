import { View, Text, Image, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '@/constants/theme'
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
}

export function Avatar({ uri, name, size = 'md', active = false, ringColor, presence }: AvatarProps) {
  const dim = SIZE_MAP[size]
  const dot = DOT_MAP[size]
  const fontSize = Math.round(dim * 0.38)
  const initials = name
    ? name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  const borderColor = ringColor ?? (active ? colors.teal : 'transparent')

  return (
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
            resizeMode="cover"
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
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringActive: { borderColor: colors.teal },
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
