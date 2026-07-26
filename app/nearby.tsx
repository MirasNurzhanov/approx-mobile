import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

import { api } from '@/services/api';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { IconBack } from '@/components/ui/icons';
import {
  RelationshipBadge,
  relationshipLabel,
  type Relationship,
} from '@/components/ui/RelationshipBadge';
import { colors, fonts, type as typography } from '@/constants/theme';

// The non-visual equivalent of the map.
//
// Dots and avatar pins on a map are unreachable with VoiceOver or TalkBack —
// there is nothing to focus and no reading order. This screen carries the same
// data as a linear, labelled list, and is reachable from the map header.

interface NearbyUser {
  id: number;
  username: string;
  profile_picture?: string;
  relationship: Relationship;
  distance_km?: number;
  shared_interests?: string[];
  is_private?: boolean;
  location_precision?: 'precise' | 'approximate';
}

function distanceText(user: NearbyUser): string {
  if (user.distance_km == null) return 'Distance unknown';
  const metres = Math.round(user.distance_km * 1000);
  const rough = user.location_precision === 'approximate';
  if (metres < 1000) return `${rough ? 'About ' : ''}${metres} metres away`;
  return `${rough ? 'About ' : ''}${user.distance_km.toFixed(1)} km away`;
}

/** One sentence containing everything the map conveys visually. */
function summarise(user: NearbyUser): string {
  const parts = [user.username, relationshipLabel(user.relationship), distanceText(user)];
  const shared = user.shared_interests ?? [];
  if (shared.length) {
    parts.push(`${shared.length} shared interest${shared.length === 1 ? '' : 's'}: ${shared.join(', ')}`);
  }
  if (user.is_private) parts.push('Private account');
  return parts.join('. ');
}

export default function NearbyListScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const [users, setUsers] = useState<NearbyUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<NearbyUser[]>('/api/proximity/nearby/');
      setUsers(Array.isArray(data) ? data : []);
      setError(null);
    } catch (e: any) {
      setUsers([]);
      setError(
        e?.response?.status === 400
          ? 'Your location hasn’t been set yet. Open the map once to start sharing it.'
          : 'Couldn’t load people nearby.',
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => pressed && styles.pressed}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <IconBack size={22} color={colors.t1} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} accessibilityRole="header">People nearby</Text>
          <Text style={styles.subtitle}>
            {users === null ? 'Loading…' : `${users.length} within range`}
          </Text>
        </View>
      </View>

      {users === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[styles.list, { paddingBottom: bottom + 32 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {error ? 'Nothing to show' : 'Nobody nearby right now'}
              </Text>
              <Text style={styles.emptyBody}>
                {error ?? 'Aura shows people with shared interests within about 500 metres.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Card
              onPress={() =>
                router.push({
                  pathname: '/profile/[id]',
                  params: { id: item.id, username: item.username },
                })
              }
            >
              {/* One accessible node per person: the screen reader reads the
                  whole summary, rather than five disconnected fragments. */}
              <View
                style={styles.row}
                accessible
                accessibilityRole="button"
                accessibilityLabel={summarise(item)}
                accessibilityHint="Opens their profile"
              >
                <Avatar uri={item.profile_picture} name={item.username} size="md" />
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>{item.username}</Text>
                  <Text style={styles.meta}>{distanceText(item)}</Text>
                  {!!item.shared_interests?.length && (
                    <Text style={styles.meta} numberOfLines={1}>
                      {item.shared_interests.join(' · ')}
                    </Text>
                  )}
                </View>
                <RelationshipBadge relationship={item.relationship} />
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerText: { flex: 1, gap: 2 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.title,
    color: colors.t1,
  },
  subtitle: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3 },

  list: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  info: { flex: 1, gap: 2 },
  name: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  meta: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t2 },

  empty: { alignItems: 'center', paddingTop: 80, gap: 8, paddingHorizontal: 32 },
  emptyTitle: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t2,
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    color: colors.t3,
    textAlign: 'center',
    lineHeight: typography.small * 1.5,
  },

  pressed: { opacity: 0.6 },
});
