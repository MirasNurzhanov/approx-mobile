import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { motionLabel, presenceLabel, type MotionClass, type Presence } from '@/services/presence';
import { Card } from '@/components/ui/Card';
import { IconBack } from '@/components/ui/icons';
import {
  RelationshipBadge,
  relationshipLabel,
  type Relationship,
} from '@/components/ui/RelationshipBadge';
import { fonts, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// The non-visual equivalent of the map.
//
// Dots and avatar pins on a map are unreachable with VoiceOver or TalkBack —
// there is nothing to focus and no reading order. This screen carries the same
// data as a linear, labelled list, and is reachable from the map header.
//
// "The same data" is a promise in both directions. The map draws a stranger as
// a nameless point of light: no username, no face, a distance band rather than
// a reading, and nothing else about them until a mutual Hi. This list used to
// print the name, the avatar's initials, the exact metres and a link to their
// full profile for exactly those people — the anonymous marker and the list of
// who it is, one tap apart. Anyone below `identified` is anonymous here too.

interface NearbyUser {
  id: number;
  username: string;
  profile_picture?: string;
  relationship: Relationship;
  distance_km?: number;
  shared_interests?: string[];
  is_private?: boolean;
  location_precision?: 'precise' | 'approximate';
  /** Absent when this viewer may not see it — render no indicator, not grey. */
  presence?: Presence;
  motion_class?: MotionClass;
}

/** Whose name and face are ours to show. Matches the map's rule exactly: a Hi
 *  in one direction is not an introduction, so `hi_sent` stays anonymous. */
function identified(user: NearbyUser): boolean {
  return user.relationship === 'friend' || user.relationship === 'connected';
}

/**
 * Reading order: friends, then connections, then everyone still anonymous.
 *
 * The server returns whoever happens to be in range, in no order that means
 * anything to the reader — so a friend two streets away could sit below eight
 * unnamed dots. Closeness to *you* is the sort, and distance only breaks ties
 * inside a tier.
 */
const REL_RANK: Record<Relationship, number> = {
  friend:      0,
  connected:   1,
  hi_received: 2,
  hi_sent:     3,
  stranger:    4,
};

function byRelationshipThenDistance(a: NearbyUser, b: NearbyUser): number {
  const rank = (REL_RANK[a.relationship] ?? 9) - (REL_RANK[b.relationship] ?? 9);
  if (rank !== 0) return rank;
  // Unknown distance sorts last rather than first, where Infinity puts it.
  return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity);
}

function distanceText(user: NearbyUser): string {
  if (user.distance_km == null) return 'Distance unknown';
  const metres = Math.round(user.distance_km * 1000);
  const rough = user.location_precision === 'approximate';
  if (metres < 1000) return `${rough ? 'About ' : ''}${metres} metres away`;
  return `${rough ? 'About ' : ''}${user.distance_km.toFixed(1)} km away`;
}

/** The map's stranger reading: near enough to matter, not a fix on a person. */
function distanceBand(user: NearbyUser): string {
  if (user.distance_km == null) return 'Somewhere in range';
  const m = user.distance_km * 1000;
  const band = m < 150 ? 'Close' : m < 400 ? 'Nearby' : 'In range';
  const approx = m < 1000
    ? `about ${Math.max(10, Math.round(m / 10) * 10)} m`
    : `about ${(m / 1000).toFixed(1)} km`;
  return `${band} · ${approx}`;
}

/** One sentence containing everything the map conveys visually — and, for
 *  someone anonymous, only what the map conveys about them. */
