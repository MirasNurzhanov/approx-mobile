import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

import { SwiftActions } from '@/components/swifts/SwiftActions';
import { SwiftProgress } from '@/components/swifts/SwiftProgress';
import { Scrim } from '@/components/ui/Scrim';
import { Avatar } from '@/components/ui/Avatar';
import { useDoubleTap } from '@/hooks/useDoubleTap';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { fonts } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import type { Swift } from '@/services/swifts';

/** How often the player reports playback position. Default is 0, which emits
 *  nothing at all — without this the progress bar never moves. 4×/sec is enough
 *  for a 2pt bar and cheaper than a per-frame subscription. */
const TIME_UPDATE_INTERVAL_S = 0.25;

export interface SwiftCardProps {
  swift: Swift;
  /** Exactly one card in the feed is active; the rest stay paused. */
  isActive: boolean;
  /** Held by the feed, not the card: scrolling to another Swift is what makes a
   *  manual pause stale, and the feed is where that scroll is handled. */
  pausedByUser: boolean;
  muted: boolean;
  height: number;
  /** Bottom padding that keeps overlays clear of the nav arc. */
  navClearance: number;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onToggleLike: (id: string, liked: boolean) => void;
  onComment: (swift: Swift) => void;
  onShare: (swift: Swift) => void;
  onMore: (swift: Swift) => void;
}

export function SwiftCard({
  swift,
  isActive,
  pausedByUser,
  muted,
  height,
  navClearance,
  onTogglePause,
  onToggleMute,
  onToggleLike,
  onComment,
  onShare,
  onMore,
}: SwiftCardProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const heartScale = useSharedValue(0);

  const player = useVideoPlayer(swift.videoUrl, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = TIME_UPDATE_INTERVAL_S;
  });

  // Only the visible card plays. Scrolling away rewinds, so returning to a
  // Swift starts it over rather than resuming mid-sentence.
  useEffect(() => {
    if (isActive && !pausedByUser) {
      player.play();
    } else {
      player.pause();
      if (!isActive) player.currentTime = 0;
    }
  }, [isActive, pausedByUser, player]);

  useEffect(() => { player.muted = muted; }, [muted, player]);

  // The live-stream fields are null for VOD, but the payload type requires
  // them, so the initial value has to carry them too.
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    bufferedPosition: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
  });

  // player.duration is 0 until the video loads; fall back to the value the API
  // already gave us so the bar is never divided by zero.
  const durationS = player.duration > 0 ? player.duration : swift.durationMs / 1000;
  const progress = durationS > 0 ? currentTime / durationS : 0;

  // ── Gestures ────────────────────────────────────────────────────────────────
  const likedRef = useRef(swift.isLiked);
  likedRef.current = swift.isLiked;

  function burstHeart() {
    if (reduceMotion) return;
    heartScale.value = withSequence(
      withTiming(1, { duration: 180 }),
      withTiming(1, { duration: 260 }),
      withTiming(0, { duration: 180 }),
    );
  }

  const handleTap = useDoubleTap(
    onTogglePause,
    () => {
      // Double tap only ever likes — it never toggles back off, matching the
      // gesture everywhere else it exists.
      if (!likedRef.current) onToggleLike(swift.id, true);
      burstHeart();
    },
  );

  const heartStyle = useAnimatedStyle(() => ({
    opacity: heartScale.value,
    transform: [{ scale: 0.6 + heartScale.value * 0.6 }],
  }));

  const showPauseIcon = isActive && pausedByUser;

  return (
    <View style={[styles.card, { height }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={handleTap} accessible={false}>
        {/* Poster underneath the player: covers the first-frame gap while the
            video buffers, and is all that shows if the source fails. */}
        <Image
          source={{ uri: swift.thumbnailUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          contentFit="cover"
          nativeControls={false}
          // The feed owns the gestures; the player's own surface must not
          // intercept them or single-tap-to-pause stops working.
          pointerEvents="none"
        />
      </Pressable>

      <Scrim edge="top" height={140} opacity={0.5} />
      <Scrim edge="bottom" height={Math.max(220, navClearance + 160)} />

      {/* Double-tap feedback */}
      <View style={styles.heartWrap} pointerEvents="none">
        <Animated.View style={heartStyle}>
          <Ionicons name="heart" size={96} color="#FFFFFF" />
        </Animated.View>
      </View>

      {/* Tap-to-pause feedback */}
      {showPauseIcon && (
        <View style={styles.pauseWrap} pointerEvents="none">
          <Ionicons name="play" size={64} color="rgba(255,255,255,0.85)" />
        </View>
      )}

      {/* Author + caption + audio */}
      <View style={[styles.meta, { bottom: navClearance + 18 }]} pointerEvents="box-none">
        <View style={styles.authorRow}>
          <Avatar uri={swift.author.avatarUrl} name={swift.author.username} size="sm" ringColor="#FFFFFF" />
          <Text style={styles.username} numberOfLines={1}>@{swift.author.username}</Text>
        </View>
        <Text style={styles.caption} numberOfLines={3}>{swift.caption}</Text>
        <View style={styles.audioRow}>
          <Ionicons name="musical-notes" size={13} color="#FFFFFF" />
          <Text style={styles.audio} numberOfLines={1}>{swift.audioTitle}</Text>
        </View>
      </View>

      <SwiftActions
        isLiked={swift.isLiked}
        likeCount={swift.likeCount}
        commentCount={swift.commentCount}
        shareCount={swift.shareCount}
        muted={muted}
        onLike={() => onToggleLike(swift.id, !swift.isLiked)}
        onComment={() => onComment(swift)}
        onShare={() => onShare(swift)}
        onMore={() => onMore(swift)}
        onToggleMute={onToggleMute}
        bottom={navClearance + 18}
      />

      <SwiftProgress progress={progress} bottom={navClearance} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', backgroundColor: '#000000' },

  heartWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  pauseWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },

  meta: {
    position: 'absolute',
    left: 16,
    // Clear of the action rail.
    right: 78,
    gap: 8,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  username: {
    flexShrink: 1,
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 15,
    color: '#FFFFFF',
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 19,
    color: '#FFFFFF',
  },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  audio: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: '#FFFFFF',
    opacity: 0.9,
  },
});
