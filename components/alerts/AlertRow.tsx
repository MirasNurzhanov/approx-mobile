import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { fmtTime, isRead, notifText, type AlertRequest, type Notification } from '@/services/alerts';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const ACTIVITY_ICON: Record<string, IoniconsName> = {
  story_reaction: 'heart',
  story_reply: 'chatbubble',
};

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
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

  // Row
  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  notifRowRead: { opacity: 0.55 },
  notifRowPressed: { opacity: 0.7 },

  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.teal,
    marginTop: 5,
    flexShrink: 0,
  },
  unreadDotHidden: { backgroundColor: 'transparent' },

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
  notifTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  notifTypeIcon: { marginTop: 4 },
  notifTitle: {
    flex: 1,
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

  // Story thumbnail
  storyThumb: {
    width: 38,
    height: 50,
    borderRadius: radius.s,
    backgroundColor: colors.surface2,
    flexShrink: 0,
  },

  // Request actions
  requestActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
});

// ─── Activity row ─────────────────────────────────────────────────────────────
export function NotifRow({ notif, onPress }: { notif: Notification; onPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const read = isRead(notif);
  const text = notifText(notif);
  const icon = ACTIVITY_ICON[notif.notification_type ?? ''] ?? 'notifications';
  const excerpt = notif.story_excerpt ?? undefined;

  const body = (
    <>
      <View style={[styles.unreadDot, read && styles.unreadDotHidden]} />
      {notif.sender_username ? (
        <Avatar
          uri={notif.sender_avatar ?? undefined}
          name={notif.sender_username}
          size="sm"
          ringColor={read ? colors.t3 : colors.teal}
        />
      ) : (
        <View style={styles.notifIconTile}>
          <Ionicons name={icon} size={18} color={read ? colors.t3 : colors.teal} />
        </View>
      )}

      <View style={styles.notifBody}>
        <View style={styles.notifTitleRow}>
          <Ionicons
            name={icon}
            size={12}
            color={read ? colors.t3 : colors.teal}
            style={styles.notifTypeIcon}
          />
          <Text style={styles.notifTitle} numberOfLines={2}>{text}</Text>
        </View>
        {excerpt ? (
          <Text style={styles.notifSubtitle} numberOfLines={1}>"{excerpt}"</Text>
        ) : null}
        {notif.created_at ? (
          <Text style={styles.notifTime}>{fmtTime(notif.created_at)}</Text>
        ) : null}
      </View>

      {notif.story_image ? (
        <Image source={{ uri: notif.story_image }} style={styles.storyThumb} />
      ) : null}
      {onPress ? <Ionicons name="chevron-forward" size={14} color={colors.t3} /> : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.notifRow, read && styles.notifRowRead]}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={text}
      style={({ pressed }) => [
        styles.notifRow,
        read && styles.notifRowRead,
        pressed && styles.notifRowPressed,
      ]}
    >
      {body}
    </Pressable>
  );
}

// ─── Request row ──────────────────────────────────────────────────────────────
const REQUEST_COPY: Record<AlertRequest['kind'], string> = {
  hi: 'Sent you a Hi 👋',
  friend: 'Wants to be friends',
};

export function RequestRow({
  request,
  actioning,
  onAccept,
  onDecline,
  onPressUser,
}: {
  request: AlertRequest;
  actioning: 'accept' | 'decline' | undefined;
  onAccept: () => void;
  onDecline: () => void;
  onPressUser?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = request;

  return (
    <View style={styles.notifRow}>
      <View style={styles.unreadDot} />
      <Pressable onPress={onPressUser} disabled={!onPressUser} accessibilityRole="button">
        <Avatar
          uri={user.profile_picture}
          name={user.username}
          size="sm"
          ringColor={request.kind === 'friend' ? colors.blue : colors.orange}
        />
      </Pressable>
      <View style={styles.notifBody}>
        <Text style={styles.notifTitle}>{user.username}</Text>
        <Text style={styles.notifSubtitle}>
          {REQUEST_COPY[request.kind]}
          {request.created_at ? `  ·  ${fmtTime(request.created_at)}` : ''}
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
export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionRows}>{children}</View>
    </View>
  );
}
