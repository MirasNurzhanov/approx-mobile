import Svg, { Circle, G, Path, Rect } from 'react-native-svg'

/**
 * The Swift action rail's own icons.
 *
 * Drawn for this app, in vector paths, with no icon-pack dependency. The rail
 * sits over arbitrary user video where a stock glyph reads as borrowed
 * furniture — and these need something the packs do not offer anyway: a
 * genuine two-state design per action, where the "on" state is a different
 * drawing rather than the same outline in red.
 *
 * ## Why these live here and not in `components/ui/icons.tsx`
 *
 * That file is the app's 24px chrome set: single weight, single colour, one
 * shape per idea. These are a different instrument — 32px grid, heavier 2px
 * stroke so they hold up over moving video, and each one carries an `on` prop
 * that swaps to a filled counterpart. Mixing the two would mean either
 * thickening the chrome set or thinning these, and neither reads well at the
 * other's size. A separate module also keeps each file's Fast Refresh boundary
 * intact, the same reason `navSections` and `interestIcons` are split out.
 *
 * ## The drawing rules, so a fifth icon matches the four
 *
 *   * 32×32 viewBox, 2px stroke, **squared** caps and mitred joins — the same
 *     terminals the chrome set uses, scaled up. Rounded caps are what make an
 *     icon look like everybody else's.
 *   * Filled states are the *same silhouette* solid, never a second shape, so
 *     the toggle reads as one object changing rather than two icons swapping.
 *   * Nothing is drawn thinner than 1.5px at 32, because the rail is white on
 *     video and a hairline disappears over a bright frame.
 *   * Optical weight is matched by area, not by bounding box: the repost cycle
 *     is wider than the heart is tall, and both are drawn to fill about the
 *     same amount of ink.
 */

export interface SwiftIconProps {
  /** Rendered size in points. Scales cleanly — these are paths, not bitmaps. */
  size?: number
  color?: string
  /** The engaged state: liked, reposted, revealed. */
  on?: boolean
  /** Colour for the engaged state. Falls back to `color`. */
  onColor?: string
}

export type SwiftIconComponent = (props: SwiftIconProps) => React.JSX.Element

const stroke = {
  strokeWidth: 2,
  strokeLinecap: 'square',
  strokeLinejoin: 'miter',
  fill: 'none',
} as const

/**
 * Like.
 *
 * A heart built from two arcs meeting at a mitred point rather than the usual
 * rounded cusp — the same squared-terminal language as the rest of Approx's
 * icons, which is what stops it reading as the generic social heart.
 */
export function SwiftLikeIcon({
  size = 28, color = '#FFFFFF', on = false, onColor,
}: SwiftIconProps) {
  const tint = on ? (onColor ?? color) : color
  const d = 'M16 27.5 5.5 17.4a6.6 6.6 0 0 1 0-9.3 6.4 6.4 0 0 1 9.1 0L16 9.6l1.4-1.5a6.4 6.4 0 0 1 9.1 0 6.6 6.6 0 0 1 0 9.3z'
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path d={d} {...stroke} stroke={tint} fill={on ? tint : 'none'} />
    </Svg>
  )
}

/**
 * Comment.
 *
 * A squared bubble with a mitred tail, not the rounded oval every pack ships.
 * Two lines inside stand for a conversation; they vanish in the filled state,
 * where the silhouette alone carries it.
 */
export function SwiftCommentIcon({
  size = 28, color = '#FFFFFF', on = false, onColor,
}: SwiftIconProps) {
  const tint = on ? (onColor ?? color) : color
  const bubble = 'M4.5 6.5h23v15h-13l-6.5 5.5v-5.5h-3.5z'
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path d={bubble} {...stroke} stroke={tint} fill={on ? tint : 'none'} />
      {!on && (
        <G stroke={tint} {...stroke} strokeWidth={2}>
          <Path d="M10 12h12M10 16.5h8" />
        </G>
      )}
    </Svg>
  )
}

/**
 * Save.
 *
 * A bookmark with a mitred notch rather than the rounded pennant most packs
 * ship — the same squared-terminal language as the heart and the bubble, so
 * the rail reads as one set.
 *
 * A bookmark and not a star, deliberately. A star is already this app's
 * language for a shortlist of your *own* posts (see starred stories). This
 * shelf holds other people's videos, and at 28pt the two would be mistaken
 * for each other.
 */
export function SwiftSaveIcon({
  size = 28, color = '#FFFFFF', on = false, onColor,
}: SwiftIconProps) {
  const tint = on ? (onColor ?? color) : color
  const d = 'M8 4.5h16v23l-8-6.5-8 6.5z'
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path d={d} {...stroke} stroke={tint} fill={on ? tint : 'none'} />
    </Svg>
  )
}

/**
 * Repost.
 *
 * Two straight runs joined by square corners with mitred arrowheads — a
 * rectangular cycle rather than the two curved arrows the packs use. The
 * angularity is the point: it matches the app and it distinguishes a repost
 * from a generic "share".
 */
export function SwiftRepostIcon({
  size = 28, color = '#FFFFFF', on = false, onColor,
}: SwiftIconProps) {
  const tint = on ? (onColor ?? color) : color
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <G stroke={tint} {...stroke}>
        {/* Top run, travelling right, turning down at the end. */}
        <Path d="M6.5 12.5V9h19v6.5" />
        <Path d="M22 12l3.5 3.5L29 12" />
        {/* Bottom run, travelling left, turning up. */}
        <Path d="M25.5 19.5V23h-19v-6.5" />
        <Path d="M10 20l-3.5-3.5L3 20" />
      </G>
    </Svg>
  )
}

