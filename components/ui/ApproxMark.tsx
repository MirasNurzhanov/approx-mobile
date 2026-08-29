import Svg, { Circle, Path } from 'react-native-svg'

import { useTheme } from '@/context/ThemeContext'

interface AuraMarkProps {
  size?: number
  color?: string
}

// Brand mark from the design icon library (#i-aura):
// 24px grid, 1.5px stroke, squared terminals, filled core.
export function AuraMark({ size = 32, color }: AuraMarkProps) {
  const { colors } = useTheme()
  const c = color ?? colors.teal
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2.8l7.6 4.4v9.6L12 21.2 4.4 16.8V7.2z"
        stroke={c}
        strokeWidth={1.5}
        strokeLinejoin="miter"
        fill="none"
      />
      <Circle cx={12} cy={12} r={2.5} fill={c} />
    </Svg>
  )
}
