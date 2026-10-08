import { usePathname } from 'expo-router';
import { useEffect } from 'react';

import { refreshNavBadges, useSharedNavBadges } from '@/services/navBadges';
import type { NavBadges } from '@/services/navBadges';

export type { NavBadges } from '@/services/navBadges';

export function useNavBadges(): NavBadges {
  const pathname = usePathname();
  const badges = useSharedNavBadges();

  useEffect(() => {
    if (pathname.includes('chat')) void refreshNavBadges();
    if (pathname.includes('messages')) {
      // Allow the read receipt to finish. Other threads can still be unread.
      const timer = setTimeout(() => { void refreshNavBadges(); }, 1500);
      return () => clearTimeout(timer);
    }
  }, [pathname]);

  return badges;
}
