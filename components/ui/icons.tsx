import { StyleSheet, Text } from 'react-native'
import Svg, { Circle, G, Path, Rect } from 'react-native-svg'

import { colors } from '@/constants/theme'

// Design icon library: 24px grid, 1.5px stroke, squared terminals, single color.
// Paths are lifted verbatim from the redesign SVG sprite.

export interface IconProps {
  size?: number
  color?: string
}

export type IconComponent = (props: IconProps) => React.JSX.Element

const stroke = {
  strokeWidth: 1.5,
  strokeLinecap: 'square',
  strokeLinejoin: 'miter',
  fill: 'none',
} as const

export function IconSearch({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={11} cy={11} r={6.25} />
        <Path d="M15.6 15.6L21 21" />
      </G>
    </Svg>
  )
}

export function IconShield({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 3l7 2.8v6c0 4.4-2.9 7.4-7 9.2-4.1-1.8-7-4.8-7-9.2v-6z" />
      </G>
    </Svg>
  )
}

export function IconPeople({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={9} cy={8} r={3} />
        <Path d="M2.8 20c0-3.4 2.7-5.6 6.2-5.6s6.2 2.2 6.2 5.6M15.2 5.3a3 3 0 010 5.4M17.1 14.8c2.5.6 4.1 2.5 4.1 5.2" />
      </G>
    </Svg>
  )
}

export function IconSound({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={5.5} cy={12} r={1.4} fill={color} />
      <G stroke={color} {...stroke}>
        <Path d="M9.5 8.2a5.4 5.4 0 010 7.6M13 5a9.9 9.9 0 010 14M16.5 2.8a14.3 14.3 0 010 18.4" />
      </G>
    </Svg>
  )
}

export function IconMute({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4zM16.5 9.5l5 5M21.5 9.5l-5 5" />
      </G>
    </Svg>
  )
}

export function IconHi({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={8} y={8} width={8.5} height={9.5} rx={3} />
        <Path d="M10 8V4.8M12.5 8V3.8M15 8V4.8M8 11.5H5.3a1.6 1.6 0 000 3.2H8M19.5 5.5a5.5 5.5 0 011.6 3.4" />
      </G>
    </Svg>
  )
}

export function IconClose({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M6 6l12 12M18 6L6 18" />
      </G>
    </Svg>
  )
}

export function IconPin({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 21.5S5.5 15.8 5.5 11a6.5 6.5 0 0113 0c0 4.8-6.5 10.5-6.5 10.5z" />
        <Circle cx={12} cy={11} r={2.2} />
      </G>
    </Svg>
  )
}

export function IconImage({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={3.5} y={5} width={17} height={14} rx={2} />
        <Circle cx={8.5} cy={10} r={1.4} />
        <Path d="M5.5 17l4-4 3 3 3.5-3.5 3.5 3.5" />
      </G>
    </Svg>
  )
}

export function IconLike({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M8.5 11l4-7.5c1.2 0 2.1 1 2.1 2.4 0 1-.7 3.1-.7 3.1h4.6a1.9 1.9 0 011.8 2.4l-1.5 5.7a1.9 1.9 0 01-1.9 1.4H8.5zM8.5 11H4.5v9h4z" />
      </G>
    </Svg>
  )
}

export function IconFunny({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={12} cy={12} r={8.25} />
        <Path d="M8.3 13.5a4.2 4.2 0 007.4 0" />
      </G>
      <Circle cx={9} cy={9.5} r={1.2} fill={color} />
      <Circle cx={15} cy={9.5} r={1.2} fill={color} />
    </Svg>
  )
}

export function IconInsight({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 3a6 6 0 00-3.4 10.9c.8.6.9 1.3.9 2.1h5c0-.8.1-1.5.9-2.1A6 6 0 0012 3zM9.5 18.5h5M10.5 21h3" />
      </G>
    </Svg>
  )
}

export function IconStar({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.9z" />
      </G>
    </Svg>
  )
}

export function IconChevron({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M9 5.5l6.5 6.5L9 18.5" />
      </G>
    </Svg>
  )
}

export function IconBack({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M15 5.5L8.5 12l6.5 6.5" />
      </G>
    </Svg>
  )
}

export function IconMore({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={5} cy={12} r={1.4} fill={color} />
      <Circle cx={12} cy={12} r={1.4} fill={color} />
      <Circle cx={19} cy={12} r={1.4} fill={color} />
    </Svg>
  )
}

export function IconCamera({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4.5 7.5h3.2l1.7-2.5h5.2l1.7 2.5h3.2v11h-15z" />
        <Circle cx={12} cy={12.5} r={2.8} />
      </G>
    </Svg>
  )
}

export function IconHeart({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 20.5S4.5 15.6 4.5 10.1a4.1 4.1 0 017.5-2.3 4.1 4.1 0 017.5 2.3c0 5.5-7.5 10.4-7.5 10.4z" />
      </G>
    </Svg>
  )
}