/**
 * Reveal location.
 *
 * A pin with a signal arc rising off it — "there is a place here to ask about"
 * rather than "here is the place", which is exactly the distinction the
 * feature turns on. The revealed state fills the pin and drops the arc: the
 * question has been answered, so the thing that meant *asking* goes away.
 *
 * Deliberately not the plain map pin the chrome set already has
 * (`IconPin`): that one means "a location", and this one means "a location you
 * may request". Using the same glyph for both would make the rail's button
 * look like a label.
 */
export function SwiftLocationIcon({
  size = 28, color = '#FFFFFF', on = false, onColor,
}: SwiftIconProps) {
  const tint = on ? (onColor ?? color) : color
  const pin = 'M16 28.5S6.5 20.6 6.5 14a9.5 9.5 0 0 1 19 0c0 6.6-9.5 14.5-9.5 14.5z'
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path d={pin} {...stroke} stroke={tint} fill={on ? tint : 'none'} />
      {on ? (
        // Answered: a solid pin with the ground point knocked out, so the
        // filled shape still reads as a pin rather than as a blob.
        <Circle cx={16} cy={13.5} r={3} fill="#00000055" stroke="none" />
      ) : (
        <>
          <Circle cx={16} cy={13.5} r={3} stroke={tint} {...stroke} />
          {/* The ask: a signal arc leaving the pin. */}
          <Path
            d="M23.5 6.2a10.6 10.6 0 0 1 2.4 3.1"
            stroke={tint}
            strokeWidth={2}
            strokeLinecap="square"
            fill="none"
          />
        </>
      )}
    </Svg>
  )
}

/** Sound on. Squared speaker with two emission arcs. */
export function SwiftSoundIcon({ size = 28, color = '#FFFFFF' }: SwiftIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <G stroke={color} {...stroke}>
        <Path d="M5 12.5h5l6-5v17l-6-5H5z" />
        <Path d="M20.5 12.5a5 5 0 0 1 0 7M24 9a10 10 0 0 1 0 14" />
      </G>
    </Svg>
  )
}

/** Sound off. The same speaker, struck through — one object in two states. */
export function SwiftMuteIcon({ size = 28, color = '#FFFFFF' }: SwiftIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <G stroke={color} {...stroke}>
        <Path d="M5 12.5h5l6-5v17l-6-5H5z" />
        <Path d="M21 13l7 6M28 13l-7 6" />
      </G>
    </Svg>
  )
}

/** More. Three squares rather than three circles, matching the family. */
export function SwiftMoreIcon({ size = 28, color = '#FFFFFF' }: SwiftIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <G fill={color}>
        <Rect x={4} y={14} width={4} height={4} />
        <Rect x={14} y={14} width={4} height={4} />
        <Rect x={24} y={14} width={4} height={4} />
      </G>
    </Svg>
  )
}

/**
 * The double-tap burst.
 *
 * A filled heart with no stroke — it is a flash of feedback at 96px, not an
 * icon, and an outline at that size reads as a shape rather than a gesture.
 */
export function SwiftBurstIcon({ size = 96, color = '#FFFFFF' }: SwiftIconProps) {
  const d = 'M16 27.5 5.5 17.4a6.6 6.6 0 0 1 0-9.3 6.4 6.4 0 0 1 9.1 0L16 9.6l1.4-1.5a6.4 6.4 0 0 1 9.1 0 6.6 6.6 0 0 1 0 9.3z'
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path d={d} fill={color} />
    </Svg>
  )
}

/** Playback resumed indicator, shown while a Swift is tap-paused. */
export function SwiftPlayIcon({ size = 64, color = 'rgba(255,255,255,0.9)' }: SwiftIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path d="M9 5.5l18 10.5-18 10.5z" fill={color} />
    </Svg>
  )
}

/** The audio credit's mark, at caption size. */
export function SwiftAudioIcon({ size = 14, color = '#FFFFFF' }: SwiftIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <G stroke={color} strokeWidth={2.5} strokeLinecap="square" fill="none">
        <Path d="M12 24V7l14-3v17" />
      </G>
      <G fill={color}>
        <Rect x={5} y={20} width={8} height={7} rx={1} />
        <Rect x={19} y={17} width={8} height={7} rx={1} />
      </G>
    </Svg>
  )
}

/** Compose. A plain cross on the same grid — squared terminals, 2px. */
export function SwiftPlusIcon({ size = 22, color = '#FFFFFF' }: SwiftIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <G stroke={color} {...stroke} strokeWidth={2.5}>
        <Path d="M16 6v20M6 16h20" />
      </G>
    </Svg>
  )
}

/** Nothing to show. A hollow frame with a diagonal — used for empty and
 *  error states, where a repurposed action icon would read as a control. */
export function SwiftEmptyIcon({ size = 32, color = '#FFFFFF' }: SwiftIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <G stroke={color} {...stroke}>
        <Rect x={4.5} y={6.5} width={23} height={19} />
        <Path d="M4.5 6.5l23 19" />
      </G>
    </Svg>
  )
}

/** A paper plane: send this Swift to somebody privately.
 *
 *  Its own glyph rather than `IconSend` from the design library, for the
 *  reason stated at the top of `SwiftActions`: the rail sits over arbitrary
 *  user video and needs a heavier stroke than a 1.5px UI icon to stay legible
 *  against a bright frame. */
export function SwiftSendIcon({ size = 28, color = '#FFFFFF' }: SwiftIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 3.5L10.5 14M21 3.5l-6.7 17.4-3.8-7.3-7.3-3.8L21 3.5z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  )
}
