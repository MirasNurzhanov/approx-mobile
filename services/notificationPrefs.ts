import { useSyncExternalStore } from 'react';

import { api } from './api';

// Which kinds of notification this account wants, backed by
// GET/PATCH /api/users/notification-settings/.
//
// Distinct from the OS permission, which lives in services/permissions.ts and
// decides whether anything may reach the phone at all. These decide what the
// *server* bothers sending to someone who has already agreed to be reachable —
// so turning them all off is not the same as revoking the permission, and a
// user who revokes the permission keeps these choices for when they return.
//
// Same store shape as services/privacy.ts, and for the same reason: the
// Settings tab and this screen both read it, so a change on one is not stale
// on the other.

export interface NotificationPrefs {
  /** Direct messages from people you are connected to. */
  notify_messages: boolean;
  /** New messages in clubs you have joined. */
  notify_club_messages: boolean;
  /** Meetups proposed, confirmed or declined in your clubs. */
  notify_club_events: boolean;
  /** Hi requests, friend requests, and the acceptances of both. */
  notify_social: boolean;
  /** Reactions and replies to your own stories. */
  notify_story_activity: boolean;
  /** Both halves of the music-zone alert. Also written by the zone screen —
   *  one setting, reachable from either place. */
  music_zone_alerts: boolean;
}

/** What a brand-new account has, and what to draw before the first fetch
 *  lands. Matches the server defaults: everything on. */
export const DEFAULT_PREFS: NotificationPrefs = {
  notify_messages: true,
  notify_club_messages: true,
  notify_club_events: true,
  notify_social: true,
  notify_story_activity: true,
  music_zone_alerts: true,
};

/** null = not fetched yet this session. */
let prefs: NotificationPrefs | null = null;
const listeners = new Set<() => void>();

function setPrefs(next: NotificationPrefs | null) {
  prefs = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotificationPrefs(): NotificationPrefs | null {
  return useSyncExternalStore(subscribe, () => prefs);
}

export async function refreshNotificationPrefs(): Promise<NotificationPrefs> {
  const { data } = await api.get<NotificationPrefs>('/api/users/notification-settings/');
  setPrefs(data);
  return data;
}

/**
 * Optimistic update; rolls back and rethrows if the server rejects it.
 *
 * The value that ends up in the store is the one the server echoes back, not
 * the one we sent — same rule as services/privacy.ts. A switch that flicks
 * back is a truthful answer; a switch that stays on while the server has it
 * off is not.
 */
export async function updateNotificationPrefs(
  patch: Partial<NotificationPrefs>,
): Promise<void> {
  const previous = prefs;
  if (previous) setPrefs({ ...previous, ...patch });
  try {
    const { data } = await api.patch<NotificationPrefs>(
      '/api/users/notification-settings/',
      patch,
    );
    setPrefs(data);
  } catch (e) {
    if (previous) setPrefs(previous);
    throw e;
  }
}

/** Drop the signed-in user's preferences so the next account on this device
 *  does not inherit them. Called from the sign-out teardown. */
export function resetNotificationPrefs(): void {
  setPrefs(null);
}
