// Who is allowed on the map, and whose stories are allowed to pin to it.
//
// Split out of app/(tabs)/map.tsx because this is policy, not plumbing. The
// server sends everyone nearby; these two filters decide what the viewer
// actually sees, and getting either one wrong is a privacy question rather
// than a rendering one. They are together in one file so the two audiences —
// "people I can see" and "stories I can see" — are read side by side.

import { useMemo } from 'react';

import type { NearbyUser } from '@/services/mapTypes';
import { useStoryArchive, type Story } from '@/services/stories';

export interface VisiblePeople {
  /** Everyone the viewer is allowed to see, minus themselves. */
  visibleNearby: NearbyUser[];
  /** Their friends' stories and their own, grouped by author for the pins. */
  storiesByAuthor: Map<number, Story[]>;
}

export function useVisiblePeople(
  nearby: NearbyUser[],
  stories: Story[],
  currentUserId: number | null,
  friendIds: Set<number>,
  connectionIds: Set<number>,
): VisiblePeople {
  // Stories deleted from the archive screen vanish here immediately instead of
  // waiting for the next poll.
  const { deletedIds } = useStoryArchive();

  // Stories are friends-only: the backend returns everyone nearby, so drop
  // anything not authored by the current user or one of their friends.
  const storiesByAuthor = useMemo(() => {
    const map = new Map<number, Story[]>();
    for (const story of stories) {
      if (deletedIds.has(story.id)) continue;
      const id = Number(story.author.id);
      if (id !== currentUserId && !friendIds.has(id)) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(story);
    }
    return map;
  }, [stories, currentUserId, friendIds, deletedIds]);

  // Interest matching: friends and connections are always visible; strangers
  // only appear when at least one interest is shared. The backend includes
  // the requester in /nearby/, so until our own id is known we can't tell
  // ourselves apart from strangers — render nobody for that moment instead of
  // briefly treating the owner's zone as a locked stranger zone.
  const visibleNearby = useMemo(() => {
    if (currentUserId === null) return [];
    return nearby.filter((u) => {
      const uid = Number(u.id);
      if (uid === currentUserId) return false;

      // The server's own verdict, and it is the authority: it computes the
      // relationship from the friend and Hi tables on every poll, and it is
      // what puts friends in this payload at any distance in the first place.
      //
      // Checked *before* the local sets, because those come from a separate
      // request that fails silently. When /friends/list/ blipped, `friendIds`
      // stayed empty and the last line below quietly dropped every friend who
      // happened to share no interests — the people most likely to be missed
      // being exactly the ones the map exists to show.
      if (u.relationship === 'friend' || u.relationship === 'connected') return true;
      if (friendIds.has(uid) || connectionIds.has(uid)) return true;

      // Strangers earn their place on the map by sharing something.
      return (u.shared_interests?.length ?? 0) > 0;
    });
  }, [nearby, currentUserId, friendIds, connectionIds]);

  return { visibleNearby, storiesByAuthor };
}
