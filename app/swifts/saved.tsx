import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SwiftProfileTile } from '@/components/profile/SwiftProfileSection';
import { useSavedSwifts } from '@/components/profile/useSavedSwifts';
import { IconBack, IconSwift } from '@/components/ui/icons';
import { fonts, type ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { contentColumn, useLayoutSize } from '@/hooks/useLayout';

/**
 * Everything on the shortlist, behind Profile → Swifts → Saved → See all.
 *
 * No access check, unlike the creator gallery next door. That screen has to ask
 * "may this viewer see this person's Swifts", because it can be opened against
 * anybody. A shortlist is only ever the signed-in user's own — the server reads
 * it off the session and there is no id in the route to point somewhere else —
 * so there is no question to ask and no id to validate.
 *
 * The list can be shorter than the number of things saved. A Swift made private
 * or taken down since it was saved drops out, while the bookmark itself
 * survives on the server; a shortlist is not a way to keep watching something
 * its author has withdrawn.
 */
const PAGE = 24;

export default function SavedSwiftsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const layout = useLayoutSize();
  const { items, count, loading, loadingMore, error, refresh, loadMore } =
    useSavedSwifts(true, PAGE);

  const onRefresh = useCallback(() => { void refresh(); }, [refresh]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <IconBack size={22} color={colors.t1} />
        </Pressable>
        <Text style={styles.title}>Saved</Text>
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
          <RefreshControl refreshing={loading && items.length > 0} onRefresh={onRefresh} tintColor={colors.teal} />
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => { void loadMore(); }}
        ListHeaderComponent={
          count > 0
            ? <Text style={styles.count}>{count} saved{' '}· only you can see this</Text>
            : null
        }
        ListEmptyComponent={
          loading ? <ActivityIndicator color={colors.teal} style={styles.message} />
            : error ? (
              <View style={styles.message}>
                <Text style={styles.body}>{error}</Text>
                <Pressable onPress={onRefresh} accessibilityRole="button">
                  <Text style={styles.link}>Try again</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.message}>
                <IconSwift size={30} color={colors.t3} />
                <Text style={styles.emptyTitle}>Nothing saved yet</Text>
                <Text style={styles.body}>
                  Tap the bookmark on a Swift and it waits here. Only you can see this list.
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
  title: { fontFamily: fonts.display, fontSize: 18, fontWeight: '600', color: colors.t1 },
  list: { gap: 5 },
  row: { gap: 5 },
  count: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.t3,
    marginBottom: 12,
  },
  message: { alignItems: 'center', gap: 8, paddingVertical: 48 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 16, fontWeight: '600', color: colors.t1 },
  body: { fontFamily: fonts.body, fontSize: 13, color: colors.t2, textAlign: 'center' },
  link: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.teal, paddingVertical: 8 },
  footer: { paddingVertical: 20 },
});
