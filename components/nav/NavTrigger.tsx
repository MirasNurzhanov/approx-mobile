import { router } from 'expo-router';
import { TabTrigger } from 'expo-router/ui';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import type { NavSection } from '@/components/navSections';

interface NavTriggerProps {
  section: NavSection;
  /** Whether this section is the one on screen. Drives the spoken state as
   *  well as whatever the caller draws. */
  selected: boolean;
  /** Spoken name for the whole button, badge included — "Chat, 3 unread". */
  label: string;
  /**
   * True on `/market`, which the root stack pushes *above* the tab navigator
   * and which therefore has no trigger map to reference. There the button
   * navigates by href like any other link.
   */
  standalone?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Runs before the navigation. For feedback that should answer the tap
   *  immediately rather than wait for the screen to change. */
  onPress?: () => void;
  children: React.ReactNode;
}

/**
 * One destination in the bottom nav, whichever nav is drawing it.
 *
 * Inside the tab navigator this is a real `TabTrigger` with no `href`,
 * referring by name to the declaration in `app/(tabs)/_layout`. That is what
 * hands navigation to the navigator itself — the JUMP_TO dispatch, the
 * `tabPress` event, and popping a tab's stack when you tap the tab you are
 * already on — instead of this file reimplementing any of it.
 *
 * `TabTrigger` renders a `Pressable` and spreads the rest of its props onto it,
 * so `style`, `hitSlop` and the accessibility props land exactly where they
 * would on a plain button.
 */
export function NavTrigger({
  section,
  selected,
  label,
  standalone,
  style,
  onPress,
  children,
}: NavTriggerProps) {
  // One node per tab, so a badge is read as part of the tab ("Chat, 3 unread")
  // rather than as a stray number after it.
  const a11y = {
    accessible: true,
    accessibilityRole: 'tab' as const,
    accessibilityState: { selected },
    accessibilityLabel: label,
  };

  if (standalone) {
    return (
      <Pressable
        style={style}
        hitSlop={10}
        onPress={() => {
          onPress?.();
          router.navigate(section.route as any);
        }}
        {...a11y}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <TabTrigger name={section.name} style={style} hitSlop={10} onPress={onPress} {...a11y}>
      {children}
    </TabTrigger>
  );
}
