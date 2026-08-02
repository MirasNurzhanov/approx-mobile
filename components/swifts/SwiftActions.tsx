import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { fonts, MAX_SCALE_FIXED } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface SwiftActionsProps {
  isLiked: boolean;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  muted: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onMore: () => void;
  onToggleMute: () => void;
  /** Distance from the bottom of the screen; the caller works this out from the
   *  nav arc so the rail never sits under it. */
  bottom: number;
}

/** 1284 → "1.2K". Counts sit under a 24pt icon and have no room to grow. */
function fmtCount(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1_000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}K`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)}M`;
}

function ActionButton({
  icon,
  label,
  tint,
  accessibilityLabel,
  onPress,
}: {
  icon: IoniconName;
  label?: string;
  tint?: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name={icon} size={28} color={tint ?? '#FFFFFF'} />
      {label ? (
        <Text style={styles.actionLabel} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function SwiftActions({
  isLiked,
  likeCount,
  commentCount,
  shareCount,
  muted,
  onLike,
  onComment,
  onShare,
  onMore,
  onToggleMute,
  bottom,
}: SwiftActionsProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.rail, { bottom }]}>
      <ActionButton
        icon={muted ? 'volume-mute' : 'volume-high'}
        accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        onPress={onToggleMute}
      />
      <ActionButton
        icon={isLiked ? 'heart' : 'heart-outline'}
        label={fmtCount(likeCount)}
        tint={isLiked ? colors.red : undefined}
        accessibilityLabel={
          isLiked ? `Unlike, ${likeCount} likes` : `Like, ${likeCount} likes`
        }
        onPress={onLike}
      />
      <ActionButton
        icon="chatbubble-outline"
        label={fmtCount(commentCount)}
        accessibilityLabel={`Comments, ${commentCount}`}
        onPress={onComment}
      />
      <ActionButton
        icon="arrow-redo-outline"
        label={fmtCount(shareCount)}
        accessibilityLabel={`Share, ${shareCount} shares`}
        onPress={onShare}
      />
      <ActionButton icon="ellipsis-horizontal" accessibilityLabel="More options" onPress={onMore} />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    position: 'absolute',
    right: 10,
    alignItems: 'center',
    gap: 18,
  },
  action: { alignItems: 'center', gap: 3 },
  actionPressed: { opacity: 0.6 },
  actionLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
