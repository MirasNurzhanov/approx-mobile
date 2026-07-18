import { Pressable, Text, ActivityIndicator, StyleSheet, type PressableProps } from 'react-native'
import { colors, radius, fonts } from '@/constants/theme'
import type { IconComponent } from './icons'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerTint'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends Omit<PressableProps, 'style'> {
  label: string
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
  icon?: IconComponent
}

const LABEL_COLOR: Record<Variant, string> = {
  primary: colors.bg,
  secondary: colors.t1,
  ghost: colors.t1,
  danger: '#fff',
  dangerTint: colors.red,
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  icon: Icon,
  disabled,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        (pressed || isDisabled) && styles.dimmed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.bg : colors.teal} size="small" />
      ) : (
        <>
          {Icon ? <Icon size={18} color={LABEL_COLOR[variant]} /> : null}
          <Text style={[styles.label, styles[`label_${variant}`], styles[`label_${size}`]]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  fullWidth: { width: '100%' },
  dimmed: { opacity: 0.5 },

  // variants
  primary: { backgroundColor: colors.teal },
  secondary: { backgroundColor: colors.surface2, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent', borderColor: colors.border },
  danger: { backgroundColor: colors.red },
  dangerTint: { backgroundColor: `${colors.red}26` },

  // sizes
  sm: { paddingHorizontal: 12, paddingVertical: 8 },
  md: { paddingHorizontal: 20, paddingVertical: 13 },
  lg: { paddingHorizontal: 28, paddingVertical: 17 },

  // label base
  label: { fontFamily: fonts.body, fontWeight: '600' },

  // label by variant
  label_primary: { color: colors.bg },
  label_secondary: { color: colors.t1 },
  label_ghost: { color: colors.t1 },
  label_danger: { color: '#fff' },
  label_dangerTint: { color: colors.red },

  // label by size
  label_sm: { fontSize: 13 },
  label_md: { fontSize: 15 },
  label_lg: { fontSize: 17 },
})