export function IconTrophy({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M7.5 3.5h9v5.2a4.5 4.5 0 01-9 0z" />
        <Path d="M7.5 5.5h-3c0 2.9 1.2 4.7 3 5.2M16.5 5.5h3c0 2.9-1.2 4.7-3 5.2M12 13.2V17M8.5 20.5h7M10.2 17h3.6" />
      </G>
    </Svg>
  )
}

export function IconPencil({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4.5 19.5l.9-3.9L16.8 4.2l3 3L8.4 18.6z" />
        <Path d="M14.6 6.4l3 3" />
      </G>
    </Svg>
  )
}

export function IconLogout({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M9.5 4.5H4.5v15h5" />
        <Path d="M8.5 12H19M15.5 8.5L19 12l-3.5 3.5" />
      </G>
    </Svg>
  )
}

export function IconEye({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
        <Circle cx={12} cy={12} r={2.8} />
      </G>
    </Svg>
  )
}

export function IconEyeOff({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
        <Path d="M5 19L19 5" />
      </G>
    </Svg>
  )
}

export function IconGhost({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M5.5 20.5V10a6.5 6.5 0 0113 0v10.5l-3.25-2.2-3.25 2.2-3.25-2.2z" />
      </G>
      <Circle cx={9.5} cy={11} r={1.2} fill={color} />
      <Circle cx={14.5} cy={11} r={1.2} fill={color} />
    </Svg>
  )
}

export function IconBell({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 3.5a5.5 5.5 0 015.5 5.5v3.8l1.8 3.2H4.7l1.8-3.2V9A5.5 5.5 0 0112 3.5z" />
        <Path d="M9.8 19.5a2.3 2.3 0 004.4 0" />
      </G>
    </Svg>
  )
}

export function IconBlocked({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={12} cy={12} r={8.25} />
        <Path d="M6.2 6.2l11.6 11.6" />
      </G>
    </Svg>
  )
}

export function IconList({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M9 7h11M9 12h11M9 17h11" />
        <Path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" />
      </G>
    </Svg>
  )
}

export function IconLock({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M5.5 10.5h13v9h-13z" />
        <Path d="M8.5 10.5V7.75a3.5 3.5 0 017 0v2.75" />
        <Path d="M12 14v2.5" />
      </G>
    </Svg>
  )
}

export function IconTrash({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 13h9l1-13" />
        <Path d="M10 10.5v5.5M14 10.5v5.5" />
      </G>
    </Svg>
  )
}

export function IconBookmark({ size = 24, color = colors.t2, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke} fill={filled ? color : 'none'}>
        <Path d="M6.5 3.5h11v17L12 16l-5.5 4.5z" />
      </G>
    </Svg>
  )
}

export function IconCheck({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4.5 12.5l5 5L19.5 7" />
      </G>
    </Svg>
  )
}

export function IconMail({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M3.5 5.5h17v13h-17z" />
        <Path d="M4.5 6.5L12 13l7.5-6.5" />
      </G>
    </Svg>
  )
}

export function IconInfo({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={12} cy={12} r={8.25} />
        <Path d="M12 11.2V16" />
      </G>
      <Circle cx={12} cy={8} r={1.2} fill={color} />
    </Svg>
  )
}

// ── Interest-category icons ───────────────────────────────────────────────────

export function IconMusic({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M9.5 17V5.8l9-1.8V15" />
      </G>
      <Circle cx={7.3} cy={17} r={2.2} fill={color} />
      <Circle cx={16.3} cy={15} r={2.2} fill={color} />
    </Svg>
  )
}

export function IconCoffee({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4.5 9h11v5.5a4 4 0 01-4 4h-3a4 4 0 01-4-4z" />
        <Path d="M15.5 10h1.5a2.25 2.25 0 010 4.5h-1.5" />
        <Path d="M7.5 6V4M11 6V4" />
      </G>
    </Svg>
  )
}

export function IconHiking({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M3.5 18.5L9.5 8.5l3.2 5.3 2.3-3.6 5.5 8.3z" />
        <Circle cx={17} cy={5.8} r={1.6} />
      </G>
    </Svg>
  )
}

export function IconBook({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 6.8C10.5 5.6 8.5 5 5 5v13.5c3.5 0 5.5.6 7 1.7 1.5-1.1 3.5-1.7 7-1.7V5c-3.5 0-5.5.6-7 1.8z" />
        <Path d="M12 6.8v13.4" />
      </G>
    </Svg>
  )
}

export function IconGamepad({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={2.5} y={7.5} width={19} height={9} rx={4.5} />
        <Path d="M8 10.5v3M6.5 12h3" />
      </G>
      <Circle cx={15.5} cy={11} r={1.1} fill={color} />
      <Circle cx={17.5} cy={13} r={1.1} fill={color} />
    </Svg>
  )
}

