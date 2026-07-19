import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { getFeed, markFeedRead, type LocalNotification } from '@/services/activityFeed';
import { Speedometer } from '@/components/Speedometer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useScrollHandler } from '@/hooks/useScrollHandler';
import { colors, fonts, radius } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
interface FriendRequest {
  id: number;
  from_user?: { id: number; username: string };
  sender?:    { id: number; username: string };
  created_at?: string;
}

interface Notification {
  id: number | string;
  message?: string;
  title?: string;
  body?: string;
  notification_type?: string;
  is_read?: boolean;
  read?: boolean;
  created_at?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso?: string): string {
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

function notifText(n: Notification): string {
  return n.message ?? n.body ?? n.title ?? '';
}

function isRead(n: Notification): boolean {
  return !!(n.is_read || n.read);
}

function isProximity(n: Notification): boolean {
  const t = n.notification_type ?? '';
  return t === 'proximity' || t === 'nearby' || t === 'wave';
}

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

// ─── Notification row ─────────────────────────────────────────────────────────
function NotifRow({ notif, icon }: { notif: Notification; icon: IoniconsName }) {
  const read = isRead(notif);
  const text = notifText(notif) || 'Someone nearby shares your interests';
  const dotIndex = text.indexOf(' · ');
  const title = dotIndex > -1 ? text.slice(0, dotIndex) : text;
  const subtitle = dotIndex > -1 ? text.slice(dotIndex + 3) : undefined;

  return (
    <View style={[styles.notifRow, read && styles.notifRowRead]}>
      {!read && <View style={styles.unreadDot} />}
      <View style={styles.notifIconTile}>
        <Ionicons name={icon} size={18} color={read ? colors.t3 : colors.teal} />
      </View>
      <View style={styles.notifBody}>
        <Text style={styles.notifTitle} numberOfLines={2}>{title}</Text>
        {subtitle ? (
          <Text style={styles.notifSubtitle} numberOfLines={1}>{subtitle}</Text>
        ) : null}
        {notif.created_at ? (
          <Text style={styles.notifTime}>{fmtTime(notif.created_at)}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Friend request row ───────────────────────────────────────────────────────
function RequestRow({
  request,
  actioning,
  onAccept,
  onDecline,
}: {
  request: FriendRequest;
  actioning: 'accept' | 'decline' | undefined;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const user = request.from_user ?? request.sender;
  if (!user) return null;

  return (
    <View style={styles.notifRow}>
      <View style={styles.unreadDot} />
      <Avatar uri={undefined} name={user.username} size="sm" ringColor={colors.t3} />
      <View style={styles.notifBody}>
        <Text style={styles.notifTitle}>{user.username}</Text>
        <Text style={styles.notifSubtitle}>
          Wants to connect{request.created_at ? `  ·  ${fmtTime(request.created_at)}` : ''}
        </Text>
        <View style={styles.requestActions}>
          <Button
            label="Accept"
            variant="primary"
            size="sm"
            loading={actioning === 'accept'}
            disabled={!!actioning}
            onPress={onAccept}
          />
          <Button
            label="Decline"
            variant="ghost"
            size="sm"
            loading={actioning === 'decline'}
            disabled={!!actioning}
            onPress={onDecline}
          />
        </View>
      </View>
    </View>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionRows}>{children}</View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function NotificationsScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const scrollProps = useScrollHandler();

  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [localFeed, setLocalFeed] = useState<LocalNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [actioning, setActioning] = useState<Record<number, 'accept' | 'decline'>>({});

  const fetchAll = useCallback(async () => {
    const [reqRes, notifRes] = await Promise.allSettled([
      api.get<FriendRequest[]>('/api/friends/requests/incoming/'),
      api.get<unknown>('/api/notifications/'),
    ]);

    if (reqRes.status === 'fulfilled') {
      const data = reqRes.value.data;
      setRequests(Array.isArray(data) ? data : []);
    }

    if (notifRes.status === 'fulfilled') {
      const raw = notifRes.value.data;
      let list: Notification[] = [];
      if (Array.isArray(raw)) {
        list = raw;
      } else if (raw && typeof raw === 'object') {
        const wrapped = (raw as any).results ?? (raw as any).notifications ?? (raw as any).data ?? [];
        list = Array.isArray(wrapped) ? wrapped : [];
      }
      setNotifications(list);
    }

    setLocalFeed(await getFeed());
  }, []);

  useEffect(() => { fetchAll().finally(() => setLoading(false)); }, [fetchAll]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useFocusEffect(useCallback(() => {
    fetchAll();
    pollRef.current = setInterval(fetchAll, 5_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchAll]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  async function handleRequest(id: number, action: 'accept' | 'decline') {
    setActioning((prev) => ({ ...prev, [id]: action }));
    try {
      await api.post(`/api/friends/request/${id}/${action}/`);
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      console.log(`[Notifications] ${action} error:`, e?.response?.status);
    } finally {
      setActioning((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  }

  async function markAllRead() {
    setMarkingRead(true);
    try {
      await markFeedRead();
      await api.patch('/api/notifications/mark-all-read/');
    } catch {}
    finally {
      await fetchAll();
      setMarkingRead(false);
    }
  }

  // Server proximity notifications are intentionally dropped: only the local
  // feed (friends with distance, interest matches) may produce nearby alerts.
  const toNotif = (n: LocalNotification): Notification => ({
    id: n.id,
    message: n.message,
    notification_type: n.type,
    read: n.read,
    created_at: n.created_at,
  });
  const byDateDesc = (a: Notification, b: Notification) =>
    new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();

  const nearbyNotifs = localFeed.filter((n) => n.type !== 'story_reaction').map(toNotif);
  const reactionNotifs = localFeed.filter((n) => n.type === 'story_reaction').map(toNotif);
  const otherNotifs = [...reactionNotifs, ...notifications.filter((n) => !isProximity(n))].sort(byDateDesc);
  const unreadCount =
    [...nearbyNotifs, ...otherNotifs].filter((n) => !isRead(n)).length + requests.length;
  const hasAnything = requests.length > 0 || nearbyNotifs.length > 0 || otherNotifs.length > 0;

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.teal} size="large" />
        <Speedometer />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: top + 20, paddingBottom: bottom + 110 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />
        }
        {...scrollProps}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <Pressable onPress={markAllRead} disabled={markingRead} hitSlop={10}>
              {markingRead ? (
                <ActivityIndicator color={colors.teal} size="small" />
              ) : (
                <Text style={styles.markReadBtn}>Mark all read</Text>
              )}
            </Pressable>
          )}
        </View>

        {/* Unread pill */}
        {unreadCount > 0 && (
          <View style={styles.unreadPill}>
            <Text style={styles.unreadPillText}>{unreadCount} unread</Text>
          </View>
        )}

        {/* Empty state */}
        {!hasAnything && (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>You're all caught up</Text>
          </View>
        )}

        {/* FRIEND REQUESTS */}
        {requests.length > 0 && (
          <Section label="FRIEND REQUESTS">
            {requests.map((req) => (
              <RequestRow
                key={req.id}
                request={req}
                actioning={actioning[req.id]}
                onAccept={() => handleRequest(req.id, 'accept')}
                onDecline={() => handleRequest(req.id, 'decline')}
              />
            ))}
          </Section>
        )}

        {/* NEARBY — local feed only: friends (with distance) and interest matches */}
        {nearbyNotifs.length > 0 && (
          <Section label="NEARBY">
            {nearbyNotifs.map((n) => (
              <NotifRow
                key={String(n.id)}
                notif={n}
                icon={n.notification_type === 'nearby_friend' ? 'people-outline' : 'location-outline'}
              />
            ))}
          </Section>
        )}

        {/* ACTIVITY — story reactions + non-proximity server notifications */}
        {otherNotifs.length > 0 && (
          <Section label="ACTIVITY">
            {otherNotifs.map((n) => (
              <NotifRow
                key={String(n.id)}
                notif={n}
                icon={n.notification_type === 'story_reaction' ? 'heart-outline' : 'notifications-outline'}
              />
            ))}
          </Section>
        )}
      </ScrollView>

      <Speedometer />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 26,
    color: colors.t1,
  },
  markReadBtn: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: colors.teal,
  },

  // Unread pill
  unreadPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface2,
    borderRadius: radius.l,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unreadPillText: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: '500',
    color: colors.t2,
  },

  // Empty
  emptyWrap: { alignItems: 'center', paddingTop: 80 },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t3,
  },

  // Section
  section: { marginBottom: 28 },
  sectionLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  sectionRows: { gap: 2 },

  // Notification row
  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  notifRowRead: { opacity: 0.55 },

  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.teal,
    marginTop: 5,
    flexShrink: 0,
  },

  notifIconTile: {
    width: 36,
    height: 36,
    borderRadius: radius.s,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  notifBody: { flex: 1, gap: 3 },
  notifTitle: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 14,
    color: colors.t1,
    lineHeight: 19,
  },
  notifSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
    lineHeight: 18,
  },
  notifTime: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.t3,
    marginTop: 1,
  },

  // Request row actions
  requestActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
});
