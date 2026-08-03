export type ColorPalette = {
  bg: string; surface: string; surface2: string; border: string;
  t1: string; t2: string; t3: string;
  teal: string; tealTint: string; tealLine: string;
  purple: string; blue: string; orange: string; red: string; green: string;
  coral: string; coralSoft: string; violet: string;
}

export const colors: ColorPalette = {
  bg: '#0A0A0B',
  surface: '#141417',
  surface2: '#1C1C21',
  border: '#28282E',
  t1: '#F4F4F6',
  t2: '#9C9CA6',
  t3: '#5E5E68',
  teal: '#1FC7B6',
  tealTint: '#0E2421',
  tealLine: '#17564F',
  purple: '#8B5CF6',
  blue: '#4D8DFF',
  orange: '#F97316',
  red: '#E5484D',
  // Presence. Deliberately not `teal`: teal means "selected / active control"
  // everywhere else, and reusing it for "this person is online" would make two
  // unrelated states look identical. Never the only cue — see PresenceDot.
  green: '#30D158',
  // Aliases so dark and light palettes share the same type.
  coral: '#1FC7B6',
  coralSoft: '#0E2421',
  violet: '#8B5CF6',
}

export const lightColors: ColorPalette = {
  bg: '#faf9f5',
  surface: '#ffffff',
  surface2: '#FCEEE8',
  border: '#E8E4DA',
  t1: '#2D2A22',
  t2: '#6B6455',
  t3: '#8C8475',
  // Coral fills the primary-accent slot that teal holds in dark mode.
  teal: '#E8714A',
  tealTint: '#FCEEE8',
  tealLine: '#F0C4AE',
  purple: '#8B6FD4',
  blue: '#4D8DFF',
  orange: '#F97316',
  red: '#E5484D',
  green: '#3DAE6E',
  coral: '#E8714A',
  coralSoft: '#FCEEE8',
  violet: '#8B6FD4',
}

// Legacy light/dark palette kept for the Expo template components
// (themed-text, themed-view, collapsible) that still call useThemeColor.
export const Colors = {
  light: {
    text: '#11181C',
    background: '#FFFFFF',
    tint: colors.teal,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: colors.teal,
  },
  dark: {
    text: colors.t1,
    background: colors.bg,
    tint: colors.teal,
    icon: colors.t2,
    tabIconDefault: colors.t3,
    tabIconSelected: colors.teal,
  },
}

export const radius = { s: 6, m: 12, l: 20 }

export const fonts = { display: 'SpaceGrotesk', body: 'Inter' }

// Type scale.
//
// React Native's <Text> already honours the OS font-size setting — the default
// allowFontScaling is true and nothing in this app turns it off — so these are
// base sizes that grow with Dynamic Type, not fixed pixels. The reason to name
// them is the floor: nothing below `micro` (11) is legible, and the 8pt labels
// in the old bottom nav were well under it.
//
// Never set allowFontScaling={false} to stop text overflowing. Where a layout
// genuinely cannot grow — text on a fixed-geometry arc, a badge — cap the
// growth with maxFontSizeMultiplier instead, so the text still scales, just
// not unboundedly.
export const type = {
  /** Absolute floor. Badges, dense nav labels. */
  micro: 11,
  /** Timestamps, meta. */
  caption: 12,
  /** Secondary rows, hints. */
  small: 13,
  /** Default body. */
  body: 15,
  /** Card and sheet titles. */
  title: 22,
  /** Screen titles. */
  display: 26,
}

/** Cap for text inside fixed-geometry containers that cannot reflow. Text
 * still scales up to this multiple of the base size, then stops. */
export const MAX_SCALE_FIXED = 1.4

/**
 * A palette colour at partial opacity.
 *
 * Exists because map overlays need `rgba()` strings and the palette is hex, so
 * every translucent ring on the map used to be a hand-written literal — which
 * meant it was pinned to whichever theme the author happened to be looking at.
 * The dark teal `rgba(31,199,182,…)` written that way for other people's music
 * zones stayed teal in light mode, where the palette's own `teal` is a strong
 * orange, and a faint teal ring on a near-white basemap is invisible.
 *
 * Take the colour from `colors.*` and the opacity from here, and a ring cannot
 * fall out of step with its theme again.
 */
/**
 * Ring colours for other people's music zones, one per person.
 *
 * With every zone drawn in the same colour, two friends broadcasting near each
 * other are two identical circles and a pair of identical labels — you can see
 * that somebody's music reaches here, but not whose. A stable colour per person
 * makes a ring identifiable at a glance, and ties it to the chip that names it.
 *
 * Not `AVATAR_COLORS`: those are backgrounds for a letter tile, deliberately
 * pale so dark text sits on them. Painted as a 1.5 px line over a near-white
 * basemap they would be the invisible-teal bug again. Every colour here is held
 * to mid luminance — roughly 0.45–0.62 — which is the band that survives both a
 * white map and a near-black one, and they are spread around the hue circle so
 * neighbours are told apart by hue rather than by shade.
 *
 * Purple is deliberately absent: it means "yours" everywhere else on the map.
 */
export const ZONE_RING_COLORS = [
  '#E8714A', // orange
  '#4D8DFF', // blue
  '#E0567F', // rose
  '#12A594', // teal
  '#C9932E', // amber
  '#5EA83C', // green
]

/**
 * The ring colour for a given person. Stable across sessions and devices,
 * because it is derived from the name rather than from load order — a friend
 * whose ring was blue an hour ago is still blue.
 */
export function zoneRingColor(username: string): string {
  let hash = 0
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + (hash << 5) - hash
  }
  return ZONE_RING_COLORS[Math.abs(hash) % ZONE_RING_COLORS.length]
}

export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3
    ? value.split('').map((c) => c + c).join('')
    : value;
  const int = parseInt(full, 16);
  if (Number.isNaN(int) || full.length !== 6) return hex;
  return `rgba(${(int >> 16) & 255},${(int >> 8) & 255},${int & 255},${alpha})`;
}