export function IconBrush({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M15.5 3.5l5 5L10 19c-1.4 1.4-3.6 1.4-5 0s-1.4-3.6 0-5z" />
        <Path d="M13 6l5 5" />
      </G>
    </Svg>
  )
}

export function IconActivity({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M3 12.5h3.5l2.5-6 4.5 11 2.5-5H21" />
      </G>
    </Svg>
  )
}

export function IconPlane({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M21 3.5L3 10.5l7 2.5 2.5 7z" />
        <Path d="M21 3.5L10 13" />
      </G>
    </Svg>
  )
}

export function IconFilm({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={3.5} y={5} width={17} height={14} rx={2} />
        <Path d="M8 5v14M16 5v14M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5" />
      </G>
    </Svg>
  )
}

export function IconBall({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={12} cy={12} r={8.25} />
        <Path d="M12 8.6l3.2 2.3-1.2 3.8h-4l-1.2-3.8z" />
        <Path d="M12 8.6V3.8M15.2 10.9l4.6-1.5M14 14.7l2.8 3.9M10 14.7l-2.8 3.9M8.8 10.9L4.2 9.4" />
      </G>
    </Svg>
  )
}

export function IconDumbbell({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={4.5} y={8} width={3} height={8} />
        <Rect x={16.5} y={8} width={3} height={8} />
        <Path d="M7.5 12h9M2.5 12h2M19.5 12h2" />
      </G>
    </Svg>
  )
}

export function IconMic({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={9.5} y={3} width={5} height={9.5} rx={2.5} />
        <Path d="M6.5 11.5a5.5 5.5 0 0011 0M12 17v3.5M9 20.5h6" />
      </G>
    </Svg>
  )
}

export function IconPiano({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={3.5} y={5.5} width={17} height={13} rx={1.5} />
        <Path d="M7.75 5.5V13M12 5.5V13M16.25 5.5V13" />
      </G>
    </Svg>
  )
}

export function IconHeadphones({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4.5 15.5V12a7.5 7.5 0 0115 0v3.5" />
        <Rect x={3.5} y={14} width={3.8} height={6} rx={1.6} />
        <Rect x={16.7} y={14} width={3.8} height={6} rx={1.6} />
      </G>
    </Svg>
  )
}

export function IconUtensils({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M7 20.5V3.5M4.8 3.5v4.7a2.2 2.2 0 004.4 0V3.5" />
        <Path d="M16.5 20.5V3.5a4 4 0 014 4V13h-4" />
      </G>
    </Svg>
  )
}

export function IconGlass({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4.5 4.5h15L12 12.5zM12 12.5v6M8.5 20.5h7" />
      </G>
    </Svg>
  )
}

export function IconCake({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4.5 20.5h15M5.5 20.5v-6.5a2 2 0 012-2h9a2 2 0 012 2v6.5" />
        <Path d="M5.5 16.5c1.5 1.4 2.9 1.4 4.3 0 1.5 1.4 2.9 1.4 4.3 0 1.5 1.4 2.9 1.4 4.3 0" />
        <Path d="M12 12V9.8M12 7.9c.9 0 1.6-.7 1.6-1.6 0-1.1-1.6-2.8-1.6-2.8s-1.6 1.7-1.6 2.8c0 .9.7 1.6 1.6 1.6z" />
      </G>
    </Svg>
  )
}

export function IconFire({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 3.5c3 3 5.5 5.9 5.5 9.3a5.5 5.5 0 01-11 0c0-3.4 2.5-6.3 5.5-9.3z" />
        <Path d="M12 11.5c1.3 1.3 2.2 2.4 2.2 3.7a2.2 2.2 0 01-4.4 0c0-1.3.9-2.4 2.2-3.7z" />
      </G>
    </Svg>
  )
}

export function IconTent({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 4.5L21.5 19.5H2.5z" />
        <Path d="M12 13l-3.8 6.5M12 13l3.8 6.5" />
      </G>
    </Svg>
  )
}

export function IconLeaf({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M5.5 18.5C5.5 10 11 4.5 19.5 4.5c0 8.5-5.5 14-14 14z" />
        <Path d="M5.5 18.5C8 13 11.5 9.5 15.5 7" />
      </G>
    </Svg>
  )
}

export function IconPaw({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 12.3c2.7 0 4.9 1.9 4.9 4.2a3.1 3.1 0 01-3.1 3.1c-.7 0-1.3-.2-1.8-.5-.5.3-1.1.5-1.8.5a3.1 3.1 0 01-3.1-3.1c0-2.3 2.2-4.2 4.9-4.2z" />
      </G>
      <Circle cx={7} cy={10} r={1.4} fill={color} />
      <Circle cx={12} cy={8.3} r={1.4} fill={color} />
      <Circle cx={17} cy={10} r={1.4} fill={color} />
    </Svg>
  )
}

