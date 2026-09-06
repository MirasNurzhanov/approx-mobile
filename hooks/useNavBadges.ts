import { usePathname } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { refreshAlertsCount, useAlertsCount } from '@/services/alerts';
import { api } from '@/services/api';

export interface NavBadges {
  /** Unread direct messages. */
  chat: number;
  /** Everything sitting in Alerts. */
  alerts: number;
}

/** The unread endpoint has answered with a bare number, a list, and a `{
 *  unread_count }` envelope at different times; all three still mean a count.
 *
 *  At module scope because the call site is inside a `try`, and the `??` chain
 *  it needs is a "value block" React Compiler cannot lower there. */
function unreadFrom(d: unknown): number {
  if (typeof d === 'number') return d;
  if (Array.isArray(d)) return d.length;
  if (d && typeof d === 'object') {
    return Number((d as any).unread_count ?? (d as any).count ?? 0);
  }
  return 0;
}

/**
 * The unread counts the bottom nav shows, polled once for whichever nav style
 * is on screen.
 *
 * Lives outside both nav components so the wheel and the bar cannot drift into
 * counting different things — and so switching between them doesn't restart the
 * poll with a different set of rules.
 */
export function useNavBadges(): NavBadges {
  const pathname = usePathname();
  const [chat, setChat] = useState(0);
  // Same store the Alerts tab inside Chat reads, so the nav badge and the tab
  // badge can never disagree.
  const alerts = useAlertsCount();

  // Pending Hi requests used to be counted here too. They are part of Alerts
  // now, which `alerts` already counts — and the nav adds the two together, so
  // counting requests in both would show every one of them twice.
  const fetchChatBadge = useCallback(async () => {
    try {
      const [unreadRes] = await Promise.allSettled([
        api.get<unknown>('/api/friends/messages/unread/'),
      ]);
      let count = 0;
      if (unreadRes.status === 'fulfilled') {
        const d = unreadRes.value.data;
        count += unreadFrom(d);
      }
      setChat(count);
    } catch {}
  }, []);

  useEffect(() => {
    fetchChatBadge();
    const id = setInterval(fetchChatBadge, 10_000);
    return () => clearInterval(id);
  }, [fetchChatBadge]);

  // Re-fetch on tab focus; optimistic clear when entering a message thread.
  useEffect(() => {
    // Chat is where both halves of this badge get read, so entering it is the
    // one navigation that can make either half stale.
    if (pathname.includes('chat')) {
      fetchChatBadge();
      refreshAlertsCount();
    }
    if (pathname.includes('messages')) {
      setChat(0);
      const t = setTimeout(() => fetchChatBadge(), 1500);
      return () => clearTimeout(t);
    }
  }, [pathname, fetchChatBadge]);

  return { chat, alerts };
}
