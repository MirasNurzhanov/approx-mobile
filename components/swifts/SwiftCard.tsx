import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

import { SwiftActions } from '@/components/swifts/SwiftActions';
import { SwiftCaption } from '@/components/swifts/SwiftCaption';
import { SwiftStage } from '@/components/swifts/SwiftStage';
import { hasEffect } from '@/constants/swiftEffects';
import { SwiftProgress } from '@/components/swifts/SwiftProgress';
import {
  SwiftAudioIcon,
  SwiftBurstIcon,
  SwiftPlayIcon,
} from '@/components/swifts/icons';
import type { RevealState } from '@/components/swifts/SwiftLocationButton';
import { Scrim } from '@/components/ui/Scrim';
import { Avatar } from '@/components/ui/Avatar';
import { useDoubleTap } from '@/hooks/useDoubleTap';
import { useMusicBed } from '@/hooks/useMusicBed';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { fonts, type as typography } from '@/constants/theme';
import { playedMs } from '@/services/swiftDraft';
import type { Swift } from '@/services/swifts';

/**
 * One Swift, full-bleed.
 *
 * ## Only one video is ever loaded near the viewport
 *
 * `useVideoPlayer` is a hook, so it runs for every mounted card — but the
 * *source* is conditional. A card outside the preload window is handed `null`
 * and holds an idle player with no buffer, so the memory cost of a card three
 * screens away is a poster image rather than a decoder and several megabytes
 * of video. `preload` is the feed's decision (see `SwiftsFeed`), not the
 * card's, because only the feed knows where the viewport is.
 *
 * ## Playback is a function of three things, not one
 *
 * `isActive` already folds in screen focus and app state — the feed computes
 * it — so this component has one condition to honour rather than three
 * listeners of its own. That matters because the failure mode is audible:
 * two players running at once is the single most noticeable bug a video feed
 * can have, and it happens when two components each think they are in charge.
 *
 * ## Rerenders
 *
 * `memo`, because the feed re-renders on every scroll tick and every
 * optimistic count change. Without it, each of those rebuilds the video view,
 * the scrims and five SVG icons for cards nobody is looking at.
 *
 * `memo` only earns that, though, if every prop is stable — which is a
 * property of the *caller*, and one that is silently easy to lose. Every
 * handler this card hands to `SwiftActions` is a `useCallback` for exactly
 * that reason: written inline they would be new functions on every render, the
 * shallow compare would fail every time, and the rail would rebuild its whole
 * SVG tree on every scroll tick while still looking memoised.
 */

/** How often the player reports position. 4×/sec is enough for a 2pt bar and
 *  far cheaper than a per-frame subscription. */
const TIME_UPDATE_INTERVAL_S = 0.25;

export interface SwiftCardProps {
  swift: Swift;
  /** Exactly one card in the feed is active; the rest stay paused. Already
   *  accounts for screen focus and app state. */
  isActive: boolean;
  /** Whether this card is close enough to the viewport to hold a real video
   *  source. False means the player is left idle and only the poster shows. */
  preload: boolean;
  /** Held by the feed, not the card: scrolling to another Swift is what makes
   *  a manual pause stale, and the feed is where that scroll is handled. */
  pausedByUser: boolean;
  muted: boolean;
  height: number;
  /** Bottom padding that keeps overlays clear of the nav arc. */
  navClearance: number;
  revealState: RevealState;
  onRevealLocation: (swift: Swift) => void;
  /** Takes the id rather than closing over it, so the feed can hand down one
   *  callback for every card instead of a fresh closure per row — see the note
   *  on `memo` above. */
  onTogglePause: (id: number) => void;
  onToggleMute: () => void;
  onToggleLike: (id: number, liked: boolean) => void;
  onToggleRepost: (id: number, reposted: boolean) => void;
  onToggleSave: (id: number, saved: boolean) => void;
  /** Opens the sheet that forwards this Swift into somebody's messages. */
  onSend: (swift: Swift) => void;
  onComment: (swift: Swift) => void;
  onMore: (swift: Swift) => void;
}