export function IconDice({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={4.5} y={4.5} width={15} height={15} rx={3} />
      </G>
      <Circle cx={8.7} cy={8.7} r={1.2} fill={color} />
      <Circle cx={12} cy={12} r={1.2} fill={color} />
      <Circle cx={15.3} cy={15.3} r={1.2} fill={color} />
    </Svg>
  )
}

export function IconCode({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M8 7L3.5 12 8 17M16 7l4.5 5L16 17M13.5 4.5l-3 15" />
      </G>
    </Svg>
  )
}

export function IconChip({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={7} y={7} width={10} height={10} rx={1.5} />
        <Rect x={10.2} y={10.2} width={3.6} height={3.6} />
        <Path d="M9.5 7V3.5M14.5 7V3.5M9.5 20.5V17M14.5 20.5V17M7 9.5H3.5M7 14.5H3.5M20.5 9.5H17M20.5 14.5H17" />
      </G>
    </Svg>
  )
}

export function IconRocket({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 3.5c3.2 1.9 4.8 5.1 4.8 8.6l-2.3 2.4h-5l-2.3-2.4c0-3.5 1.6-6.7 4.8-8.6z" />
        <Circle cx={12} cy={9.5} r={1.8} />
        <Path d="M7.2 12.1l-2.6 3.6 3.4-.3M16.8 12.1l2.6 3.6-3.4-.3M12 14.5V19M10 14.5l-.8 3.5M14 14.5l.8 3.5" />
      </G>
    </Svg>
  )
}

export function IconChart({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4.5 4.5v15h15" />
        <Path d="M8.5 19.5V13M12.5 19.5V9M16.5 19.5v-5" />
      </G>
    </Svg>
  )
}

export function IconTv({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={3.5} y={7.5} width={17} height={12} rx={2} />
        <Path d="M8.5 3.5L12 7.5l3.5-4" />
      </G>
    </Svg>
  )
}

export function IconGlobe({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={12} cy={12} r={8.25} />
        <Path d="M3.75 12h16.5M12 3.75c2.3 2.4 3.6 5.1 3.6 8.25S14.3 17.85 12 20.25c-2.3-2.4-3.6-5.1-3.6-8.25S9.7 6.15 12 3.75z" />
      </G>
    </Svg>
  )
}

export function IconFlask({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M9.5 3.5h5M10.5 3.5v5.2l-4.9 8.8a2 2 0 001.8 3h9.2a2 2 0 001.8-3l-4.9-8.8V3.5" />
        <Path d="M7.5 15h9" />
      </G>
    </Svg>
  )
}

export function IconCar({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M5.5 12.5L7 8.4A2 2 0 018.9 7h6.2A2 2 0 0117 8.4l1.5 4.1M4.5 17.5h-1V14a1.5 1.5 0 011.5-1.5h14A1.5 1.5 0 0120.5 14v3.5h-1" />
        <Path d="M9.6 17.5h4.8" />
        <Circle cx={7.7} cy={17.5} r={1.8} />
        <Circle cx={16.3} cy={17.5} r={1.8} />
      </G>
    </Svg>
  )
}

export function IconBike({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={6.3} cy={15.7} r={3.4} />
        <Circle cx={17.7} cy={15.7} r={3.4} />
        <Path d="M6.3 15.7L9.7 9.3h4.9l3.1 6.4M9.7 9.3L12 15.7H6.3M14.6 9.3L12 15.7M14.6 9.3L13.8 7h-1.8" />
      </G>
    </Svg>
  )
}

export function IconTarget({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={12} cy={12} r={8.25} />
        <Circle cx={12} cy={12} r={4.4} />
      </G>
      <Circle cx={12} cy={12} r={1.3} fill={color} />
    </Svg>
  )
}

export function IconSnow({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
        <Path d="M9.8 4.4L12 6.6l2.2-2.2M9.8 19.6L12 17.4l2.2 2.2" />
      </G>
    </Svg>
  )
}

export function IconShirt({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M8.5 4.5L3.5 7.8l2 3.2 2-1.4v10h9v-10l2 1.4 2-3.2-5-3.3a3.5 3.5 0 01-7 0z" />
      </G>
    </Svg>
  )
}

export function IconWave({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M2.5 9.5c1.8-2.2 4.5-2.2 6.3 0 1.8 2.2 4.5 2.2 6.3 0 1.8-2.2 4.5-2.2 6.3 0" />
        <Path d="M2.5 15.5c1.8-2.2 4.5-2.2 6.3 0 1.8 2.2 4.5 2.2 6.3 0 1.8-2.2 4.5-2.2 6.3 0" />
      </G>
    </Svg>
  )
}

export function IconMask({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4.5 4.5h15v7.2a7.5 7.5 0 01-15 0z" />
        <Path d="M8.3 13a3.9 3.9 0 007.4 0" />
      </G>
      <Circle cx={9} cy={9} r={1.2} fill={color} />
      <Circle cx={15} cy={9} r={1.2} fill={color} />
    </Svg>
  )
}

