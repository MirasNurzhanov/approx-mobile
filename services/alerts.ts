import { useSyncExternalStore } from 'react';

import { api } from '@/services/api';

// Everything that is waiting for the user, in one place: Hi requests (formerly
// the Chat "Pending" tab), friend requests, and story activity. The alerts
// screen and the Chat tab badge both read from here, so the number on the tab
// can never disagree with the list it opens.
//
// Two things this deliberately does *not* carry any more:
//
//  - Nearby alerts. Being somewhere is not an event worth a notification, and
//    the local feed that produced them ("@miras is nearby · 180m away",
//    "@aisha shares your interests") is gone entirely. Server `nearby_user`
//    notifications are dropped on arrival for the same reason.
//  - Locally inferred story reactions. Those were guessed by diffing reaction
//    counts on the map, which could only ever say "someone". The server now
//    sends real ones naming the sender and the story.

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AlertUser {
  id: number;
  username: string;
  profile_picture?: string;
}

/** An incoming request awaiting an answer. `kind` decides which endpoint
 *  accept/decline hits and what the row says. */
export interface AlertRequest {
  id: number;
  kind: 'hi' | 'friend';
  user: AlertUser;
  created_at?: string;
}

/** Raw shape from either requests endpoint — the sender key has varied. */
interface RawRequest {
  id: number;
  sender?: AlertUser;
  from_user?: AlertUser;
  created_at?: string;
}

export interface Notification {
  id: number | string;
  message?: string;
  title?: string;
  body?: string;
  notification_type?: string;
  is_read?: boolean;
  read?: boolean;
  created_at?: string;
  /** Who caused it, when the server knows — lets the row be tapped through. */
  sender_id?: number | null;
  sender_username?: string | null;
  sender_avatar?: string | null;
  /** What it is about, for story alerts. */
  story_id?: number | null;
  story_image?: string | null;
  story_excerpt?: string | null;
  /** What it is about, for club and meetup alerts. */
  club_id?: number | null;
  club_name?: string | null;
  event_id?: number | null;
}

export interface AlertsData {
  requests: AlertRequest[];
  notifications: Notification[];
}

export interface DerivedAlerts {
  requests: AlertRequest[];
  /** Story reactions, replies and any other server activity, newest first. */
  activity: Notification[];
  unreadCount: number;
  hasAnything: boolean;
}

export const EMPTY_ALERTS: AlertsData = { requests: [], notifications: [] };

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function fmtTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return '';
  }
}

export function notifText(n: Notification): string {
  return n.message ?? n.body ?? n.title ?? '';
}

export function isRead(n: Notification): boolean {
  return !!(n.is_read || n.read);
}

/** Location-derived notifications, which no longer surface anywhere. Servers
 *  that have not been redeployed still send these, so they are filtered here
 *  rather than assumed absent. */
export function isProximity(n: Notification): boolean {
  const t = n.notification_type ?? '';
  return t === 'proximity' || t === 'nearby' || t === 'nearby_user' || t === 'wave';
}

export function isStoryAlert(n: Notification): boolean {
  const t = n.notification_type ?? '';
  return t === 'story_reaction' || t === 'story_reply';
}

/** Club activity: a meetup proposed, a verdict on one, or being added to a
 *  club. All three open a club rather than a person, which is what separates
 *  them from every other row in the feed. */
export function isClubAlert(n: Notification): boolean {
  const t = n.notification_type ?? '';
  return t === 'club_event' || t === 'club_event_status' || t === 'club_invite';
}

/** Endpoint paths for answering a request, by kind. */
export function requestActionUrl(req: AlertRequest, action: 'accept' | 'decline'): string {
  return req.kind === 'hi'
    ? `/api/friends/hi/${req.id}/${action}/`
    : `/api/friends/request/${req.id}/${action}/`;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The notifications endpoint has returned bare arrays and paginated wrappers
 *  at different times; accept both rather than betting on one. */
function extractNotifications(raw: unknown): Notification[] {
  if (Array.isArray(raw)) return raw as Notification[];
  const obj = asRecord(raw);
  if (!obj) return [];
  for (const key of ['results', 'notifications', 'data']) {
    const nested = obj[key];
    if (Array.isArray(nested)) return nested as Notification[];
  }
  return [];
}

function toRequests(raw: unknown, kind: AlertRequest['kind']): AlertRequest[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawRequest[]).flatMap((r) => {
    const user = r.sender ?? r.from_user;
    return user ? [{ id: r.id, kind, user, created_at: r.created_at }] : [];
  });
}

function byDateDesc(a: { created_at?: string }, b: { created_at?: string }): number {
  return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
}

// ─── Loading ──────────────────────────────────────────────────────────────────
export async function loadAlerts(): Promise<AlertsData> {
  const [hiRes, friendRes, notifRes] = await Promise.allSettled([
    api.get<unknown>('/api/friends/requests/'),
    api.get<unknown>('/api/friends/requests/incoming/'),
    api.get<unknown>('/api/notifications/'),
  ]);

  const requests = [
    ...(hiRes.status === 'fulfilled' ? toRequests(hiRes.value.data, 'hi') : []),
    ...(friendRes.status === 'fulfilled' ? toRequests(friendRes.value.data, 'friend') : []),
  ].sort(byDateDesc);

  const notifications =
    notifRes.status === 'fulfilled' ? extractNotifications(notifRes.value.data) : [];

  return { requests, notifications };
}

export function deriveAlerts(data: AlertsData): DerivedAlerts {
  const activity = data.notifications.filter((n) => !isProximity(n)).sort(byDateDesc);
  const unreadCount = activity.filter((n) => !isRead(n)).length + data.requests.length;

  return {
    requests: data.requests,
    activity,
    unreadCount,
    hasAnything: data.requests.length > 0 || activity.length > 0,
  };
}

export async function countUnreadAlerts(): Promise<number> {
  return deriveAlerts(await loadAlerts()).unreadCount;
}

// ─── Unread store ─────────────────────────────────────────────────────────────
// The count has two subscribers that are on screen at the same time — the nav
// arc's Chat badge and the Alerts tab in Chat. One shared poll rather than one
// per hook instance, or the Chat tab would issue four requests every ten
// seconds to answer a single question. Same shape as services/blocked.ts.

const POLL_MS = 10_000;

let unreadCount = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
const listeners = new Set<() => void>();

export function refreshAlertsCount(): void {
  if (inFlight) return;
  inFlight = true;
  countUnreadAlerts()
    .then((next) => {
      if (next === unreadCount) return;
      unreadCount = next;
      listeners.forEach((l) => l());
    })
    .catch(() => {})
    .finally(() => { inFlight = false; });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Polling is tied to having subscribers, so no timer survives on screens
  // that never show the count.
  if (listeners.size === 1) {
    refreshAlertsCount();
    timer = setInterval(refreshAlertsCount, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useAlertsCount(): number {
  return useSyncExternalStore(subscribe, () => unreadCount);
}

/** Drop the previous account's badge on sign-out, so the next person to use
 *  this device does not briefly see a count that was never theirs. */
export function resetAlertsCount(): void {
  unreadCount = 0;
  listeners.forEach((l) => l());
}
