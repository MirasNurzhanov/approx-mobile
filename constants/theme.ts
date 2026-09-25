export type ColorPalette = {
  bg: string; surface: string; surface2: string; border: string;
  t1: string; t2: string; t3: string;
  teal: string; tealTint: string; tealLine: string;
  purple: string; blue: string; orange: string; red: string; green: string;
  coral: string; coralSoft: string; violet: string;
  // Bottom navigation. Deliberately its own set rather than reusing `teal` /
  // `surface`: the nav is the one piece of chrome present on every screen, and
  // it is held to a two-colour scheme of its own — orange on white in light
  // mode, white on black in dark — so it reads as a fixed frame around the app
  // rather than as another surface that shifts with the accent.
  navBg: string; navActive: string; navOnActive: string;
  navInactive: string; navBorder: string;
  /** Fill of an *unselected* wheel wedge. Its own token, and opaque, because
   *  the wheel is a stack of SVG paths over the arc's background — a
   *  translucent fill there reads as a grey wash over what should be a clean
   *  white dial. Light mode wants it identical to `navBg`, so the wedges are
   *  told apart by their `navBorder` seam alone. */
  navWedge: string;
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
  // Dark mode's nav is black and white.
  navBg: '#0A0A0B',
  navActive: '#FFFFFF',
  navOnActive: '#0A0A0B',
  // t2, not t3: at 11pt on near-black, t3 (#5E5E68) is 3.1:1 and fails AA.
  navInactive: '#9C9CA6',
  navBorder: '#2A2A31',
  // The opaque equivalent of the 12%-navInactive wash the wedges used to carry
  // — same colour on screen, no alpha. Dark mode keeps the faint lift; it is
  // light mode that wanted a flat white dial.
  navWedge: '#1C1C21',
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
  // Light mode's nav is orange on white: a flat white ground, grey for what is
  // not selected, orange for what is. It was greyscale for a stretch, on the
  // argument that the one piece of chrome on every screen should stay a frame
  // rather than a second accent — but grey-on-white gave the selected item
  // nothing to say with, so the orange is back.
  navBg: '#FFFFFF',
  // The palette's `orange` (#F97316) darkened until it clears AA as *text*.
  // This value has to work in both directions at once — it is the label and
  // tint colour on a white bar, and the pill/wedge fill under a white glyph —
  // and both are the same ratio, so one number settles it. #F97316 itself is
  // 2.80:1 and misses even the 3:1 graphical floor; this is 4.59:1, the most
  // saturated orange at this hue that clears 4.5. Do not brighten it without
  // re-checking the tab label, which is 11pt and gets no large-text exemption.
  navActive: '#C75000',
  navOnActive: '#FFFFFF',
  // A neutral grey rather than the palette's warm `t2` (#6B6455), which read as
  // a muddy brown next to the others. Not iOS's own #8E8E93 either, which is
  // 3.3:1 on white and misses AA at tab-label sizes. This is 5.05:1.
  navInactive: '#6E6E76',
  navBorder: '#E8E4DA',
  // Same white as `navBg`, deliberately: an unselected wedge is not a shape of
  // its own, it is the dial. The `navBorder` seam between wedges is the whole
  // of what separates them, which is what keeps the one orange wedge the only
  // thing on the arc with a colour.
  navWedge: '#FFFFFF',
}

// ─── Palette themes ───────────────────────────────────────────────────────────
// Four more light themes, each built from a five-or-fewer colour palette. The
// palette's own hexes go where they read — canvas, body text, accent, tints —
// and the working tokens around them (secondary text, borders, the nav's
// selected colour) are derived from the same hue until they clear the same
// contrast the light theme is held to. services/__tests__/themes.test.ts and
// navPalette.test.ts check every theme in THEMES, these included.
//
// `purple`, `blue`, `orange`, `red` and `green` keep their meanings across all
// of them — "yours", "friend", "connected", destructive, online — so a palette
// only moves one of those where it has a colour that says the same thing.

/** Forest and sage greens, sand, a terracotta accent, on cream. */
export const sageColors: ColorPalette = {
  bg: '#F8F6EE',
  surface: '#FFFFFF',
  surface2: '#EFE9DD',
  border: '#E4DCCD',
  t1: '#2E3A2F',
  t2: '#5A6453',
  t3: '#7C8377',
  teal: '#6B7F5B',
  tealTint: '#E9EEE3',
  tealLine: '#C3CDB6',
  purple: '#8B6FD4',
  blue: '#4D8DFF',
  // Terracotta stands in for "connected": still an orange, and at 3.58:1 on
  // white it reads better as text than the light theme's own #F97316 (2.80:1).
  orange: '#C96F4F',
  red: '#E5484D',
  green: '#3DAE6E',
  coral: '#6B7F5B',
  coralSoft: '#E9EEE3',
  violet: '#8B6FD4',
  navBg: '#FFFFFF',
  // Sage itself is 4.36:1 on white, just under what the 11pt tab label needs;
  // the palette's forest green is the same hue with room to spare.
  navActive: '#2E3A2F',
  navOnActive: '#FFFFFF',
  navInactive: '#6A6F65',
  navBorder: '#E4DCCD',
  navWedge: '#FFFFFF',
}