export function IconScissors({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={6} cy={7} r={2.2} />
        <Circle cx={6} cy={17} r={2.2} />
        <Path d="M7.9 8.2L20 17M7.9 15.8L20 7" />
      </G>
    </Svg>
  )
}

// The three states of the map's locate control. They differ in shape, not just
// in tint, so "following" is still distinguishable when the teal is not — the
// centre fills in when tracking, and a slash marks it unavailable.
export function IconLocate({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={12} cy={12} r={4.25} />
        <Path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
      </G>
    </Svg>
  )
}

export function IconLocateFixed({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={12} cy={12} r={4.25} />
        <Path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
      </G>
      <Circle cx={12} cy={12} r={2} fill={color} />
    </Svg>
  )
}

export function IconLocateOff({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={12} cy={12} r={4.25} />
        <Path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
        {/* Same diagonal as IconEyeOff, so "off" reads the same way across
            the set rather than as a different gesture each time. */}
        <Path d="M5 19L19 5" />
      </G>
    </Svg>
  )
}

// Transport controls. Filled rather than stroked — at 20px a stroked triangle
// reads as an outline arrow, and these are the one place in the app where the
// glyph itself is the button.
export function IconPlay({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M8 4.8l11.5 7.2L8 19.2z" fill={color} />
    </Svg>
  )
}

export function IconPause({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={7} y={5} width={3.6} height={14} rx={1} fill={color} />
      <Rect x={13.4} y={5} width={3.6} height={14} rx={1} fill={color} />
    </Svg>
  )
}

/** Start over, not "previous track" — there is only ever one track. */
export function IconRestart({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4.5 12a7.5 7.5 0 107.5-7.5c-2.5 0-4.7 1.2-6.1 3" />
        <Path d="M3.4 3.6v4.4h4.4" />
      </G>
    </Svg>
  )
}

/**
 * A swift, for Swifts. Filled rather than stroked: at 18px on the nav arc a
 * hairline bird is a smudge, and the silhouette is the whole recognisability of
 * this one — scythe wings swept hard back, and the forked tail the bird is
 * named for. The old play-circle said "video player", which is the container,
 * not the thing.
 */
export function IconSwift({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G fill={color}>
        {/* Wings: long and swept hard back from the shoulder, tapering to a
            point. Wings raised in a V read as a gull; these trail. */}
        <Path d="M11.3 9.8C8.2 10.1 5.1 12.1 2.2 16c4-1.6 7-2.6 9.3-3Z" />
        <Path d="M12.7 9.8c3.1.3 6.2 2.3 9.1 6.2-4-1.6-7-2.6-9.3-3Z" />
        {/* Head, body and the fork it is named for, in one stroke. */}
        <Path d="M12 8.6c.95 0 1.6.8 1.48 1.75l-.88 6.9-.6-1.15-.6 1.15-.88-6.9C10.4 9.4 11.05 8.6 12 8.6Z" />
      </G>
    </Svg>
  )
}

export function IconUpload({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M12 16.5V4.5M7.5 9L12 4.5 16.5 9" />
        <Path d="M4.5 15v4.5h15V15" />
      </G>
    </Svg>
  )
}

