import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SwiftCreatorActions, SwiftProfileTile } from '@/components/profile/SwiftProfileSection';
import { useCreatorSwifts } from '@/components/profile/useCreatorSwifts';
import { IconBack, IconSwift } from '@/components/ui/icons';
import { fonts, type ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { api } from '@/services/api';
import { CREATOR_PAGE_SIZE } from '@/services/swiftCreator';

type Creator = { id: number; username: string; ghost_mode?: boolean; can_view_swifts?: boolean };

export default function CreatorSwiftsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const creatorId = Number(id);
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [owner, setOwner] = useState(false);
  const [checking, setChecking] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const profileRequest = useRef<AbortController | null>(null);

  const checkAccess = useCallback(async () => {
    profileRequest.current?.abort();
    const controller = new AbortController();
    profileRequest.current = controller;
    setCreator(null);
    setOwner(false);
    setChecking(true);
    setProfileError(null);
    if (!Number.isInteger(creatorId) || creatorId < 1) {
      setProfileError('These Swifts are not available.');
      setChecking(false);
      return;
    }
    await api.get<Creator>('/api/users/profile/', { signal: controller.signal }).then(async ({ data: me }) => {
      const isOwner = me.id === creatorId;
      const profile = isOwner ? me : (await api.get<Creator>(`/api/users/profile/${creatorId}/`, { signal: controller.signal })).data;
      if (controller.signal.aborted) return;
      if (!isOwner && profile.can_view_swifts !== true) {
        setProfileError('These Swifts are not available.');
        return;
      }
      setOwner(isOwner);
      setCreator(profile);
    }).catch(() => {
      if (!controller.signal.aborted) setProfileError('Could not open these Swifts. The profile may be private or unavailable.');
    }).finally(() => {
      if (!controller.signal.aborted) setChecking(false);
    });
  }, [creatorId]);

  useFocusEffect(useCallback(() => {
    void checkAccess();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkAccess();
      else { profileRequest.current?.abort(); setCreator(null); }
    });
    return () => { subscription.remove(); profileRequest.current?.abort(); setCreator(null); };
  }, [checkAccess]));

  const gallery = useCreatorSwifts(creatorId, creator !== null, CREATOR_PAGE_SIZE);
  const emptyMessage = profileError ?? gallery.error;

  return <View style={[styles.root, { paddingTop: insets.top }]}>
    <View style={styles.header}>
      <Pressable style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"><IconBack color={colors.teal} /></Pressable>
      <View style={styles.heading}><Text style={styles.title}>{owner ? 'My Swifts' : 'Swifts'}</Text>{!!creator && <Text style={styles.subtitle}>@{creator.username}</Text>}</View>
      <View style={styles.back} />
    </View>
    <FlatList
      data={creator ? gallery.items : []}
      numColumns={3}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => <SwiftProfileTile swift={item} />}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      columnWrapperStyle={styles.row}
      ListHeaderComponent={owner && creator ? <><SwiftCreatorActions />{creator.ghost_mode && <Text style={styles.note}>Your Swifts are hidden from others while Ghost Mode is on.</Text>}<Text style={styles.note}>Only you can see uploads that are processing, under review or set to Only me.</Text></> : null}
      refreshControl={<RefreshControl refreshing={checking || gallery.loading} onRefresh={() => { void checkAccess(); }} tintColor={colors.teal} />}
      onEndReached={() => { if (!gallery.error) void gallery.loadMore(); }}
      onEndReachedThreshold={0.4}
      ListEmptyComponent={<View style={styles.empty}>
        {checking || (creator && gallery.loading) ? <ActivityIndicator color={colors.teal} size="large" /> : <>
          <IconSwift size={40} color={colors.t3} />
          <Text style={styles.emptyTitle}>{emptyMessage ? 'Swifts unavailable' : 'No Swifts yet'}</Text>
          <Text style={styles.note}>{emptyMessage ?? (owner ? 'Upload your first Swift to start your collection.' : 'Shared videos will appear here.')}</Text>
          {!!emptyMessage && <Pressable onPress={() => { void checkAccess(); }} accessibilityRole="button"><Text style={styles.retry}>Try again</Text></Pressable>}
        </>}
      </View>}
      ListFooterComponent={gallery.loadingMore ? <ActivityIndicator color={colors.teal} /> : gallery.items.length > 0 && gallery.error ? <Pressable style={styles.empty} onPress={() => { void gallery.loadMore(); }} accessibilityRole="button"><Text style={styles.note}>{gallery.error}</Text><Text style={styles.retry}>Try again</Text></Pressable> : null}
    />
  </View>;
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  back: { width: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  heading: { flex: 1, alignItems: 'center' },
  title: { fontFamily: fonts.display, fontWeight: '600', fontSize: 20, color: colors.t1 },
  subtitle: { fontFamily: fonts.body, fontSize: 12, color: colors.t2, marginTop: 3 },
  content: { padding: 16, flexGrow: 1 },
  row: { gap: 5 },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.t2, textAlign: 'center', marginBottom: 16 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 12 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 20, fontWeight: '600', color: colors.t1 },
  retry: { fontFamily: fonts.body, fontWeight: '600', fontSize: 14, color: colors.teal, padding: 12 },
});
