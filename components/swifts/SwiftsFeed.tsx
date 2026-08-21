import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SwiftCard } from '@/components/swifts/SwiftCard';
import { SwiftCommentsSheet } from '@/components/swifts/SwiftCommentsSheet';
import { SwiftLocationSheet } from '@/components/swifts/SwiftLocationSheet';
import type { RevealState } from '@/components/swifts/SwiftLocationButton';
import { SwiftEmptyIcon, SwiftPlusIcon } from '@/components/swifts/icons';
import { isCardActive, shouldPreload } from '@/components/swifts/feedWindow';
import { fonts, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { useNavClearance } from '@/hooks/useNavMetrics';
import {
  FEED_PAGE_SIZE,
  fetchSwiftFeed,
  recordSwiftView,
  revealSwiftLocation,
  setSwiftLiked,
  setSwiftReposted,
  SwiftLocationUnavailable,
  type Swift,
  type SwiftLocation,
} from '@/services/swifts';

/**
 * The Swifts feed.
 *
 * ## Exactly one video plays, ever
 *
 * Three things can silence the feed and they are folded into one value here
 * rather than being three listeners inside the card:
 *
 *   * the card is not the one on screen (`activeIndex`),
 *   * the screen lost focus — the viewer switched tabs or pushed a screen
 *     (`useFocusEffect`),
 *   * the app went to the background (`AppState`).
 *
 * `isActive` is the conjunction, computed once and handed down. The failure
 * this design exists to prevent is audible: two players running at once is the
 * most noticeable bug a video feed can have, and it happens precisely when two
 * components each believe they are in charge of playback.
 *
 * ## Preloading
 *
 * `PRELOAD_AHEAD` cards ahead and one behind hold a real video source; every
 * other mounted card is handed `null` and keeps only its poster. So scrolling
 * is smooth because the next Swift is already buffering, while a card five
 * rows away costs an image rather than a decoder. On a low-end Android that
 * difference is the whole reason the feed does not get killed for memory.
 *
 * ## The location rule
 *
 * `revealSwiftLocation` is called from `handleReveal` and nowhere else — never
 * on render, never on mount, never from the pager. Paging fetches feed rows,
 * and feed rows have no coordinate fields at all, so prefetch cannot carry one
 * even in principle. At most one coordinate is in memory at a time, in
 * `activeReveal`, and it is dropped when the sheet closes.
 * `swiftLocationPrivacy.test.tsx` asserts all of this.
 */

const RAIL_RIGHT = 10;
const RAIL_WIDTH = 52;

/** A card counts as active once most of it is on screen. High enough that two
 *  cards are never both "visible" mid-scroll, which would fight over playback. */
const VIEWABILITY = { itemVisiblePercentThreshold: 80 } as const;

type FeedState = 'loading' | 'ready' | 'error';

export function SwiftsFeed() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const { bottom: safeBottom } = useSafeAreaInsets();

  const [swifts, setSwifts] = useState<Swift[]>([]);
  const [state, setState] = useState<FeedState>('loading');
  const [activeIndex, setActiveIndex] = useState(0);
  const [pausedId, setPausedId] = useState<number | null>(null);
  // Muted until the viewer asks otherwise — sound that starts on its own in a
  // public place is the single most hostile default a video feed can have.
  const [muted, setMuted] = useState(true);
  const [height, setHeight] = useState(0);
  const [paging, setPaging] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  // ── What silences the feed ─────────────────────────────────────────────────
  const [screenFocused, setScreenFocused] = useState(true);
  const [appActive, setAppActive] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setAppActive(next === 'active');
    });
    return () => sub.remove();
  }, []);

  const playbackAllowed = screenFocused && appActive;

  // ── Reveal state ───────────────────────────────────────────────────────────
  /** Ids only. Never a coordinate — see the component note. */
  const [revealedIds, setRevealedIds] = useState<Set<number>>(() => new Set());
  const [revealingId, setRevealingId] = useState<number | null>(null);
  /** The one location in memory, for the duration of the open sheet. */
  const [activeReveal, setActiveReveal] = useState<{
    swiftId: number;
    authorName: string;
    location: SwiftLocation | null;
    error: string | null;
  } | null>(null);

  const [commentsFor, setCommentsFor] = useState<Swift | null>(null);

  /** Swifts already reported as watched this session, so a remount does not
   *  re-POST. The server is idempotent anyway; this saves the round trip. */
  const reportedViews = useRef<Set<number>>(new Set());

  const load = useCallback(() => {
    fetchSwiftFeed(0)
      .then((page) => {
        setSwifts(page.results);
        setExhausted(page.results.length < FEED_PAGE_SIZE);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, []);

  useEffect(load, [load]);

  const retry = () => {
    setState('loading');
    load();
  };

  const loadMore = useCallback(() => {
    if (paging || exhausted || state !== 'ready') return;
    setPaging(true);
    fetchSwiftFeed(swifts.length)
      .then((page) => {
        // Feed rows carry no location fields, so paging ahead cannot bring a
        // coordinate with it — there is nothing to strip because there is
        // nothing to strip on the wire.
        setSwifts((prev) => [...prev, ...page.results]);
        if (page.results.length < FEED_PAGE_SIZE) setExhausted(true);
      })
      .catch(() => setExhausted(true))
      .finally(() => setPaging(false));
  }, [paging, exhausted, state, swifts.length]);

  // Stable identity: FlatList warns and misbehaves if this changes per render.
  const [handleViewableItemsChanged] = useState(() => {
    return ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index == null) return;
      setActiveIndex(first.index);
      // Scrolling to another Swift ends the manual pause here, in the event
      // that causes it, rather than in an effect inside the card.
      setPausedId(null);

      const swift = first.item as Swift | undefined;
      if (swift && !reportedViews.current.has(swift.id)) {
        reportedViews.current.add(swift.id);
        // Fire and forget. A failed view report costs the viewer the ability
        // to reveal that Swift's location later, which is the correct
        // failure — the gate is the server's row, not our optimism.
        recordSwiftView(swift.id).catch(() => {
          reportedViews.current.delete(swift.id);
        });
      }
    };
  });

  const handleLayout = (e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height);

  // ── Engagement ─────────────────────────────────────────────────────────────
  /** Apply a change to one Swift in the list, by id. */
  const patchSwift = useCallback((id: number, patch: Partial<Swift>) => {
    setSwifts((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  // Optimistic: the count moves under the thumb, and only rolls back if the
  // write actually fails.
  const handleToggleLike = useCallback((id: number, liked: boolean) => {
    setSwifts((prev) => prev.map((s) => (
      s.id === id
        ? { ...s, viewer_liked: liked, like_count: Math.max(0, s.like_count + (liked ? 1 : -1)) }
        : s
    )));
    setSwiftLiked(id, liked)
      // The server returns the authoritative count; take it rather than
      // trusting our arithmetic, which can drift if two devices are liking.
      .then((count) => patchSwift(id, { like_count: count }))
      .catch(() => {
        setSwifts((prev) => prev.map((s) => (
          s.id === id
            ? {
                ...s,
                viewer_liked: !liked,
                like_count: Math.max(0, s.like_count + (liked ? -1 : 1)),
              }
            : s
        )));
      });
  }, [patchSwift]);

  const handleToggleRepost = useCallback((id: number, reposted: boolean) => {
    setSwifts((prev) => prev.map((s) => (
      s.id === id
        ? {
            ...s,
            viewer_reposted: reposted,
            repost_count: Math.max(0, s.repost_count + (reposted ? 1 : -1)),
          }
        : s
    )));
    setSwiftReposted(id, reposted)
      .then((count) => patchSwift(id, { repost_count: count }))
      .catch(() => {
        setSwifts((prev) => prev.map((s) => (
          s.id === id
            ? {
                ...s,
                viewer_reposted: !reposted,
                repost_count: Math.max(0, s.repost_count + (reposted ? -1 : 1)),
              }
            : s
        )));
      });
  }, [patchSwift]);

  const handleCommentCount = useCallback((swiftId: number, delta: number) => {
    setSwifts((prev) => prev.map((s) => (
      s.id === swiftId
        ? { ...s, comment_count: Math.max(0, s.comment_count + delta) }
        : s
    )));
  }, []);

  // ── Reveal ─────────────────────────────────────────────────────────────────
  /**
   * The only caller of `revealSwiftLocation` in the app.
   *
   * Runs on a press and nowhere else — not on render, not on mount, not from
   * the pager.
   */
  const handleReveal = useCallback(async (swift: Swift) => {
    setRevealingId(swift.id);
    setActiveReveal({
      swiftId: swift.id,
      authorName: swift.author.username,
      location: null,
      error: null,
    });
    try {
      const location = await revealSwiftLocation(swift.id);
      setActiveReveal((prev) =>
        prev && prev.swiftId === swift.id ? { ...prev, location } : prev,
      );
      setRevealedIds((prev) => new Set(prev).add(swift.id));
    } catch (e) {
      const message = e instanceof SwiftLocationUnavailable
        ? e.message
        : 'Couldn’t load the location.';
      setActiveReveal((prev) =>
        prev && prev.swiftId === swift.id ? { ...prev, error: message } : prev,
      );
    } finally {
      setRevealingId(null);
    }
  }, []);

  function closeReveal() {
    // Drops the only copy of the coordinate this app was holding.
    setActiveReveal(null);
  }

  function revealStateFor(swift: Swift): RevealState {
    if (revealingId === swift.id) return 'loading';
    return revealedIds.has(swift.id) ? 'revealed' : 'idle';
  }

  const handleComment = useCallback((swift: Swift) => setCommentsFor(swift), []);
  const handleMore = useCallback(() => {}, []);
  const handleToggleMute = useCallback(() => setMuted((m) => !m), []);

  const navClearance = useNavClearance(RAIL_RIGHT, RAIL_WIDTH) + safeBottom;

  // ── States ──────────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={styles.center}>
        <SwiftEmptyIcon size={32} color={colors.t3} />
        <Text style={styles.emptyTitle}>Couldn&apos;t load Swifts</Text>
        <Pressable onPress={retry} hitSlop={10} accessibilityRole="button">
          <Text style={styles.retry}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (swifts.length === 0) {
    return (
      <View style={styles.center}>
        <SwiftEmptyIcon size={32} color={colors.t3} />
        <Text style={styles.emptyTitle}>No Swifts yet</Text>
        <Text style={styles.emptyBody}>Be the first to post one.</Text>
        <Pressable
          onPress={() => router.push('/swifts/compose')}
          hitSlop={10}
          accessibilityRole="button"
        >
          <Text style={styles.retry}>Create a Swift</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root} onLayout={handleLayout}>
      {height > 0 && (
        <FlatList
          data={swifts}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item, index }) => (
            <SwiftCard
              swift={item}
              isActive={isCardActive(index, activeIndex, playbackAllowed)}
              preload={shouldPreload(index, activeIndex)}
              pausedByUser={pausedId === item.id}
              muted={muted}
              height={height}
              navClearance={navClearance}
              revealState={revealStateFor(item)}
              onRevealLocation={handleReveal}
              onTogglePause={() => setPausedId((p) => (p === item.id ? null : item.id))}
              onToggleMute={handleToggleMute}
              onToggleLike={handleToggleLike}
              onToggleRepost={handleToggleRepost}
              onComment={handleComment}
              onMore={handleMore}
            />
          )}
          pagingEnabled
          snapToInterval={height}
          snapToAlignment="start"
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={VIEWABILITY}
          onEndReached={loadMore}
          onEndReachedThreshold={2}
          // Every card holds a video player, so keeping many mounted is the
          // difference between a smooth feed and an OOM on mid-range Android.
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          // Deliberately off. On Android `removeClippedSubviews` detaches views
          // that native video surfaces are still bound to, which shows up as a
          // black card on scroll-back. `windowSize={3}` plus the `preload`
          // window already bounds what is mounted, so this bought nothing and
          // cost correctness.
          removeClippedSubviews={false}
          getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
        />
      )}

      {/* Composer entry point */}
      <Pressable
        style={[styles.composeBtn, { top: safeBottom + 14 }]}
        onPress={() => router.push('/swifts/compose')}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Create a Swift"
      >
        <SwiftPlusIcon size={22} color="#FFFFFF" />
      </Pressable>

      <SwiftCommentsSheet
        visible={commentsFor !== null}
        swiftId={commentsFor?.id ?? null}
        allowComments={commentsFor?.allow_comments ?? true}
        onClose={() => setCommentsFor(null)}
        onCountChange={handleCommentCount}
      />

      <SwiftLocationSheet
        visible={activeReveal !== null}
        location={activeReveal?.location ?? null}
        loading={activeReveal !== null && !activeReveal.location && !activeReveal.error}
        error={activeReveal?.error ?? null}
        authorName={activeReveal?.authorName ?? ''}
        onClose={closeReveal}
        onRetry={() => {
          const swift = swifts.find((s) => s.id === activeReveal?.swiftId);
          if (swift) void handleReveal(swift);
        }}
      />
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.bg,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    color: colors.t3,
  },
  retry: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    fontWeight: '600',
    color: colors.teal,
    marginTop: 4,
  },
  composeBtn: {
    position: 'absolute',
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
});
