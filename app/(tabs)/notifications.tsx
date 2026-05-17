import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { Speedometer } from '@/components/Speedometer';

// ─── Types ────────────────────────────────────────────────────────────────────
interface FriendRequest {
  id: number;
  from_user: { id: number; username: string };
  created_at?: string;
}

interface Notification {
  id: number;
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
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
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
  const type = n.notification_type ?? '';
  return type === 'proximity' || type === 'nearby' || type === 'wave';
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function NotificationsScreen() {
  const { top, bottom } = useSafeAreaInsets();

  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);

  // Per-request action state: 'accept' | 'decline' | null
  const [actioning, setActioning] = useState<Record<number, 'accept' | 'decline'>>({});

  async function fetchAll() {
    const [reqRes, notifRes] = await Promise.allSettled([
      api.get<FriendRequest[]>('/api/friends/requests/incoming/'),
      api.get<unknown>('/api/notifications/'),
    ]);

    if (reqRes.status === 'fulfilled') {
      const data = reqRes.value.data;
      setRequests(Array.isArray(data) ? data : []);
    } else {
      console.log('[Notifications] requests error:', reqRes.reason?.response?.status);
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
    } else {
      console.log('[Notifications] notifications error:', notifRes.reason?.response?.status);
    }
  }

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, []);

  async function handleRequest(requestId: number, action: 'accept' | 'decline') {
    setActioning((prev) => ({ ...prev, [requestId]: action }));
    try {
      await api.post(`/api/friends/request/${requestId}/${action}/`);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (e: any) {
      console.log(`[Notifications] ${action} error:`, e?.response?.status, JSON.stringify(e?.response?.data));
    } finally {
      setActioning((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    }
  }

  async function markAllRead() {
    setMarkingRead(true);
    try {
      await api.post('/api/notifications/mark-all-read/');
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true, read: true })));
    } catch {
      // Silently ignore — optimistic update already applied
    } finally {
      setMarkingRead(false);
    }
  }

  const proximityNotifs = notifications.filter(isProximity);
  const otherNotifs = notifications.filter((n) => !isProximity(n));
  const unreadCount = notifications.filter((n) => !isRead(n)).length + requests.length;
  const hasAnything = requests.length > 0 || notifications.length > 0;

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color="#00b4a6" size="large" />
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00b4a6" />
        }
      >
        {/* ── Page header ── */}
        <View style={styles.pageHeader}>
          <View style={styles.pageTitleRow}>
            <Text style={styles.pageTitle}>Notifications</Text>
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount}</Text>
              </View>
            )}
          </View>

          {unreadCount > 0 && (
            <TouchableOpacity
              onPress={markAllRead}
              disabled={markingRead}
              hitSlop={10}
              activeOpacity={0.7}
            >
              {markingRead ? (
                <ActivityIndicator color="#00b4a6" size="small" />
              ) : (
                <Text style={styles.markReadBtn}>Mark all read</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* ── Empty state ── */}
        {!hasAnything && (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="notifications-outline" size={32} color="#1e1e1e" />
            </View>
            <Text style={styles.emptyTitle}>All caught up</Text>
            <Text style={styles.emptySub}>No new notifications or friend requests</Text>
          </View>
        )}

        {/* ── Friend Requests ── */}
        {requests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Friend Requests</Text>
            <View style={styles.cardList}>
              {requests.map((req) => {
                const pending = actioning[req.id];
                return (
                  <View key={req.id} style={styles.requestCard}>
                    <View style={styles.requestLeft}>
                      <View style={styles.requestAvatar}>
                        <Text style={styles.requestAvatarText}>
                          {req.from_user.username.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.requestName}>{req.from_user.username}</Text>
                        <Text style={styles.requestSub}>
                          Wants to connect{req.created_at ? `  ·  ${fmtTime(req.created_at)}` : ''}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.requestActions}>
                      <TouchableOpacity
                        style={[styles.btnAccept, pending && styles.btnDisabled]}
                        onPress={() => handleRequest(req.id, 'accept')}
                        disabled={!!pending}
                        activeOpacity={0.75}
                      >
                        {pending === 'accept' ? (
                          <ActivityIndicator color="#0a0a0a" size="small" />
                        ) : (
                          <Text style={styles.btnAcceptText}>Accept</Text>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.btnDecline, pending && styles.btnDisabled]}
                        onPress={() => handleRequest(req.id, 'decline')}
                        disabled={!!pending}
                        activeOpacity={0.75}
                      >
                        {pending === 'decline' ? (
                          <ActivityIndicator color="#555" size="small" />
                        ) : (
                          <Text style={styles.btnDeclineText}>Decline</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Proximity Notifications ── */}
        {proximityNotifs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Nearby</Text>
            <View style={styles.cardList}>
              {proximityNotifs.map((n) => (
                <NotifRow key={n.id} notif={n} icon="location-outline" iconColor="#00b4a6" />
              ))}
            </View>
          </View>
        )}

        {/* ── Other Notifications ── */}
        {otherNotifs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Activity</Text>
            <View style={styles.cardList}>
              {otherNotifs.map((n) => (
                <NotifRow key={n.id} notif={n} icon="notifications-outline" iconColor="#444" />
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <Speedometer />
    </View>
  );
}

// ─── NotifRow ─────────────────────────────────────────────────────────────────
function NotifRow({
  notif,
  icon,
  iconColor,
}: {
  notif: Notification;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
}) {
  const read = isRead(notif);
  const text = notifText(notif);

  return (
    <View style={[styles.notifCard, read && styles.notifCardRead]}>
      <View style={[styles.notifIconWrap, { borderColor: iconColor + '30' }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        {text ? (
          <Text style={[styles.notifText, read && styles.notifTextRead]}>{text}</Text>
        ) : (
          <Text style={styles.notifText}>Someone nearby shares your interests</Text>
        )}
        {notif.created_at && (
          <Text style={styles.notifTime}>{fmtTime(notif.created_at)}</Text>
        )}
      </View>
      {!read && <View style={styles.unreadDot} />}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20 },

  // ── Header ──
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  pageTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pageTitle: { color: '#ffffff', fontSize: 26, fontWeight: '700' },
  badge: {
    backgroundColor: '#00b4a6',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#0a0a0a', fontSize: 11, fontWeight: '700' },
  markReadBtn: { color: '#00b4a6', fontSize: 13, fontWeight: '500' },

  // ── Empty ──
  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { color: '#333', fontSize: 16, fontWeight: '600' },
  emptySub: { color: '#222', fontSize: 13, textAlign: 'center' },

  // ── Section ──
  section: { marginBottom: 28 },
  sectionTitle: {
    color: '#444',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  cardList: { gap: 10 },

  // ── Friend Request card ──
  requestCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 14,
    gap: 12,
  },
  requestLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  requestAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#0d1f1e',
    borderWidth: 1,
    borderColor: '#00b4a630',
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestAvatarText: { color: '#00b4a6', fontSize: 17, fontWeight: '700' },
  requestName: { color: '#e0e0e0', fontSize: 15, fontWeight: '600' },
  requestSub: { color: '#444', fontSize: 12, marginTop: 2 },
  requestActions: { flexDirection: 'row', gap: 10 },
  btnAccept: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: '#00b4a6',
    alignItems: 'center',
  },
  btnAcceptText: { color: '#0a0a0a', fontSize: 14, fontWeight: '700' },
  btnDecline: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#252525',
    alignItems: 'center',
  },
  btnDeclineText: { color: '#666', fontSize: 14, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },

  // ── Notification row ──
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 14,
    gap: 12,
  },
  notifCardRead: { opacity: 0.55 },
  notifIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#0d0d0d',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifText: { color: '#ddd', fontSize: 14, lineHeight: 19 },
  notifTextRead: { color: '#444' },
  notifTime: { color: '#2e2e2e', fontSize: 11, marginTop: 3 },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#00b4a6',
    alignSelf: 'center',
  },
});
