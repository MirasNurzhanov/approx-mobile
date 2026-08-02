import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { SwiftCard } from '@/components/swifts/SwiftCard';
import { navArcClearance } from '@/components/Speedometer';
import { fonts } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { getSwifts, setSwiftLiked, type Swift } from '@/services/swifts';

// Geometry of the action rail, needed before render to work out how far the
// overlays must sit above the nav arc.
const RAIL_RIGHT = 10;
const RAIL_WIDTH = 52;

/** A card counts as active once most of it is on screen. High enough that two
 *  cards are never both "visible" mid-scroll, which would fight over playback. */
const VIEWABILITY = { itemVisiblePercentThreshold: 80 } as const;

type FeedState = 'loading' | 'ready' | 'error';

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
    fontSize: 17,
    color: colors.t1,
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t3,
  },
  retry: {
    fontFamily: fonts.body,
    fontSize: 14,
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

export function SwiftsFeed() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { bottom: safeBottom } = useSafeAreaInsets();

  const [swifts, setSwifts] = useState<Swift[]>([]);
  const [state, setState] = useState<FeedState>('loading');
  const [activeIndex, setActiveIndex] = useState(0);
  // Muted until the viewer asks otherwise — sound that starts on its own in a
  // public place is the single most hostile default a video feed can have.
  const [muted, setMuted] = useState(true);
  const [height, setHeight] = useState(0);

  const load = useCallback(() => {
    setState('loading');
    getSwifts()
      .then((data) => {
        setSwifts(data);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, []);

  useEffect(load, [load]);

  // Stable identity: FlatList warns and misbehaves if this changes per render.
  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) setActiveIndex(first.index);
    },
  ).current;

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setHeight(e.nativeEvent.layout.height);
  }, []);

  // Optimistic: the count moves under the thumb, and only rolls back if the
  // write actually fails.
  const handleToggleLike = useCallback((id: string, liked: boolean) => {
    setSwifts((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, isLiked: liked, likeCount: s.likeCount + (liked ? 1 : -1) }
          : s,
      ),
    );
    setSwiftLiked(id, liked).catch(() => {
      setSwifts((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, isLiked: !liked, likeCount: s.likeCount + (liked ? -1 : 1) }
            : s,
        ),
      );
    });
  }, []);

  // TODO(swifts): comments sheet, share sheet, and a report/mute menu. Each is a
  // screen of its own; the feed only needs to know they were asked for.
  const noop = useCallback(() => {}, []);

  const navClearance = navArcClearance(RAIL_RIGHT, RAIL_WIDTH) + safeBottom;

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
        <Ionicons name="cloud-offline-outline" size={32} color={colors.t3} />
        <Text style={styles.emptyTitle}>Couldn&apos;t load Swifts</Text>
        <Pressable onPress={load} hitSlop={10}>
          <Text style={styles.retry}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (swifts.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="play-circle-outline" size={32} color={colors.t3} />
        <Text style={styles.emptyTitle}>No Swifts yet</Text>
        <Text style={styles.emptyBody}>Be the first to post one.</Text>
        <Pressable onPress={() => router.push('/swifts/compose')} hitSlop={10}>
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
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <SwiftCard
              swift={item}
              isActive={index === activeIndex}
              muted={muted}
              height={height}
              navClearance={navClearance}
              onToggleMute={() => setMuted((m) => !m)}
              onToggleLike={handleToggleLike}
              onComment={noop}
              onShare={noop}
              onMore={noop}
            />
          )}
          pagingEnabled
          snapToInterval={height}
          snapToAlignment="start"
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={VIEWABILITY}
          // Every card holds a video player, so keeping many mounted is the
          // difference between a smooth feed and an OOM on mid-range Android.
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews
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
        <Ionicons name="add" size={22} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}
