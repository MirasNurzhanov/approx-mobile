import { useMemo, useState } from 'react'
import {
  TextInput,
  View,
  Text,
  Pressable,
  StyleSheet,
  type TextInputProps,
} from 'react-native'
import { radius, fonts } from '@/constants/theme'
import type { ColorPalette } from '@/constants/theme'
import { useTheme } from '@/context/ThemeContext'

interface InputProps extends TextInputProps {
  label?: string
  error?: string
  hint?: string
  prefix?: React.ReactNode
  suffix?: React.ReactNode
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  wrapper: { gap: 6 },
  label: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: colors.t2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  rowFocused: { borderColor: colors.tealLine },
  rowError: { borderColor: colors.red },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t1,
    paddingVertical: 13,
  },
  adornment: { marginHorizontal: 4 },
  error: { fontFamily: fonts.body, fontSize: 12, color: colors.red },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.t3 },
})

export function Input({ label, error, hint, prefix, suffix, style, ...rest }: InputProps) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [focused, setFocused] = useState(false)

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.row,
          focused && styles.rowFocused,
          !!error && styles.rowError,
        ]}
      >
        {prefix ? <View style={styles.adornment}>{prefix}</View> : null}
        <TextInput
          {...rest}
          style={[styles.input, style]}
          placeholderTextColor={colors.t3}
          selectionColor={colors.teal}
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e) }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e) }}
        />
        {suffix ? <View style={styles.adornment}>{suffix}</View> : null}
      </View>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  )
}