// Backend serves emoji for interests; this maps interest names to the designed
// icon set instead (redesign rule 3 — no emoji anywhere). Grouped by icon and
// covering the full seed catalog (scripts/interests_seed.json) so nothing
// falls back to the star.
const INTEREST_ICON_GROUPS: [IconComponent, string[]][] = [
  [IconBall, [
    'football', 'soccer', 'futsal', 'basketball', 'american football', 'baseball',
    'softball', 'tennis', 'padel', 'squash', 'volleyball', 'beach volleyball',
    'netball', 'rugby', 'cricket', 'ice hockey', 'field hockey', 'lacrosse',
    'table tennis', 'pickleball', 'badminton', 'handball', 'golf', 'bowling',
    'billiards', 'water polo', 'ultimate frisbee', 'disc golf', 'sport', 'sports',
  
    'australian rules football',
    'gaelic football',
    'hurling',
    'floorball',
    'bandy',
    'korfball',
    'sepak takraw',
    'racquetball',
    'foosball',
    'air hockey',
    'dodgeball',
    'kickball',
    'longboarding',
    'scootering',
    'inline skating',
    'roller derby',
  ]],
  [IconActivity, [
    'boxing', 'kickboxing', 'mma', 'muay thai', 'karate', 'judo', 'taekwondo',
    'jiu-jitsu', 'wrestling', 'sumo', 'fencing', 'running', 'marathon',
    'trail running', 'track & field', 'walking', 'triathlon', 'gymnastics',
    'parkour', 'cheerleading', 'calisthenics', 'skateboarding', 'roller skating',
    'zumba', 'fitness',
  
    'kabaddi',
    'sprinting',
    'hurdles',
    'long jump',
    'high jump',
    'pole vault',
    'shot put',
    'javelin',
    'discus',
    'decathlon',
    'race walking',
    'cross country running',
    'ultramarathon',
    'obstacle racing',
    'kung fu',
    'aikido',
    'krav maga',
    'capoeira',
    'kendo',
    'sambo',
    'wing chun',
    'savate',
    'arm wrestling',
    'kyokushin',
    'tug of war',
  ]],
  [IconWave, [
    'swimming', 'diving', 'scuba diving', 'snorkeling', 'rowing', 'kayaking',
    'canoeing', 'paddleboarding', 'sailing', 'surfing', 'windsurfing',
    'wakeboarding', 'kitesurfing', 'jet skiing', 'fishing', 'beach', 'cruises',
    'aquariums',
  
    'freediving',
    'bodyboarding',
    'white water rafting',
    'canyoning',
    'cliff diving',
    'synchronised swimming',
    'open water swimming',
    'dragon boat racing',
    'powerboating',
    'rock fishing',
    'spearfishing',
    'aqua aerobics',
    'wild swimming',
    'kayak fishing',
    'fly fishing',
  ]],
  [IconBike, ['cycling', 'mountain biking', 'bmx',
    'road cycling',
    'track cycling',
    'gravel cycling',
    'cyclocross',
    'bikepacking',
    'unicycling',
    'cycling tours',
    'cycling commute',
  ]],
  [IconSnow, [
    'ice skating', 'figure skating', 'skiing', 'snowboarding', 'sledding',
    'curling', 'ice baths',
  
    'cross-country skiing',
    'ski touring',
    'freestyle skiing',
    'ski jumping',
    'biathlon',
    'ice climbing',
    'snowshoeing',
    'snowmobiling',
    'luge',
    'bobsleigh',
    'ice fishing',
  ]],
  [IconHiking, [
    'hiking', 'rock climbing', 'bouldering', 'mountaineering', 'backpacking',
    'national parks',
  
    'orienteering',
    'sport climbing',
    'trad climbing',
    'via ferrata',
    'slacklining',
    'caving',
    'waterfalls',
  ]],
  [IconPlane, [
    'travel', 'solo travel', 'adventure travel', 'train travel', 'aviation',
    'paragliding', 'skydiving',
  
    'hang gliding',
    'base jumping',
    'bungee jumping',
    'wingsuit flying',
    'hot air ballooning',
    'city breaks',
    'island hopping',
    'safari',
    'desert trips',
    'digital nomad life',
    'volunteer travel',
    'pilgrimage',
  ]],
  [IconCar, [
    'cars', 'motorsport', 'karting', 'motocross', 'motorcycles', 'car tuning',
    'off-roading', 'road trips', 'van life',
  
    'rally racing',
    'drifting',
    'drag racing',
    'formula 1',
    'enduro',
    'trial riding',
    'overlanding',
    'motorcycle touring',
    'vintage cars',
  ]],
  [IconDumbbell, ['gym', 'weightlifting', 'powerlifting', 'crossfit', 'bodybuilding',
    'mobility training',
    'foam rolling',
    'kettlebells',
    'trx training',
    'barre',
    'aerobics',
    'spinning',
    'hiit',
    'bootcamp training',
    'circuit training',
    'personal training',
    'marathon training',
  ]],
  [IconLeaf, [
    'yoga', 'pilates', 'meditation', 'massage & spa', 'veganism', 'vegetarian',
    'healthy eating', 'nutrition', 'gardening', 'houseplants', 'beekeeping',
    'farming', 'sustainability', 'flower arranging', 'fragrances', 'foraging',
  
    'stretching',
    'tai chi',
    'qigong',
    'breathwork',
    'mindfulness',
    'cold plunge',
    'acupuncture',
    'physiotherapy',
    'aromatherapy',
    'reiki',
    'sleep health',
    'intermittent fasting',
    'keto',
    'gluten-free',
    'mushroom picking',
    'composting',
    'permaculture',
    'bonsai',
    'terrariums',
    'succulents',
    'vegetable gardening',
    'urban gardening',
    'wildlife conservation',
    'zero waste',
    'recycling',
  ]],
  [IconInsight, ['self-improvement', 'philosophy', 'psychology', 'mathematics', 'trivia',
    'productivity',
    'note-taking',
    'politics',
    'sociology',
    'debate',
    'public speaking',
  ]],
  [IconMic, [
    'singing', 'karaoke', 'rapping', 'beatboxing', 'hip-hop', 'choir',
    'stand-up comedy', 'podcasts',
  
    'a cappella',
    'opera',
    'open mic',
    'voice acting',
    'podcasting',
    'poetry slams',
    'karaoke nights',
  ]],
  [IconPiano, ['piano', 'accordion',
    'synthesizer',
    'organ',
  ]],
  [IconHeadphones, ['djing', 'music production', 'electronic music', 'techno',
    'house music',
    'drum & bass',
    'lo-fi',
    'ambient music',
  ]],
  [IconMusic, [
    'music', 'guitar', 'bass guitar', 'ukulele', 'banjo', 'violin', 'cello',
    'drums', 'saxophone', 'trumpet', 'songwriting', 'rock', 'metal', 'jazz',
    'classical music', 'k-pop', 'country music', 'dancing', 'ballet',
    'hip-hop dance', 'breakdancing', 'salsa', 'tango',
  
    'flute',
    'clarinet',
    'oboe',
    'harp',
    'harmonica',
    'mandolin',
    'sitar',
    'tabla',
    'bagpipes',
    'trombone',
    'tuba',
    'french horn',
    'double bass',
    'music theory',
    'composing',
    'orchestra',
    'marching band',
    'blues',
    'reggae',
    'funk',
    'soul',
    'r&b',
    'punk',
    'indie music',
    'folk music',
    'latin music',
    'afrobeats',
  ]],
  [IconSound, ['concerts', 'music festivals',
    'vinyl collecting',
    'live music',
    'festivals',
  ]],
  [IconPencil, [
    'drawing', 'calligraphy', 'writing', 'poetry', 'journaling', 'blogging',
    'origami', 'architecture',
  
    'charcoal drawing',
    'sketching',
    'typography',
    'screenwriting',
    'storytelling',
  ]],
  [IconBrush, [
    'art', 'painting', 'digital art', 'graphic design', 'animation', 'sculpting',
    'pottery', 'makeup artistry', 'nail art', 'tattoos', 'diy & crafts',
    'woodworking', 'jewelry making', 'candle making', 'soap making',
    'interior design', 'lego building', 'model building',
  
    'watercolour',
    'oil painting',
    'acrylic painting',
    'illustration',
    'comic art',
    'concept art',
    'pixel art',
    '3d modelling',
    'motion graphics',
    'ui/ux design',
    'printmaking',
    'linocut',
    'screen printing',
    'glassblowing',
    'ceramics',
    'mosaic',
    'resin art',
    'street art',
    'graffiti',
    'face painting',
    'contemporary dance',
    'jazz dance',
    'tap dance',
    'folk dance',
    'belly dance',
    'pole dance',
    'swing dance',
    'bachata',
    'kizomba',
    'flamenco',
    'miniature painting',
    'home decor',
  ]],
  [IconScissors, [
    'sewing', 'knitting', 'crochet', 'embroidery', 'fashion design', 'scrapbooking',
  
    'macrame',
    'quilting',
    'weaving',
    'leatherworking',
    'bookbinding',
    'paper craft',
    'barbering',
    'hairdressing',
  ]],
  [IconCamera, ['photography', 'photo',
    'food photography',
    'nature photography',
    'modelling',
    'content creation',
    'vlogging',
  ]],
  [IconFilm, [
    'film', 'movies', 'cinema', 'filmmaking', 'videography', 'documentaries', 'anime',
  
    'thrillers',
    'film festivals',
    'indie films',
    'classic films',
    'bollywood',
  ]],
  [IconMask, [
    'theater', 'improv', 'cosplay', 'magic tricks', 'juggling', 'circus arts',
  
    'puppetry',
    'musicals',
    'theatre trips',
  ]],
  [IconUtensils, [
    'cooking', 'foodie', 'fine dining', 'street food', 'sushi', 'pizza',
    'burgers', 'ramen', 'brunch', 'cheese', 'picnics',
  
    'meal prep',
    'fermentation',
    'pickling',
    'cheesemaking',
    'charcuterie',
    'pasta making',
    'dim sum',
    'dumplings',
    'tacos',
    'curry',
    'kebab',
    'seafood',
    'steak',
    'noodles',
    'salads',
    'soups',
    'food trucks',
    'farmers markets',
  ]],
  [IconCake, ['baking', 'bread making', 'desserts', 'chocolate', 'ice cream',
    'pastry',
    'cake decorating',
    'baking sourdough',
  ]],
  [IconFire, ['bbq & grilling', 'sauna']],
  [IconCoffee, ['coffee', 'tea', 'bubble tea', 'smoothies',
    'espresso',
    'latte art',
    'matcha',
  ]],
  [IconGlass, ['wine tasting', 'craft beer', 'cocktails', 'nightlife',
    'home brewing',
    'winemaking',
    'mixology',
    'whisky',
    'gin',
    'sake',
    'clubbing',
    'bar hopping',
  ]],
  [IconTent, ['camping',
    'hot springs',
    'glamping',
  ]],
  [IconPin, ['geocaching']],
  [IconStar, ['stargazing', 'astronomy', 'astrology']],
  [IconRocket, ['space exploration', 'sci-fi', 'startups', 'entrepreneurship']],
  [IconEye, ['birdwatching', 'tarot',
    'wildlife watching',
    'whale watching',
  ]],
  [IconGamepad, [
    'gaming', 'games', 'retro gaming', 'vr gaming', 'game development', 'esports',
  
    'console gaming',
    'mobile gaming',
    'mmorpgs',
    'fps games',
    'strategy games',
    'simulation games',
    'speedrunning',
    'game modding',
    'minecraft',
  ]],
  [IconDice, [
    'board games', 'card games', 'poker', 'chess', 'puzzles', 'mahjong',
    'd&d & tabletop rpgs', 'trading cards', 'escape rooms',
  
    'sudoku',
    'crosswords',
    "rubik's cube",
    'jigsaw puzzles',
    'backgammon',
    'go',
    'shogi',
    'checkers',
    'dominoes',
    'warhammer',
    'magic: the gathering',
    'chess puzzles',
    'board game nights',
  ]],
  [IconCode, ['coding', 'web development',
    'open source',
    'linux',
    'app development',
  ]],
  [IconChip, [
    'ai & machine learning', 'robotics', 'pc building', '3d printing',
    'electronics', 'drones',
  
    'cloud computing',
    'automation',
    'smart home',
    'raspberry pi',
    'arduino',
    'ham radio',
    'retro computing',
  ]],
  [IconShield, ['cybersecurity']],
  [IconChart, ['crypto', 'investing', 'personal finance', 'coin collecting',
    'data science',
    'blockchain',
    'trading',
    'real estate',
    'economics',
  ]],
  [IconTv, ['tv series', 'streaming',
    'reality tv',
    'sitcoms',
    'korean drama',
  ]],
  [IconGlobe, ['languages',
    'language exchange',
    'linguistics',
  ]],
  [IconFlask, ['science',
    'physics',
    'chemistry',
    'biology',
    'geology',
    'meteorology',
  ]],
  [IconBook, ['books', 'reading', 'manga', 'comics', 'history', 'fantasy',
    'audiobooks',
    'book clubs',
    'libraries',
    'mythology',
    'religion',
  ]],
  [IconSearch, ['true crime', 'antiques',
    'archaeology',
    'anthropology',
    'paleontology',
    'ancient history',
  ]],
  [IconGhost, ['horror']],
  [IconImage, ['museums & galleries',
    'art history',
  ]],
  [IconPaw, [
    'dogs', 'cats', 'pets', 'horses', 'horse riding', 'polo', 'reptiles',
  
    'rodeo',
    'show jumping',
    'dressage',
    'birds',
    'rabbits',
    'hamsters',
    'guinea pigs',
    'dog training',
    'animal rescue',
  ]],
  [IconHeart, ['volunteering', 'skincare',
    'minimalism',
    'organising',
    'perfume',
    'haircare',
    'charity',
  ]],
  [IconShirt, ['fashion', 'thrifting', 'sneakers', 'streetwear', 'vintage fashion',
    'sneaker collecting',
  ]],
  [IconTarget, ['darts', 'archery', 'watches',
    'snooker',
    'pool',
    'cornhole',
    'shuffleboard',
    'petanque',
    'bocce',
    'lawn bowls',
    'croquet',
    'horseshoes',
    'axe throwing',
    'shooting sports',
    'clay shooting',
    'paintball',
    'airsoft',
    'laser tag',
    'watch collecting',
  ]],
  [IconMail, ['stamp collecting']],
  [IconPeople, ['genealogy',
    'networking',
    'mentoring',
    'community building',
    'activism',
    'meetups',
  ]],
]