function SwiftCardImpl({
  swift,
  isActive,
  preload,
  pausedByUser,
  muted,
  height,
  navClearance,
  revealState,
  onRevealLocation,
  onTogglePause,
  onToggleMute,
  onToggleLike,
  onToggleRepost,
  onToggleSave,
  onSend,
  onComment,
  onMore,
}: SwiftCardProps) {
  const reduceMotion = useReduceMotion();
  // The card is full-bleed (`styles.card` is `width: '100%'`), so the window's
  // width is its width. Needed by the sticker layer, which converts fractional
  // positions to pixels, and by the rotation transform.
  const { width: cardWidth } = useWindowDimensions();
  const heartScale = useSharedValue(0);
  const [failed, setFailed] = useState(false);
  /** Bumped by Retry, which is what re-runs the source and clears the error. */
  const [attempt, setAttempt] = useState(0);

  // The conditional source. `null` keeps the player idle — see the note above.
  const source = preload && !failed ? swift.video_url : null;

  // R2 serves the raw upload; nothing trims it server-side any more (see
  // services/swifts.ts). `loop` is off and the trim is looped by hand below,
  // the same way the composer's own editor previews it — a plain `loop: true`
  // would only return to the start of the *source*, which is wrong the moment
  // trim_end_ms is short of the end of the file.
  const trimStartS = swift.trim_start_ms / 1000;
  const trimEndS = (swift.trim_end_ms ?? swift.duration_ms) / 1000;

  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.muted = true;
    p.timeUpdateEventInterval = TIME_UPDATE_INTERVAL_S;
    // Set once, here, rather than in a separate effect: writing `.volume`
    // from an effect that fires around the same time as other player-property
    // writes (muted, currentTime on sourceLoad) can race expo-video's native
    // KVO volume observer into re-notifying itself forever — a real crash
    // (SIGBUS, stack overflow), not a JS-catchable error. `original_volume`
    // is fixed for a given Swift, so there is nothing to react to anyway.
    // A non-finite value is doubly dangerous here: NaN != NaN, so a guard the
    // observer relies on to stop re-applying an unchanged volume never fires.
    const vol = swift.original_volume / 100;
    p.volume = Number.isFinite(vol) ? vol : 1;
  });

  // Seeking before the source has actually loaded is a native crash on
  // device (it is not caught on the JS side) — wait for `sourceLoad` rather
  // than setting `currentTime` in the `useVideoPlayer` setup callback above,
  // and guard every other seek below with the same flag.
  const loadedRef = useRef(false);
  useEventListener(player, 'sourceLoad', () => {
    loadedRef.current = true;
    player.currentTime = trimStartS;
  });

  // Only the visible card plays. Scrolling away rewinds, so returning to a
  // Swift starts it over rather than resuming mid-sentence.
  useEffect(() => {
    if (isActive && !pausedByUser && !failed) {
      player.play();
    } else {
      player.pause();
      if (!isActive && loadedRef.current) player.currentTime = trimStartS;
    }
  }, [isActive, pausedByUser, failed, player, trimStartS]);

  useEffect(() => { player.muted = muted; }, [muted, player]);

  // Speed, the same parameter the editor previewed. `playbackRate` is set from
  // an effect rather than in the setup callback above because — unlike
  // `volume` — it is safe to write repeatedly: it has no native KVO observer
  // to race, and a Swift's rate never changes after publication anyway, so
  // this runs once per card in practice.
  useEffect(() => {
    const rate = (swift.speed_percent || 100) / 100;
    player.playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  }, [swift.speed_percent, player]);

  // A source that will not load is a real state and needs a way out — a black
  // rectangle with no explanation is the worst version of this.
  //
  // `useEventListener` rather than `useEvent` plus an effect: the failure is an
  // *event*, and mirroring an event into state through an effect means the
  // effect re-runs on every status change to re-decide something it was already
  // told once.
  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status === 'error' || error) setFailed(true);
  });

  // The buffering state, separately and as a *value* rather than an event —
  // what is drawn depends on what the status currently is, not on the moment
  // it changed. The poster underneath already covers the gap before the first
  // frame; this is for the case the poster cannot express, which is a video
  // that is taking long enough that the still looks like a stuck feed.
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const buffering = isActive && !failed && source !== null && status === 'loading';

  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    bufferedPosition: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
  });

  // Loop the kept range by hand rather than `player.loop`, which only returns
  // to the start of the *source* — wrong the moment trim_end_ms is short of
  // the end of the file.
  const loopSeeking = useRef(false);
  useEffect(() => {
    if (loopSeeking.current) return;
    const nowMs = currentTime * 1000;
    if (nowMs >= trimEndS * 1000 - 40 || nowMs < trimStartS * 1000 - 40) {
      loopSeeking.current = true;
      player.currentTime = trimStartS;
      // A short guard: the seek itself produces a time update, and reacting to
      // that one would seek again forever.
      setTimeout(() => { loopSeeking.current = false; }, 120);
    }
  }, [currentTime, trimEndS, trimStartS, player]);

  // The attached track, played alongside the video rather than mixed into it —
  // see `hooks/useMusicBed` and `swifts/media.py`. Only for the card actually
  // being watched: a neighbour in the preload window holding an audio player
  // would be a second sound source, which is the single most noticeable bug a
  // video feed can have.
  //
  // `swift.track.audio_url` is empty when the catalogue row is gone, and
  // `useMusicBed` treats that as no bed — so a Swift whose track was withdrawn
  // plays its own sound and keeps its credit, which is exactly what the
  // server's attribution rule intends.
  const bedTrack = swift.track?.audio_url && isActive && !pausedByUser
    ? {
      id: swift.track.id ?? 0,
      title: swift.track.title,
      artist: swift.track.artist,
      artworkUrl: swift.track.artwork_url,
      audioUrl: swift.track.audio_url,
      durationMs: swift.track.duration_ms ?? 0,
    }
    : null;

  useMusicBed({
    track: bedTrack,
    volume: swift.music_volume ?? 70,
    startMs: swift.music_start_ms ?? 0,
    // `playedMs`, not a hand-rolled multiply: the conversion runs the other
    // way round from the one the shape of this expression suggests — at 2×,
    // ten seconds of source is *five* seconds of listening, so the bed is
    // five seconds in, not twenty. Sharing the composer's function is what
    // keeps the feed's answer identical to the one the editor previewed.
    positionMs: playedMs(
      Math.max(0, (currentTime - trimStartS) * 1000), swift.speed_percent || 100,
    ),
    playing: isActive && !pausedByUser && !failed,
    // The feed's own mute control governs the bed too. Two sound sources with
    // one mute button that only silences half of them is worse than no mute
    // button at all.
    muted,
  });

  // `player.duration` is the whole source; the bar tracks the kept range only.
  // Falls back to the API's duration when the player has not measured the
  // source yet, so the bar is never divided by zero.
  const sourceDurationS = player.duration > 0 ? player.duration : swift.duration_ms / 1000;
  const durationS = Math.max(0, (swift.trim_end_ms ? trimEndS : sourceDurationS) - trimStartS);
  const progress = durationS > 0 ? (currentTime - trimStartS) / durationS : 0;

  // ── Gestures ────────────────────────────────────────────────────────────────
  // Read only from the double-tap handler, which cannot fire before this
  // effect has run for the commit that changed the value.
  const likedRef = useRef(swift.viewer_liked);
  useEffect(() => { likedRef.current = swift.viewer_liked; });

  function burstHeart() {
    if (reduceMotion) return;
    heartScale.set(withSequence(
      withTiming(1, { duration: 180 }),
      withTiming(1, { duration: 260 }),
      withTiming(0, { duration: 180 }),
    ));
  }

  const handleTap = useDoubleTap(
    () => onTogglePause(swift.id),
    () => {
      // Double tap only ever likes — it never toggles back off, matching the
      // gesture everywhere else it exists.
      if (!likedRef.current) onToggleLike(swift.id, true);
      burstHeart();
    },
  );

  const heartStyle = useAnimatedStyle(() => ({
    opacity: heartScale.get(),
    transform: [{ scale: 0.6 + heartScale.get() * 0.6 }],
  }));

  const showPauseIcon = isActive && pausedByUser && !failed;

  // Track first, flat snapshot second. The snapshot is the attribution as it
  // stood when the Swift was published and survives a track leaving the
  // catalogue — see `SwiftSerializer.get_track` on the server.
  // The server's sticker rows carry no id — it is a local key the composer
  // needed for React and for the drag gesture, and storing one would be
  // storing a value nothing reads back. The index is a stable key here because
  // a published Swift's sticker list never changes.
  const stickers = useMemo(
    () => (swift.stickers ?? []).map((sticker, index) => ({
      ...sticker,
      id: `${swift.id}-${index}`,
    })),
    [swift.stickers, swift.id],
  );

  // Nothing is mounted over the video unless there is something to draw —
  // which is what this card did before the stage existed, when the overlay
  // text was the only layer and was rendered conditionally. Worth keeping:
  // a view over a video surface is exactly what froze the camera preview
  // once, and the cheapest guarantee against a repeat is not to have one.
  const hasOverlay = hasEffect(swift.effect)
    || stickers.length > 0
    || swift.overlay_text.trim().length > 0;

  const audioCredit = swift.track
    ? [swift.track.title, swift.track.artist].filter(Boolean).join(' — ')
    : swift.audio_title || 'Original audio';

  function retry() {
    setFailed(false);
    setAttempt((n) => n + 1);
  }

  // ── Rail handlers ───────────────────────────────────────────────────────────
  // Every one of these is a `useCallback` to keep `memo(SwiftActions)` honest.
  // The ones that depend on `swift.viewer_liked` / `viewer_reposted` do change
  // identity when those flip — which is right, because that is precisely when
  // the rail has to redraw anyway.
  const handleReveal = useCallback(() => onRevealLocation(swift), [onRevealLocation, swift]);
  const handleLike = useCallback(
    () => onToggleLike(swift.id, !swift.viewer_liked),
    [onToggleLike, swift.id, swift.viewer_liked],
  );
  const handleRepost = useCallback(
    () => onToggleRepost(swift.id, !swift.viewer_reposted),
    [onToggleRepost, swift.id, swift.viewer_reposted],
  );
  const handleSave = useCallback(
    () => onToggleSave(swift.id, !swift.viewer_saved),
    [onToggleSave, swift.id, swift.viewer_saved],
  );
  const handleSend = useCallback(() => onSend(swift), [onSend, swift]);
  const handleComment = useCallback(() => onComment(swift), [onComment, swift]);
  const handleMore = useCallback(() => onMore(swift), [onMore, swift]);

  return (
    <View style={[styles.card, { height }]}>
      <Pressable style={styles.fill} onPress={handleTap} accessible={false}>
        {/* Poster underneath the player: covers the first-frame gap while the
            video buffers, and is all that shows if the source fails.
            `recyclingKey` lets expo-image reuse the view as the list recycles
            rows rather than tearing down and rebuilding the decoder. */}
        <Image
          source={{ uri: swift.thumbnail_url }}
          style={styles.fill}
          contentFit="cover"
          recyclingKey={String(swift.id)}
          transition={120}
        />
        {source ? (
          <VideoView
            key={attempt}
            style={[
              styles.fill,
              // A quarter turn swaps the box's axes, so the view is sized to
              // the card's other dimension and re-centred. Without that a 90°
              // Swift renders into a portrait box and is cropped to a slot the
              // creator never framed.
              swift.rotation_deg ? { transform: [{ rotate: `${swift.rotation_deg}deg` }] } : null,
              (swift.rotation_deg === 90 || swift.rotation_deg === 270) && height > 0 && {
                width: height,
                height: cardWidth,
                left: (cardWidth - height) / 2,
                top: (height - cardWidth) / 2,
              },
            ]}
            player={player}
            contentFit="cover"
            nativeControls={false}
            // The feed owns the gestures; the player's own surface must not
            // intercept them or single-tap-to-pause stops working.
            pointerEvents="none"
          />
        ) : null}
      </Pressable>

      {/* Drawn over the video rather than baked into it — see the note at the
          top of the file and services/swifts.ts. The very component the
          composer previewed with, so what a creator framed is what is watched;
          it is `pointerEvents="none"` throughout, which is what keeps a
          sticker from eating the swipe to the next Swift. */}
      {hasOverlay && (
        <SwiftStage
          size={{ width: cardWidth, height }}
          effect={swift.effect ?? ''}
          effectIntensity={swift.effect_intensity ?? 100}
          stickers={stickers}
          overlayText={swift.overlay_text}
          overlayPosition={swift.overlay_position}
        />
      )}

      <Scrim edge="top" height={140} opacity={0.5} />
      <Scrim edge="bottom" height={Math.max(220, navClearance + 160)} />

      {/* Double-tap feedback */}
      <View style={styles.centreOverlay} pointerEvents="none">
        <Animated.View style={heartStyle}>
          <SwiftBurstIcon size={96} color="#FFFFFF" />
        </Animated.View>
      </View>

      {/* Still fetching the first frame. Only on the card being watched — a
          neighbour buffering in the preload window is doing its job quietly. */}
      {buffering && (
        <View style={styles.centreOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="rgba(255,255,255,0.9)" />
        </View>
      )}

      {/* Tap-to-pause feedback */}
      {showPauseIcon && (
        <View style={styles.centreOverlay} pointerEvents="none">
          <SwiftPlayIcon size={64} color="rgba(255,255,255,0.85)" />
        </View>
      )}

      {/* A source that will not play, with a way out. */}
      {failed && (
        <View style={styles.centreOverlay}>
          <Text style={styles.failedTitle}>This Swift wouldn’t play</Text>
          <Pressable
            onPress={retry}
            hitSlop={12}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Try loading this Swift again"
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      )}

      {/* Author + caption + audio */}
      <View style={[styles.meta, { bottom: navClearance + 18 }]} pointerEvents="box-none">
        <View style={styles.authorRow}>
          <Avatar
            uri={swift.author.profile_picture ?? undefined}
            name={swift.author.username}
            size="sm"
            ringColor="#FFFFFF"
          />
          <Text style={styles.username} numberOfLines={1}>@{swift.author.username}</Text>
        </View>
        {/* The caption's hashtags and mentions are pressable — see
            `SwiftCaption`. The meta block is already `pointerEvents="box-none"`
            so the taps that are *not* on a link still fall through to the
            card's own play/pause gesture behind it. */}
        {swift.caption ? (
          <SwiftCaption
            caption={swift.caption}
            mentions={swift.mentions}
            style={styles.caption}
            linkStyle={styles.captionLink}
            numberOfLines={3}
          />
        ) : null}
        <View style={styles.audioRow}>
          <SwiftAudioIcon size={13} color="#FFFFFF" />
          <Text style={styles.audio} numberOfLines={1}>{audioCredit}</Text>
        </View>
      </View>

      <SwiftActions
        locationAvailable={swift.location_available}
        revealState={revealState}
        onRevealLocation={handleReveal}
        isLiked={swift.viewer_liked}
        likeCount={swift.like_count}
        commentCount={swift.comment_count}
        isReposted={swift.viewer_reposted}
        isSaved={swift.viewer_saved}
        repostCount={swift.repost_count}
        allowReposts={swift.allow_reposts && !swift.is_mine}
        allowComments={swift.allow_comments}
        muted={muted}
        onLike={handleLike}
        onComment={handleComment}
        onRepost={handleRepost}
        onSave={handleSave}
        onSend={handleSend}
        onMore={handleMore}
        onToggleMute={onToggleMute}
        bottom={navClearance + 18}
      />

      <SwiftProgress progress={progress} bottom={navClearance} />
    </View>
  );
}

export const SwiftCard = memo(SwiftCardImpl);

const styles = StyleSheet.create({
  card: { width: '100%', backgroundColor: '#000000' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  overlayWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  overlayTop: { justifyContent: 'flex-start', paddingTop: 48 },
  overlayBottom: { justifyContent: 'flex-end', paddingBottom: 48 },
  overlayText: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 26,
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },

  centreOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  failedTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: '#FFFFFF',
  },
  retryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  retryLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: '#FFFFFF',
  },

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
  // Bold rather than tinted: this sits over arbitrary video, where no colour
  // can be relied on to hold contrast, and a link distinguishable only by hue
  // is invisible to anyone who cannot separate the two.
  captionLink: { fontWeight: '800' },
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
