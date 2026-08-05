import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconBack } from '@/components/ui/icons';
import { fonts } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  refreshBlocked,
  unblockUser,
  useBlockedUsers,
  type BlockedUserSummary,
} from '@/services/blocked';

// Settings → Blocked users. Reads the same store as the Chat "Blocked" tab,
// so unblocking here updates there instantly (and vice versa).

export default function BlockedUsersScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { top, bottom } = useSafeAreaInsets();
  const { list } = useBlockedUsers();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    refreshBlocked().catch(() => {});
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshBlocked();
    } catch {}
    // The `catch` swallows everything, so this always runs. Deliberately not a
    // `finally` — React Compiler bails on any component containing one.
    setRefreshing(false);
  };

  function handleUnblock(user: BlockedUserSummary) {
    Alert.alert(
      `Unblock ${user.username}?`,
      'They will be able to see you on the map and contact you again. If you were friends before the block, the friendship is restored.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: () =>
            unblockUser(user.id).catch(() =>
              Alert.alert('Could not unblock', `Unblocking @${user.username} failed. Please try again.`),
            ),
        },
      ],
    );
  }

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [pressed && styles.pressed]}
          onPress={() => router.back()}
          hitSlop={12}
        >
          <IconBack size={22} color={colors.t1} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Blocked users</Text>
          <Text style={styles.subtitle}>They can’t see you, and you can’t see them</Text>
        </View>
      </View>

      {list === null ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => String(item.id)}
          windowSize={5}
          initialNumToRender={8}
          contentContainerStyle={[styles.list, { paddingBottom: bottom + 32 }]}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.cardRow}>
                <Avatar uri={item.profile_picture} name={item.username} size="md" ringColor={colors.t3} />
                <View style={styles.cardBody}>
                  <Text style={styles.cardName}>{item.username}</Text>
                  <Text style={styles.cardSub}>Blocked</Text>
                </View>
                <Button label="Unblock" variant="ghost" size="sm" onPress={() => handleUnblock(item)} />
              </View>
            </Card>
          )}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No blocked users</Text>
              <Text style={styles.emptyMessage}>
                Block someone from their profile or from a chat — they’ll stop seeing you anywhere in
                Aura, and you’ll stop seeing them.
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} colors={[colors.teal]} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.6 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
  },
  headerText: { flex: 1, gap: 2 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 20,
    color: colors.t1,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.t3,
  },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 },

  card: { opacity: 0.9 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardBody: { flex: 1, gap: 3 },
  cardName: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: colors.t1,
  },
  cardSub: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t3,
  },

  emptyWrap: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 36, gap: 8 },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 16,
    color: colors.t2,
  },
  emptyMessage: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t3,
    textAlign: 'center',
    lineHeight: 19,
  },
});