const INTEREST_ICONS: Record<string, IconComponent> = {}
for (const [icon, names] of INTEREST_ICON_GROUPS) {
  for (const n of names) INTEREST_ICONS[n] = icon
}

// Loose keyword match so future backend interests still get a sensible icon.
const KEYWORD_ICONS: [string, IconComponent][] = [
  ['music', IconMusic],
  ['dance', IconMusic],
  ['gam', IconGamepad],
  ['food', IconUtensils],
  ['cook', IconUtensils],
  ['ball', IconBall],
  ['travel', IconPlane],
  ['design', IconBrush],
  ['tech', IconChip],
  ['sport', IconBall],
]

export function iconForInterest(name: string): IconComponent {
  const key = name.trim().toLowerCase()
  const exact = INTEREST_ICONS[key]
  if (exact) return exact
  const keyword = KEYWORD_ICONS.find(([word]) => key.includes(word))
  return keyword ? keyword[1] : IconStar
}

/**
 * Icon for an interest chip.
 *
 * The backend ships an emoji with every curated interest, so that is the first
 * choice and the common case. The SVG set is the fallback, which matters for
 * interests stored before the "Other" flow was removed: those were saved with
 * no emoji, and without this they would render as a blank chip.
 */
export function InterestChipIcon({ name, icon }: { name: string; icon?: string }) {
  if (icon) return <Text style={interestChipStyles.emoji}>{icon}</Text>
  const Icon = iconForInterest(name)
  return <Icon size={16} color={colors.t2} />
}

const interestChipStyles = StyleSheet.create({
  emoji: { fontSize: 15 },
})
