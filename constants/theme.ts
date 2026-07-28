export const colors = {
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
