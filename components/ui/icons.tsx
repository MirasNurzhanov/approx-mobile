import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg'

import { lightColors as colors } from '@/constants/theme'

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

export function IconCalendar({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={3.5} y={4.5} width={17} height={16} rx={1.5} />
        <Path d="M3.5 9.5h17M8.5 4.5V2.5M15.5 4.5V2.5" />
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

export function IconHeart({ size = 24, color = colors.t2, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke} fill={filled ? color : 'none'}>
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

/** The wheel nav, drawn small: the speedometer arc with its needle. Used by the
 *  Settings row that turns it on, so the row shows what it switches to. */
export function IconGauge({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M3.75 16.75A8.25 8.25 0 0 1 20.25 16.75" />
        <Line x1={12} y1={16.75} x2={15.9} y2={11.4} />
      </G>
      <Circle cx={12} cy={16.75} r={1.4} fill={color} />
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

export function IconSun({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Circle cx={12} cy={12} r={4.25} />
        <Line x1={12} y1={2.5} x2={12} y2={4.5} stroke={color} strokeWidth={1.5} strokeLinecap="square" />
        <Line x1={12} y1={19.5} x2={12} y2={21.5} stroke={color} strokeWidth={1.5} strokeLinecap="square" />
        <Line x1={2.5} y1={12} x2={4.5} y2={12} stroke={color} strokeWidth={1.5} strokeLinecap="square" />
        <Line x1={19.5} y1={12} x2={21.5} y2={12} stroke={color} strokeWidth={1.5} strokeLinecap="square" />
        <Line x1={5.6} y1={5.6} x2={7} y2={7} stroke={color} strokeWidth={1.5} strokeLinecap="square" />
        <Line x1={17} y1={17} x2={18.4} y2={18.4} stroke={color} strokeWidth={1.5} strokeLinecap="square" />
        <Line x1={5.6} y1={18.4} x2={7} y2={17} stroke={color} strokeWidth={1.5} strokeLinecap="square" />
        <Line x1={17} y1={7} x2={18.4} y2={5.6} stroke={color} strokeWidth={1.5} strokeLinecap="square" />
      </G>
    </Svg>
  )
}

export function IconMoon({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M21 12.8a9 9 0 01-9.8 9A9 9 0 0111.2 3 7 7 0 0021 12.8z" />
      </G>
    </Svg>
  )
}

// ── Swift composer ──────────────────────────────────────────────────────────
// Drawn for the capture and edit screens. Same 24px grid, 1.5px stroke and
// squared terminals as everything above, so the camera chrome reads as Approx's
// rather than as a stock camera kit dropped into it.

export function IconFlash({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M13 2.5L5.5 13.5h5l-1 8L18 10.5h-5z" />
      </G>
    </Svg>
  )
}

export function IconFlashOff({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M13 2.5L5.5 13.5h5l-1 8L18 10.5h-5z" />
        <Path d="M3.5 3.5l17 17" />
      </G>
    </Svg>
  )
}

export function IconCameraFlip({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4 8.5h3l1.5-2.5h7L17 8.5h3v11H4z" />
        <Path d="M9.5 13.5a2.5 2.5 0 014.6-1.4M14.5 15a2.5 2.5 0 01-4.6 1.4" />
        <Path d="M14.6 10.4v1.8h-1.8M9.4 18.1v-1.8h1.8" />
      </G>
    </Svg>
  )
}

export function IconText({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />
      </G>
    </Svg>
  )
}

export function IconFrame({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Rect x={3.5} y={5.5} width={17} height={13} rx={1.5} />
        <Path d="M8 5.5v13M16 5.5v13" />
      </G>
    </Svg>
  )
}

export function IconVolume({ size = 24, color = colors.t2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color} {...stroke}>
        <Path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4zM15.5 9.7a3.2 3.2 0 010 4.6" />
      </G>
    </Svg>
  )
}
