import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SwiftCard } from '@/components/swifts/SwiftCard';
import { SwiftCommentsSheet } from '@/components/swifts/SwiftCommentsSheet';
import { SwiftLocationSheet } from '@/components/swifts/SwiftLocationSheet';
import type { RevealState } from '@/components/swifts/SwiftLocationButton';
import { SwiftEmptyIcon } from '@/components/swifts/icons';
import { IconClose } from '@/components/ui/icons';
import { fonts, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  fetchSwift,
  recordSwiftView,
  revealSwiftLocation,
  setSwiftLiked,
  setSwiftReposted,
  SwiftLocationUnavailable,
  type Swift,
  type SwiftLocation,
} from '@/services/swifts';
import { reportSwiftSignal } from '@/services/swiftSignals';

/**
 * One Swift, on its own — reached from `swifts/compose` on publish, and by
 * anything else that wants to link straight to a single video rather than the
 * ranked feed.
 *
 * The ranked feed at `/(tabs)/swifts` never contains the viewer's own posts —
 * `recs/candidates.py` excludes the author from their own candidate pool, the
 * same as any other For You feed — so publish cannot land there and expect the
 * new Swift to be on screen. This route is a permalink instead: it fetches
 * one row through `SwiftDetailView` (author-visible regardless of ranking) and
 * renders it with the same `SwiftCard` the feed uses, just without a pager.
 */

type ScreenState = 'loading' | 'ready' | 'error';

export default function SwiftDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const swiftId = Number(id);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [swift, setSwift] = useState<Swift | null>(null);
  const [state, setState] = useState<ScreenState>('loading');
  const [height, setHeight] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const [revealState, setRevealState] = useState<RevealState>('idle');
  const [reveal, setReveal] = useState<{
    location: SwiftLocation | null;
    error: string | null;
  } | null>(null);

  /** One `view` per mount, matching the feed's per-session dedupe — the server
   *  is idempotent anyway, this just saves the round trip. */
  const viewedRef = useRef(false);

  const load = useCallback(() => {
    if (!Number.isFinite(swiftId)) {
      setState('error');
      return;
    }
    setState('loading');
    fetchSwift(swiftId)
      .then((s) => {
        setSwift(s);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [swiftId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (state === 'ready' && swift && !viewedRef.current) {
      viewedRef.current = true;
      recordSwiftView(swift.id).catch(() => { viewedRef.current = false; });
    }
  }, [state, swift]);

  const handleLayout = (e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/swifts');
  };

  // ── Engagement — the same optimistic pattern as SwiftsFeed, over one row
  //    instead of a list. ─────────────────────────────────────────────────────
  const handleToggleLike = useCallback((swiftId: number, liked: boolean) => {
    if (liked) reportSwiftSignal({ kind: 'like', swift_id: swiftId });
    setSwift((prev) => (
      prev && prev.id === swiftId
        ? { ...prev, viewer_liked: liked, like_count: Math.max(0, prev.like_count + (liked ? 1 : -1)) }
        : prev
    ));
    setSwiftLiked(swiftId, liked)
      .then((count) => setSwift((prev) => (prev && prev.id === swiftId ? { ...prev, like_count: count } : prev)))
      .catch(() => {
        setSwift((prev) => (
          prev && prev.id === swiftId
            ? {
                ...prev,
                viewer_liked: !liked,
                like_count: Math.max(0, prev.like_count + (liked ? -1 : 1)),
              }
            : prev
        ));
      });
  }, []);

  const handleToggleRepost = useCallback((swiftId: number, reposted: boolean) => {
    if (reposted) reportSwiftSignal({ kind: 'repost', swift_id: swiftId });
    setSwift((prev) => (
      prev && prev.id === swiftId
        ? {
            ...prev,
            viewer_reposted: reposted,
            repost_count: Math.max(0, prev.repost_count + (reposted ? 1 : -1)),
          }
        : prev
    ));
    setSwiftReposted(swiftId, reposted)
      .then((count) => setSwift((prev) => (prev && prev.id === swiftId ? { ...prev, repost_count: count } : prev)))
      .catch(() => {
        setSwift((prev) => (
          prev && prev.id === swiftId
            ? {
                ...prev,
                viewer_reposted: !reposted,
                repost_count: Math.max(0, prev.repost_count + (reposted ? -1 : 1)),
              }
            : prev
        ));
      });
  }, []);

  // ── Reveal — same rule as the feed: only ever called from a press. ─────────
  const handleReveal = useCallback(async (target: Swift) => {
    reportSwiftSignal({ kind: 'location_reveal', swift_id: target.id });
    setRevealState('loading');
    setReveal({ location: null, error: null });
    try {
      const location = await revealSwiftLocation(target.id);
      setReveal({ location, error: null });
      setRevealState('revealed');
    } catch (e) {
      const message = e instanceof SwiftLocationUnavailable
        ? e.message
        : 'Couldn’t load the location.';
      setReveal({ location: null, error: message });
      setRevealState('idle');
    }
  }, []);

  const handleComment = useCallback((target: Swift) => {
    reportSwiftSignal({ kind: 'comment', swift_id: target.id });
    setCommentsOpen(true);
  }, []);
  const handleCommentCount = useCallback((swiftId: number, delta: number) => {
    setSwift((prev) => (
      prev && prev.id === swiftId
        ? { ...prev, comment_count: Math.max(0, prev.comment_count + delta) }
        : prev
    ));
  }, []);
  const handleMore = useCallback(() => {}, []);
  const handleTogglePause = useCallback(() => setPaused((p) => !p), []);
  const handleToggleMute = useCallback(() => setMuted((m) => !m), []);

  return (
    <View style={styles.root} onLayout={handleLayout}>
      {state === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color="#FFFFFF" size="large" />
        </View>
      )}

      {state === 'error' && (
        <View style={styles.center}>
          <SwiftEmptyIcon size={32} color={colors.t3} />
          <Text style={styles.emptyTitle}>Couldn&apos;t load that Swift</Text>
          <Pressable onPress={load} hitSlop={10} accessibilityRole="button">
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      )}

      {state === 'ready' && swift && height > 0 && (
        <SwiftCard
          swift={swift}
          isActive={!paused}
          preload
          pausedByUser={paused}
          muted={muted}
          height={height}
          navClearance={insets.bottom}
          revealState={revealState}
          onRevealLocation={handleReveal}
          onTogglePause={handleTogglePause}
          onToggleMute={handleToggleMute}
          onToggleLike={handleToggleLike}
          onToggleRepost={handleToggleRepost}
          onComment={handleComment}
          onMore={handleMore}
        />
      )}

      <Pressable
        style={[styles.closeBtn, { top: insets.top + 10 }]}
        onPress={close}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <IconClose size={20} color="#FFFFFF" />
      </Pressable>

      <SwiftCommentsSheet
        visible={commentsOpen}
        swiftId={swift?.id ?? null}
        allowComments={swift?.allow_comments ?? true}
        onClose={() => setCommentsOpen(false)}
        onCountChange={handleCommentCount}
      />

      <SwiftLocationSheet
        visible={reveal !== null}
        location={reveal?.location ?? null}
        loading={reveal !== null && !reveal.location && !reveal.error}
        error={reveal?.error ?? null}
        authorName={swift?.author.username ?? ''}
        onClose={() => setReveal(null)}
        onRetry={() => { if (swift) void handleReveal(swift); }}
      />
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: '#FFFFFF',
  },
  retry: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    fontWeight: '600',
    color: colors.teal,
    marginTop: 4,
  },
  closeBtn: {
    position: 'absolute',
    left: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
});