function summarise(user: NearbyUser): string {
  const shared = user.shared_interests ?? [];
  const sharedLine = shared.length
    ? `${shared.length} shared interest${shared.length === 1 ? '' : 's'}: ${shared.join(', ')}`
    : null;

  if (!identified(user)) {
    return [
      'Someone nearby',
      relationshipLabel(user.relationship),
      distanceBand(user),
      sharedLine,
      'Anonymous until you both say Hi',
    ].filter(Boolean).join('. ');
  }

  const parts = [user.username, relationshipLabel(user.relationship), distanceText(user)];
  // Both omitted when the API omitted them. Presence is stated in words here
  // because the dot alone is no use to a screen reader, and motion because the
  // map's trail is decorative and hidden from one entirely — this list is where
  // that state becomes readable.
  const presence = presenceLabel(user.presence);
  if (presence) parts.push(presence);
  const motion = motionLabel(user.motion_class);
  if (motion) parts.push(motion.charAt(0).toUpperCase() + motion.slice(1));
  if (sharedLine) parts.push(sharedLine);
  if (user.is_private) parts.push('Private account');
  return parts.join('. ');
}

export default function NearbyListScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

  // Sorted here rather than in `load`, so a refetch that arrives in a different
  // server order doesn't reshuffle the list under the reader's finger.
  const ordered = useMemo(
    () => (users ? [...users].sort(byRelationshipThenDistance) : null),
    [users],
  );

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

      {ordered === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : (
        <FlatList
          data={ordered}
          keyExtractor={(item) => String(item.id)}
          windowSize={5}
          initialNumToRender={8}
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
          renderItem={({ item }) => {
            const known = identified(item);

            const row = (
              // One accessible node per person: the screen reader reads the
              // whole summary, rather than five disconnected fragments.
              <View
                style={styles.row}
                accessible
                accessibilityRole={known ? 'button' : 'text'}
                accessibilityLabel={summarise(item)}
                accessibilityHint={known ? 'Opens their profile' : undefined}
              >
                {known ? (
                  <Avatar uri={item.profile_picture} name={item.username} size="md" presence={item.presence} />
                ) : (
                  // The marker, at avatar size. Not the Avatar component with a
                  // blank name: that renders initials, which is the first letter
                  // of the username we are not showing.
                  <View style={styles.anonAvatar}>
                    <View style={styles.anonGlow} />
                    <View style={styles.anonCore} />
                  </View>
                )}

                <View style={styles.info}>
                  <Text style={[styles.name, !known && styles.nameAnon]} numberOfLines={1}>
                    {known ? item.username : 'Someone nearby'}
                  </Text>
                  <Text style={styles.meta}>
                    {known ? distanceText(item) : distanceBand(item)}
                  </Text>

                  {/* Presence and motion are theirs, not a shared interest —
                      they stay with the people whose name is already visible.
                      The row is one accessible node carrying `summarise`, so
                      these are visual only. */}
                  {known && (item.presence || item.motion_class) && (
                    <Text style={styles.meta} numberOfLines={1} importantForAccessibility="no">
                      {[
                        item.presence?.is_online ? 'Online' : null,
                        item.motion_class === 'fast' ? 'Moving fast' : null,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  )}

                  {/* The one thing a stranger's row is for: why they are on
                      your map at all. */}
                  {!!item.shared_interests?.length && (
                    <Text style={styles.meta} numberOfLines={1}>
                      {item.shared_interests.join(' · ')}
                    </Text>
                  )}

                  {!known && (
                    <Text style={styles.footnote} numberOfLines={1} importantForAccessibility="no">
                      Anonymous until you both say Hi
                    </Text>
                  )}
                </View>

                <RelationshipBadge relationship={item.relationship} />
              </View>
            );

            // No route in for someone anonymous — their profile screen is their
            // name and their face, which is the whole of what this row hides.
            // Say Hi from their marker on the map.
            return known ? (
              <Card
                onPress={() =>
                  router.push({
                    pathname: '/profile/[id]',
                    params: { id: item.id, username: item.username },
                  })
                }
              >
                {row}
              </Card>
            ) : (
              <Card>{row}</Card>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
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
  /** A placeholder for a name, not a name — lighter, so the row doesn't read as
   *  someone called "Someone nearby". */
  nameAnon: { color: colors.t2, fontWeight: '500' },
  meta: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t2 },
  footnote: { fontFamily: fonts.body, fontSize: typography.micro, color: colors.t3 },

  // The stranger marker from the map, at avatar size.
  anonAvatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  anonGlow: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.teal,
    opacity: 0.16,
  },
  anonCore: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.teal },

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
