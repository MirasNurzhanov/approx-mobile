import { StyleSheet, Text } from 'react-native'

import { useTheme } from '@/context/ThemeContext'
import { iconForInterest } from './interestIcons'

/**
 * Icon for an interest chip.
 *
 * The backend ships an emoji with every curated interest, so that is the first
 * choice and the common case. The SVG set is the fallback, which matters for
 * interests stored before the "Other" flow was removed: those were saved with
 * no emoji, and without this they would render as a blank chip.
 *
 * `color` overrides the themed default. Onboarding is forced light whatever
 * the device theme is, so a fallback icon there has to be told what it is
 * sitting on — the theme would hand it a dark-mode colour on a cream chip.
 */
export function InterestChipIcon({
  name,
  icon,
  color,
}: {
  name: string
  icon?: string
  color?: string
}) {
  const { colors: c } = useTheme()
  if (icon) return <Text style={interestChipStyles.emoji}>{icon}</Text>
  const Icon = iconForInterest(name)
  return <Icon size={16} color={color ?? c.t2} />
}

const interestChipStyles = StyleSheet.create({
  emoji: { fontSize: 15 },
})
