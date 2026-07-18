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

// Backend serves emoji for interests; this maps interest names to the designed
// icon set instead (redesign rule 3 — no emoji anywhere).
const INTEREST_ICONS: Record<string, IconComponent> = {
  music: IconMusic,
  hiking: IconHiking,
  coffee: IconCoffee,
  photography: IconCamera,
  photo: IconCamera,
  books: IconBook,
  reading: IconBook,
  gaming: IconGamepad,
  games: IconGamepad,
  art: IconBrush,
  running: IconActivity,
  fitness: IconActivity,
  sport: IconActivity,
  sports: IconActivity,
  travel: IconPlane,
  film: IconFilm,
  movies: IconFilm,
  cinema: IconFilm,
  football: IconBall,
  soccer: IconBall,
}

export function iconForInterest(name: string): IconComponent {
  return INTEREST_ICONS[name.trim().toLowerCase()] ?? IconStar
}
