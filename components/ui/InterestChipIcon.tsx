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
 */
export function InterestChipIcon({ name, icon }: { name: string; icon?: string }) {
  const { colors: c } = useTheme()
  if (icon) return <Text style={interestChipStyles.emoji}>{icon}</Text>
  const Icon = iconForInterest(name)
  return <Icon size={16} color={c.t2} />
}

const interestChipStyles = StyleSheet.create({
  emoji: { fontSize: 15 },
})
