import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SwiftProfileTile } from '@/components/profile/SwiftProfileSection';
import { IconBack, IconHash } from '@/components/ui/icons';
import { fonts, type ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { contentColumn, useLayoutSize } from '@/hooks/useLayout';
import { fetchHashtagSwifts } from '@/services/swiftComposer';
import type { Swift } from '@/services/swifts';

/**
 * Everything under one hashtag.
 *
 * What makes a tag worth having. Without somewhere to land, a hashtag is
 * decoration: it attaches on publish, it is suggested back in the composer,
 * and pressing it does nothing.
 *
 * ## The count is the viewer's own
 *
 * The header says how many Swifts *this* person can see, not how many carry
 * the tag. The server refuses to publish the second number — see
 * `SwiftHashtagFeedView` — because the gap between the two is a measure of how
 * much is being withheld from you, and a tag page is a conspicuous place to
 * hand somebody that measurement.
 *
 * A tag that exists but has nothing visible is an empty list rather than a
 * "not found": the tag is real, there is simply nothing here for this reader,
 * and saying otherwise would be a different and false claim.
 */
const PAGE = 24;

export default function HashtagScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const layout = useLayoutSize();

  const { name } = useLocalSearchParams<{ name?: string }>();
  const tag = (name ?? '').trim();

  const [items, setItems] = useState<Swift[]>([]);
  const [display, setDisplay] = useState(tag);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  // Guards a second page request while one is in flight, and survives the
  // re-render that `setLoadingMore` causes — state would be read stale by an
  // `onEndReached` that fires twice in the same frame.
  const paging = useRef(false);

  const load = useCallback(async (offset: number) => {
    if (!tag) return;
    try {
      const page = await fetchHashtagSwifts(tag, { limit: PAGE, offset });
      setDisplay(page.tag?.display || tag);
      setCount(page.count);
      setItems((prev) => (offset === 0 ? page.results : [...prev, ...page.results]));
      setExhausted(page.results.length < PAGE);
      setError(null);
    } catch (e: any) {
      // A 404 is the tag itself — unknown, or switched off by a moderator.
      // Worth saying plainly rather than showing an empty grid, which would
      // read as "nobody has used this yet" and invite posting under it.
      setError(
        e?.response?.status === 404
          ? 'There is no such hashtag.'
          : 'Could not load this hashtag.',
      );
      if (offset === 0) setItems([]);
    }
  }, [tag]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load(0).then(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [load]);

  const refresh = useCallback(async () => {
    setExhausted(false);
    await load(0);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (paging.current || exhausted || loading || items.length === 0) return;
    paging.current = true;
    setLoadingMore(true);
    await load(items.length);
    setLoadingMore(false);
    paging.current = false;
  }, [exhausted, loading, items.length, load]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <IconBack size={22} color={colors.t1} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>#{display}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(swift) => String(swift.id)}
        numColumns={3}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[
          styles.list,
          contentColumn(layout),
          { paddingHorizontal: layout.gutter, paddingBottom: insets.bottom + 40 },
        ]}
        renderItem={({ item }) => <SwiftProfileTile swift={item} />}
        refreshControl={
          <RefreshControl
            refreshing={loading && items.length > 0}
            onRefresh={() => { void refresh(); }}
            tintColor={colors.teal}
          />
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => { void loadMore(); }}
        ListHeaderComponent={
          count > 0 ? (
            <Text style={styles.count}>
              {count} {count === 1 ? 'Swift' : 'Swifts'} you can watch
            </Text>
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.teal} style={styles.message} />
          ) : error ? (
            <View style={styles.message}>
              <Text style={styles.body}>{error}</Text>
              <Pressable onPress={() => { void refresh(); }} accessibilityRole="button">
                <Text style={styles.link}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.message}>
              <IconHash size={30} color={colors.t3} />
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.body}>
                No Swifts you can watch carry this hashtag. Yours could be the
                first.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator color={colors.teal} style={styles.footer} /> : null
        }
      />
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' },
  headerSpacer: { minWidth: 44 },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '600',
    color: colors.t1,
  },
  list: { gap: 5 },
  row: { gap: 5 },
  count: { fontFamily: fonts.body, fontSize: 12, color: colors.t3, marginBottom: 12 },
  message: { alignItems: 'center', gap: 8, paddingVertical: 48 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 16, fontWeight: '600', color: colors.t1 },
  body: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  link: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.teal,
    paddingVertical: 8,
  },
  footer: { paddingVertical: 20 },
});
