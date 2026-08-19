import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

import { api } from '@/services/api';
import { Avatar } from '@/components/ui/Avatar';
import type { Presence } from '@/services/presence';
import { Card } from '@/components/ui/Card';
import { IconBack } from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// Privacy & safety → Review connections.
//
// Switching an account to private grandfathers in everyone already connected
// rather than silently dropping them. This screen is the other half of that
// promise: somewhere to see who that actually is, and remove anyone.

interface Person {
  id: number;
  username: string;
  profile_picture?: string;
  tier: 'friend' | 'connection';
  /** Absent when this viewer may not see it — render no indicator, not grey. */
  presence?: Presence;
}

export default function ConnectionsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { top, bottom } = useSafeAreaInsets();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await api.get<{
      friends: { id: number; username: string; profile_picture?: string; presence?: Presence }[];
      connections: { id: number; username: string; profile_picture?: string; presence?: Presence }[];
    }>('/api/friends/list/');

    const friendIds = new Set(data.friends.map((f) => f.id));
    const connectionsOnly: Person[] = [];
    for (const c of data.connections) {
      if (!friendIds.has(c.id)) connectionsOnly.push({ ...c, tier: 'connection' as const });
    }
    setPeople([
      ...data.friends.map((f) => ({ ...f, tier: 'friend' as const })),
      ...connectionsOnly,
    ]);
  }, []);

  useEffect(() => {
    load().catch(() => setPeople([]));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } catch {}
    // The `catch` swallows everything, so this always runs. Deliberately not a
    // `finally` — React Compiler bails on any component containing one.
    setRefreshing(false);
  }, [load]);

  function confirmRemove(person: Person) {
    Alert.alert(
      `Remove ${person.username}?`,
      'They lose access to anything you share with connections, and your chat history with them is deleted. They aren’t told. You can connect again later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const previous = people;
            setRemoving(person.id);
            setPeople((current) => (current ?? []).filter((p) => p.id !== person.id));
            try {
              await api.delete(`/api/friends/${person.id}/remove/`);
            } catch {
              setPeople(previous ?? null);
              Alert.alert('Could not remove', `Removing @${person.username} failed. Please try again.`);
            }
            // Reached on both paths: the `catch` rolls back and stops there.
            setRemoving(null);
          },
        },
      ],
    );
  }

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => pressed && styles.pressed}
          onPress={() => router.back()}
          hitSlop={12}
        >
          <IconBack size={22} color={colors.t1} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Your connections</Text>
          <Text style={styles.subtitle}>Everyone with approved access to your profile</Text>
        </View>
      </View>

      {people === null ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : (
        <FlatList
          data={people}
          keyExtractor={(item) => String(item.id)}
          windowSize={5}
          initialNumToRender={8}
          contentContainerStyle={[styles.list, { paddingBottom: bottom + 32 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No connections yet</Text>
              <Text style={styles.emptyBody}>
                People you accept a Hi from show up here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Card>
              <View style={styles.row}>
                <Avatar uri={item.profile_picture} name={item.username} size="md" presence={item.presence} />
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>{item.username}</Text>
                  <Text style={styles.tier}>
                    {item.tier === 'friend' ? 'Friend' : 'Connection'}
                  </Text>
                </View>
                <Pressable
                  disabled={removing === item.id}
                  onPress={() => confirmRemove(item)}
                  style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
                  hitSlop={6}
                >
                  {removing === item.id ? (
                    <ActivityIndicator color={colors.red} size="small" />
                  ) : (
                    <Text style={styles.removeText}>Remove</Text>
                  )}
                </Pressable>
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.display, fontWeight: '600', fontSize: 22, color: colors.t1 },
  subtitle: { fontFamily: fonts.body, fontSize: 12, color: colors.t3 },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.body, fontWeight: '600', fontSize: 15, color: colors.t1 },
  tier: { fontFamily: fonts.body, fontSize: 12, color: colors.t3 },

  removeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 84,
    alignItems: 'center',
  },
  removeText: { fontFamily: fonts.body, fontWeight: '600', fontSize: 13, color: colors.red },

  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontFamily: fonts.body, fontWeight: '600', fontSize: 16, color: colors.t2 },
  emptyBody: { fontFamily: fonts.body, fontSize: 13, color: colors.t3, textAlign: 'center' },

  pressed: { opacity: 0.6 },
});