/** Deep navy on ice blue, with sky and aqua. */
export const lagoonColors: ColorPalette = {
  bg: '#E8F6FF',
  surface: '#FFFFFF',
  surface2: '#DCEFFD',
  border: '#C9E2F4',
  t1: '#0D2240',
  t2: '#44607E',
  t3: '#657F9A',
  // Navy, not the sky blue: #3BA7F2 is 2.63:1 on white and would put every
  // primary button's label below legibility. Sky and aqua carry the tints.
  teal: '#0B3D91',
  tealTint: '#DCEFFD',
  tealLine: '#7FE7D6',
  purple: '#8B6FD4',
  blue: '#4D8DFF',
  orange: '#F97316',
  red: '#E5484D',
  green: '#3DAE6E',
  coral: '#0B3D91',
  coralSoft: '#DCEFFD',
  violet: '#8B6FD4',
  navBg: '#FFFFFF',
  navActive: '#0B3D91',
  navOnActive: '#FFFFFF',
  navInactive: '#5B6B7D',
  navBorder: '#C9E2F4',
  navWedge: '#FFFFFF',
}

/** Plum and orchid pinks on a blush ground. */
export const orchidColors: ColorPalette = {
  bg: '#EADADA',
  // A touch warmer than white, so cards sit on the blush rather than punch
  // holes in it.
  surface: '#FFFAFA',
  surface2: '#F4E6EA',
  border: '#E0C9CF',
  t1: '#4D3A4D',
  t2: '#634F61',
  t3: '#7E6A7B',
  teal: '#BE5CA9',
  tealTint: '#F7E4F2',
  tealLine: '#D59CC5',
  purple: '#8B6FD4',
  blue: '#4D8DFF',
  orange: '#F97316',
  red: '#E5484D',
  green: '#3DAE6E',
  coral: '#BE5CA9',
  coralSoft: '#F7E4F2',
  violet: '#8B6FD4',
  navBg: '#FFFFFF',
  // The orchid darkened until it clears AA as text (5.21:1), the same move
  // the light theme makes with its orange.
  navActive: '#A8479A',
  navOnActive: '#FFFFFF',
  navInactive: '#76687A',
  navBorder: '#E0C9CF',
  navWedge: '#FFFFFF',
}

/** Porcelain white and graphite, with a bright blue accent. */
export const porcelainColors: ColorPalette = {
  bg: '#F5F5F7',
  surface: '#FFFFFF',
  surface2: '#E9E9EE',
  border: '#DEDEE3',
  t1: '#1D1D1F',
  t2: '#6E6E73',
  // The palette's silver (#AAAAAA) is 2.32:1 on white — a swatch, not a text
  // colour. This is the same grey pulled down to where a placeholder reads.
  t3: '#86868B',
  teal: '#007AFF',
  tealTint: '#E5F1FF',
  tealLine: '#A8CFFF',
  purple: '#8B6FD4',
  blue: '#4D8DFF',
  orange: '#F97316',
  red: '#E5484D',
  green: '#3DAE6E',
  coral: '#007AFF',
  coralSoft: '#E5F1FF',
  violet: '#8B6FD4',
  navBg: '#FFFFFF',
  // #007AFF is 4.02:1 on white; this is the same blue at 4.70:1.
  navActive: '#0071E3',
  navOnActive: '#FFFFFF',
  navInactive: '#6E6E73',
  navBorder: '#DEDEE3',
  navWedge: '#FFFFFF',
}

export type ThemeId = 'light' | 'dark' | 'sage' | 'lagoon' | 'orchid' | 'porcelain'

export interface ThemeOption {
  id: ThemeId
  name: string
  /** One line for the picker. */
  description: string
  /**
   * Which way everything outside the palette goes — the status bar, the
   * keyboard and other native chrome, blur tints, the basemap, the home-screen
   * icon. Each of those has exactly a light and a dark version, so every theme
   * has to say which of the two it is.
   */
  scheme: 'light' | 'dark'
  colors: ColorPalette
  /** The palette as a strip of chips, for the picker. Not read anywhere else. */
  swatches: string[]
}

/** Every theme, in the order the picker shows them. */
export const THEMES: readonly ThemeOption[] = [
  {
    id: 'light',
    name: 'Light',
    description: 'Warm cream with a coral accent',
    scheme: 'light',
    colors: lightColors,
    swatches: ['#2D2A22', '#E8714A', '#F0C4AE', '#FAF9F5'],
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Near-black with a teal accent',
    scheme: 'dark',
    colors,
    swatches: ['#0A0A0B', '#1C1C21', '#1FC7B6', '#F4F4F6'],
  },
  {
    id: 'sage',
    name: 'Sage',
    description: 'Forest greens and terracotta on cream',
    scheme: 'light',
    colors: sageColors,
    swatches: ['#2E3A2F', '#6B7F5B', '#D9C9B2', '#C96F4F', '#F8F6EE'],
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    description: 'Deep navy, sky and aqua on ice blue',
    scheme: 'light',
    colors: lagoonColors,
    swatches: ['#0B3D91', '#3BA7F2', '#7FE7D6', '#E8F6FF'],
  },
  {
    id: 'orchid',
    name: 'Orchid',
    description: 'Plum and orchid pinks on blush',
    scheme: 'light',
    colors: orchidColors,
    swatches: ['#4D3A4D', '#BE5CA9', '#D59CC5', '#EADADA'],
  },
  {
    id: 'porcelain',
    name: 'Porcelain',
    description: 'Clean white and graphite with a bright blue',
    scheme: 'light',
    colors: porcelainColors,
    swatches: ['#1D1D1F', '#AAAAAA', '#007AFF', '#F5F5F7'],
  },
]

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

/** The theme for an id. Falls back to Light, the app's default. */
export function getTheme(id: ThemeId): ThemeOption {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]
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
