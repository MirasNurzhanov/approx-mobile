import { View, Text, Image, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '@/constants/theme'

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE_MAP: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 44,
  lg: 56,
  xl: 80,
}

interface AvatarProps {
  uri?: string | null
  name?: string
  size?: AvatarSize
  /** Teal ring shorthand */
  active?: boolean
  /** Explicit ring color — overrides active (e.g. blue=friend, orange=connected, grey=stranger) */
  ringColor?: string
}

export function Avatar({ uri, name, size = 'md', active = false, ringColor }: AvatarProps) {
  const dim = SIZE_MAP[size]
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
