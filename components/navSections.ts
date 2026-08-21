/**
 * The five destinations in the bottom nav, and the rules for reading the
 * current route back out of them.
 *
 * Shared by both nav styles (the wheel in components/Speedometer and the bar in
 * components/nav/AuraTabBar) so switching between them can never change *where*
 * the app can go, only how that choice is drawn. Kept out of both components
 * because a plain module can be imported by the other without either one losing
 * its Fast Refresh boundary.
 */
import { Ionicons } from '@expo/vector-icons';

import { IconSwift, type IconComponent } from '@/components/ui/icons';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface NavSection {
  label: string;
  icon?: IoniconName;
  activeIcon?: IoniconName;
  /** A glyph from the app's own icon set, for sections Ionicons has no word
   *  for. Wins over `icon`/`activeIcon` — it carries its own state through
   *  colour, like every other icon in the nav. */
  Glyph?: IconComponent;
  /** Optical size correction for a `Glyph` whose shape doesn't fill its box.
   *  Multiplies the rendered size everywhere the icon appears, so both nav
   *  styles stay in proportion with their neighbours. */
  glyphScale?: number;
  route: string;
  name: string;
  /** Extra path fragments that should light this section. A pushed screen owned
   *  by a section keeps its parent selected instead of falling back to Map. */
  owns?: string[];
}

export const NAV_SECTIONS: NavSection[] = [
  { label: 'Map',      icon: 'map-outline',         activeIcon: 'map',            route: '/(tabs)/map',      name: 'map'      },
  { label: 'Profile',  icon: 'person-outline',      activeIcon: 'person',         route: '/(tabs)/profile',  name: 'profile'  },
  { label: 'Chat',     icon: 'chatbubbles-outline', activeIcon: 'chatbubbles',    route: '/(tabs)/chat',     name: 'chat',    owns: ['notification', 'messages', 'clubs', 'create-club'] },
  // The swift is a wide, shallow silhouette — at the same nominal size as the
  // Ionicons around it, which fill their square, it reads smaller than its
  // neighbours. The bump is optical, not a size change.
  { label: 'Swifts',   Glyph: IconSwift, glyphScale: 1.3,                         route: '/(tabs)/swifts',   name: 'swifts'   },
  { label: 'Settings', icon: 'settings-outline',    activeIcon: 'settings-sharp', route: '/(tabs)/settings', name: 'settings' },
];

/** 'Chat' is index 2. */
const CHAT_IDX = 2;

/**
 * With Alerts gone from the nav, its unread count rides on the Chat section —
 * which is where the feed now lives, as Chat's first tab. Two sources with no
 * overlap: unread messages, and everything in Alerts.
 */
export function badgeFor(index: number, chatBadge: number, alertsBadge: number): number {
  return index === CHAT_IDX ? chatBadge + alertsBadge : 0;
}

/** "Chat, 3 unread" rather than "Chat" followed by a bare "3". */
export function tabLabel(label: string, badge: number): string {
  if (badge <= 0) return label;
  return `${label}, ${badge > 99 ? 'over 99' : badge} unread`;
}

export function matchSection(pathname: string): number {
  const idx = NAV_SECTIONS.findIndex(
    s =>
      pathname === s.route ||
      pathname.startsWith(s.route) ||
      pathname.endsWith(`/${s.name}`) ||
      (s.owns?.some(fragment => pathname.includes(fragment)) ?? false),
  );
  return idx >= 0 ? idx : 0;
}
