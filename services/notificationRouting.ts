import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

// Where a tapped notification takes you.
//
// Every push the server sends carries a `data` payload naming what it is about
// — see notifications/push.py. Without this the payload arrived and was thrown
// away: tapping "@miras: are you coming?" opened the app on whatever screen it
// was last on, and the conversation it named had to be found by hand. A
// notification that does not go anywhere is barely better than no notification.
//
// Kept apart from services/notifications.ts, which owns registration and the
// push token. That module runs on every foreground transition; this one runs
// once and then only when someone taps something.

/** The `data` payload the server attaches. Every field beyond `type` is
 *  optional because an older server build may not send it, and a missing id
 *  must land somewhere sensible rather than on a broken route. */
export interface NotificationData {
  type?: string;
  user_id?: number | string;
  username?: string;
  club_id?: number | string;
  club_name?: string;
  event_id?: number | string;
  story_id?: number | string;
}

/** ids survive the round trip through APNs/FCM as strings on one platform and
 *  numbers on the other. Normalise rather than betting on either. */
function asId(value: number | string | undefined): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text && text !== 'undefined' && text !== 'null' ? text : null;
}

/** The alerts feed, which is the first tab of Chat. The fallback for anything
 *  that is news but has no screen of its own — and for a payload from a server
 *  newer than this build, which at least lands on the list containing it. */
const ALERTS = '/(tabs)/chat';

/**
 * Send the user where a notification points.
 *
 * Returns whether it routed, which is what lets the caller tell "handled" from
 * "nothing to do" — a notification with no payload at all should leave the app
 * exactly where it was rather than bouncing to a default screen.
 */
export function routeFromNotification(data: NotificationData | undefined | null): boolean {
  if (!data || typeof data !== 'object') return false;

  const userId = asId(data.user_id);
  const clubId = asId(data.club_id);

  switch (data.type) {
    case 'message':
      if (!userId) return false;
      router.push({
        pathname: '/messages/[id]',
        params: { id: userId, username: data.username ?? '' },
      } as never);
      return true;

    case 'club_message':
      if (!clubId) return false;
      router.push({ pathname: '/clubs/[id]/chat', params: { id: clubId } } as never);
      return true;

    // A meetup lives on the club's own screen, alongside the proposal message
    // that carries the approve/reject buttons. There is no standalone event
    // route to send `event_id` to, so the club is the closest real place.
    case 'club_event':
    case 'club':
      if (!clubId) return false;
      router.push({ pathname: '/clubs/[id]', params: { id: clubId } } as never);
      return true;

    case 'profile':
      if (!userId) return false;
      router.push({ pathname: '/profile/[id]', params: { id: userId } } as never);
      return true;

    // Story activity and incoming requests both belong to the alerts feed:
    // one because a reaction is a list entry rather than a screen, the other
    // because that is where a request is accepted or declined.
    case 'story':
    case 'request':
      router.push(ALERTS as never);
      return true;

    default:
      return false;
  }
}

function dataOf(response: Notifications.NotificationResponse): NotificationData | undefined {
  return response?.notification?.request?.content?.data as NotificationData | undefined;
}

/**
 * Start routing taps. Returns the teardown.
 *
 * Two sources, because a tap reaches the app differently depending on what the
 * app was doing:
 *
 *  - the listener, for a tap while the app is running or backgrounded;
 *  - `getLastNotificationResponse()`, for a tap that *launched* the app. That
 *    tap happens before any JavaScript exists to hear it, so the response is
 *    held natively and read back here. It is cleared immediately after, or the
 *    same notification would route again on the next launch — the response
 *    persists until something consumes it.
 *
 * Both can produce the same response, so taps are deduplicated by notification
 * identifier rather than trusting them not to overlap.
 */
export function startNotificationRouting(): () => void {
  const handled = new Set<string>();

  function handle(response: Notifications.NotificationResponse | null | undefined) {
    if (!response) return;
    // Only a plain tap. Custom action buttons (none today) would arrive here
    // too, and "dismiss" must not navigate anywhere.
    if (
      response.actionIdentifier &&
      response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
    ) {
      return;
    }
    const id = response.notification?.request?.identifier;
    if (id) {
      if (handled.has(id)) return;
      handled.add(id);
    }
    try {
      routeFromNotification(dataOf(response));
    } catch (e: unknown) {
      // A bad payload must never take the app down on launch.
      console.log('[Push] routing failed:', (e as Error)?.message ?? e);
    }
  }

  const subscription = Notifications.addNotificationResponseReceivedListener(handle);

  try {
    const launched = Notifications.getLastNotificationResponse();
    if (launched) {
      handle(launched);
      Notifications.clearLastNotificationResponse();
    }
  } catch (e: unknown) {
    console.log('[Push] cold-start response unavailable:', (e as Error)?.message ?? e);
  }

  return () => subscription.remove();
}
