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
