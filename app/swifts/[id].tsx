import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SwiftCard } from '@/components/swifts/SwiftCard';
import { SwiftCommentsSheet } from '@/components/swifts/SwiftCommentsSheet';
import { SwiftReviewNotice } from '@/components/swifts/SwiftReviewNotice';
import { SwiftLocationSheet } from '@/components/swifts/SwiftLocationSheet';
import type { RevealState } from '@/components/swifts/SwiftLocationButton';
import { SwiftEmptyIcon } from '@/components/swifts/icons';
import { IconChart, IconClose } from '@/components/ui/icons';
import { fonts, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  fetchSwift,
  recordSwiftView,
  revealSwiftLocation,
  setSwiftLiked,
  setSwiftReposted,
  setSwiftSaved,
  deleteSwift,
  SwiftLocationUnavailable,
  type Swift,
  type SwiftLocation,
} from '@/services/swifts';
import { useContentActions } from '@/components/ContentActions';
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

/** How often to ask whether moderation has finished, and how many times. Four
 *  seconds is faster than a person gives up and slow enough to be free; ten
 *  ticks is forty seconds, which covers the ordinary case comfortably. */
const REVIEW_POLL_MS = 4000;
const MAX_REVIEW_POLLS = 10;

export default function SwiftDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const swiftId = Number(id);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [swift, setSwift] = useState<Swift | null>(null);
  const { present, sheets } = useContentActions();
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
  const requestVersion = useRef(0);

  const load = useCallback(() => {
    const version = ++requestVersion.current;
    setSwift(null);
    if (!Number.isFinite(swiftId)) {
      setState('error');
      return;
    }
    setState('loading');
    fetchSwift(swiftId)
      .then((s) => {
        if (version !== requestVersion.current) return;
        setSwift(s);
        setState('ready');
      })
      .catch(() => { if (version === requestVersion.current) setState('error'); });
  }, [swiftId]);

  // Revalidate saved links when returning from settings or analytics. A hidden
  // creator must not survive as a cached video after the screen was left.
  useFocusEffect(useCallback(() => {
    load();
    return () => {
      requestVersion.current += 1;
      setSwift(null);
      setState('loading');
      setReveal(null);
      setRevealState('idle');
      setCommentsOpen(false);
    };
  }, [load]));

  useEffect(() => {
    if (state === 'ready' && swift && !viewedRef.current) {
      viewedRef.current = true;
      recordSwiftView(swift.id).catch(() => { viewedRef.current = false; });
    }
  }, [state, swift]);

  /**
   * Re-fetch while the Swift is still on its way to being public.
   *
   * The verdict arrives asynchronously — `swifts.ai_moderation` runs the
   * classifier off the request that created the row — so there is nothing to
   * wait on synchronously and nothing pushed. Polling this one screen is the
   * whole client-side cost of that: the creator who is looking at their new
   * Swift sees it turn from "being reviewed" into a live video without doing
   * anything, and nobody who is not looking at it polls at all.
   *
   * Bounded on purpose. A Swift the classifier could not settle stays
   * `reviewing` until a sweeper or a moderator moves it, which can be minutes,
   * and an unbounded 4-second poll on a screen somebody left open is a battery
   * complaint. After the cap the notice simply stays put — reopening the screen
   * fetches the current state, which is what somebody coming back to check
   * would do anyway.
   */
  const pollsRef = useRef(0);
  const reviewState = swift?.review_state ?? 'published';
  const settling = state === 'ready'
    && (reviewState === 'reviewing' || reviewState === 'processing');

  useEffect(() => {
    if (!settling || !Number.isFinite(swiftId)) return undefined;
    if (pollsRef.current >= MAX_REVIEW_POLLS) return undefined;

    const timer = setTimeout(() => {
      pollsRef.current += 1;
      const version = requestVersion.current;
      fetchSwift(swiftId).then((fresh) => {
        if (version === requestVersion.current) setSwift(fresh);
      }).catch(() => {
        // A transient failure here is not worth surfacing: the Swift on screen
        // is still the last good copy, and the next tick tries again.
      });
    }, REVIEW_POLL_MS);
    return () => clearTimeout(timer);
    // `swift` is in the deps so each completed fetch schedules the next tick.
  }, [settling, swiftId, swift]);

  const handleLayout = (e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height);

  // `useCallback` because `handleMore` depends on it — an unmemoised `close`
  // would change identity every render and take the memoised handler with it.
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/swifts');
  }, [router]);

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

  /** Save / un-save. No signal reported and no counter to move — see the feed
   *  handler for why a shortlist must not feed the recommender. */
  const handleToggleSave = useCallback((swiftId: number, saved: boolean) => {
    setSwift((prev) => (
      prev && prev.id === swiftId ? { ...prev, viewer_saved: saved } : prev
    ));
    setSwiftSaved(swiftId, saved).catch(() => {
      setSwift((prev) => (
        prev && prev.id === swiftId ? { ...prev, viewer_saved: !saved } : prev
      ));
    });
  }, []);

  // ── Reveal — same rule as the feed: only ever called from a press. ─────────
  const handleReveal = useCallback(async (target: Swift) => {
    const version = requestVersion.current;
    reportSwiftSignal({ kind: 'location_reveal', swift_id: target.id });
    setRevealState('loading');
    setReveal({ location: null, error: null });
    try {
      const location = await revealSwiftLocation(target.id);
      if (version !== requestVersion.current) return;
      setReveal({ location, error: null });
      setRevealState('revealed');
    } catch (e) {
      if (version !== requestVersion.current) return;
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
  // Same menu as the feed's. On a permalink there is no list to prune, so a
  // block closes the screen instead — leaving a blocked author's Swift on
  // screen would read as the block not having worked.
  const handleMore = useCallback((target: Swift) => {
    present({
      target: 'swift',
      targetId: target.id,
      subject: `@${target.author.username}`,
      authorId: target.author.id,
      authorUsername: target.author.username,
      authorAvatar: target.author.profile_picture ?? undefined,
      onRemoved: close,
      // Only your own — same `is_mine` gate as the feed. Leaving the screen is
      // the whole cleanup here: there is no list to splice, and staying on the
      // detail page for a Swift that no longer exists would just 404 on the
      // next fetch.
      ...(target.is_mine ? {
        deleteNoun: 'Swift',
        onDelete: async () => { await deleteSwift(target.id); close(); },
      } : {}),
    });
  }, [present, close]);
  const handleTogglePause = useCallback(() => setPaused((p) => !p), []);
  const handleToggleMute = useCallback(() => setMuted((m) => !m), []);

  return (
    <View style={styles.root} onLayout={handleLayout}>
      {sheets}
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

      {state === 'ready' && swift && swift.is_mine && (
        <SwiftReviewNotice state={reviewState} top={insets.top + 56} />
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
          onToggleSave={handleToggleSave}
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

      {state === 'ready' && swift?.is_mine && <Pressable
        style={[styles.analyticsBtn, { top: insets.top + 10 }]}
        accessibilityRole="button"
        accessibilityLabel="View analytics for this Swift"
        onPress={() => router.push({ pathname: '/swifts/analytics', params: { swift_id: String(swift.id) } })}
      >
        <IconChart size={18} color="#FFFFFF" /><Text style={styles.analyticsText}>Analytics</Text>
      </Pressable>}

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
        swiftId={swift?.id ?? null}
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
  analyticsBtn: {
    position: 'absolute', right: 14, minHeight: 40, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.65)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  analyticsText: { fontFamily: fonts.body, fontSize: 12, color: '#FFFFFF', fontWeight: '600' },
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
