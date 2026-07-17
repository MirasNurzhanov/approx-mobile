import { View, Pressable, StyleSheet, type ViewStyle, type PressableProps } from 'react-native'
import { colors, radius } from '@/constants/theme'

interface CardProps {
  children: React.ReactNode
  style?: ViewStyle
  /** When provided the card becomes pressable */
  onPress?: PressableProps['onPress']
  variant?: 'default' | 'elevated'
}

export function Card({ children, style, onPress, variant = 'default' }: CardProps) {
  const containerStyle = [styles.card, variant === 'elevated' && styles.elevated, style]

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [...containerStyle, pressed && styles.pressed]}
      >
        {children}
      </Pressable>
    )
  }

  return <View style={containerStyle}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  elevated: {
    backgroundColor: colors.surface2,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  pressed: { opacity: 0.8 },
})
