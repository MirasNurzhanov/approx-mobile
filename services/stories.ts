import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { api } from './api';
import { toLatitude, toLongitude, withNumericCoordsList, type Placed } from './coords';

// Shared story types + the story-archive store. The archive ("Mine" = every
// story the user posted, "Starred" = the ones they've favorited among those)
// is cached on device so the archive screen opens instantly and offline; the
// backend stays the source of truth via refresh/loadMore. The map and the
// story viewer mutate through this module too, so every surface stays in sync
// without manual refreshes.
//
// Starring is the author's own act, not a bookmark of someone else's post —
// `Story.is_starred` lives on the row itself, so "Starred" can only ever be a
// subset of "Mine". There is no way to save another user's story.

export type ReactionType = 'like';

export interface StoryAuthor {
  id: number;
  username: string;
  profile_picture?: string;
}

/**
 * A story as the social surfaces know it: an author, a photo, some words.
 *
 * No position, and that is the point. A story is something you show your
 * friends; being on the map is a separate thing you switch on and off, and a
 * story posted while sharing is paused has no coordinate at all — the server
 * refuses to keep one. The chat and archive endpoints do not send the fields
 * either, so these are optional here rather than nullable-and-required.
 */
export interface FeedStory {
  id: number;
  author: StoryAuthor;
  text?: string;
  content?: string;
  image?: string;
  place_name?: string;
  latitude?: number | null;
  longitude?: number | null;
  created_at: string;
  expires_at: string;
  reactions: { like: number };
  user_reaction?: ReactionType | null;
  /** Only ever true for the viewer's own stories — see the module docs. */
  is_starred?: boolean;
}

/** A story the map can actually draw: the same thing, with a real position. */
export type Story = Placed<FeedStory>;

/**
 * Every story that enters this module goes through here.
 *
 * `latitude`/`longitude` arrive from DRF as strings — see services/coords.ts
 * for why that is fatal on the map now. The fix belongs at the boundary rather
 * than at the marker: the archive persists these rows to disk, so a string
 * that got past this point would survive a restart and crash a later session
 * from the cache.
 *
 * Rows without a usable position are *kept*, unlike `placedStories` below. A
 * story with no coordinate is a normal story — its author was paused when they
 * posted it — and dropping it here would hide it from the archive and from the
 * chat surface, neither of which ever needed a position to show it.
 */
export function normalizeStories(stories: FeedStory[] | null | undefined): FeedStory[] {
  if (!Array.isArray(stories)) return [];
  return stories.map((story) => {
    const latitude = toLatitude(story.latitude);
    const longitude = toLongitude(story.longitude);
    return latitude === null || longitude === null
      ? { ...story, latitude: null, longitude: null }
      : { ...story, latitude, longitude };
  });
}

/**
 * The map's normaliser: only the stories it can honestly draw.
 *
 * Two reasons a story arrives without a position, and neither is an error: its
 * author posted it while paused, or they have paused since and the server has
 * stopped sending the coordinate it still holds. Either way there is no point
 * on Earth to put a marker at, so the row is dropped from the map — and kept
 * everywhere else.
 */
export function placedStories(stories: FeedStory[] | null | undefined): Story[] {
  return withNumericCoordsList(stories ?? []) as Story[];
}

/**
 * Live stories from friends, for the rings in Chats.
 *
 * Deliberately not the map's feed. That one needs two positions — the viewer's
 * to anchor it and the author's to have something to draw — and answers with
 * pins. This one needs neither and answers with stories, which is what a ring
 * around somebody's face is actually asking about.
 */
export async function fetchFriendStories(): Promise<FeedStory[]> {
  const { data } = await api.get<{ results: FeedStory[] }>('/api/stories/friends/');
  return normalizeStories(data?.results);
}

/**
 * The feed keyed by author: newest story first within each, and authors in the
 * order they last posted.
 *
 * A pure function, because it is what decides which face carries a ring and
 * what opens when it is tapped — worth being able to test without a screen.
 */
export function groupStoriesByAuthor(stories: FeedStory[]): Map<number, FeedStory[]> {
  const byAuthor = new Map<number, FeedStory[]>();
  const newestFirst = [...stories].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  for (const story of newestFirst) {
    const id = story.author?.id;
    if (typeof id !== 'number') continue;
    const existing = byAuthor.get(id);
    if (existing) existing.push(story);
    else byAuthor.set(id, [story]);
  }
  return byAuthor;
}

export const ARCHIVE_PAGE_SIZE = 30;
const MINE_KEY = 'aura:stories:mine';
const STARRED_KEY = 'aura:stories:starred';
/** The bookmark feature's old cache — dropped alongside it so a stale copy of
 *  someone else's saved stories cannot resurface from disk. */
const LEGACY_SAVED_KEY = 'aura:stories:saved';
const CACHE_LIMIT = 60; // items persisted per list for instant/offline open

export interface StoryArchive {
  /** null = not hydrated yet (neither cache nor network has filled it). */
  mine: FeedStory[] | null;
  starred: FeedStory[] | null;
  /** Server-side totals; null until the first successful fetch. */
  mineTotal: number | null;
  starredTotal: number | null;
  /** Ids of the user's own stories they've starred (drives the viewer's toggle). */
  starredIds: Set<number>;
  /** Own stories deleted this session — the map filters its markers by this. */
  deletedIds: Set<number>;
}

let state: StoryArchive = {
  mine: null,
  starred: null,
  mineTotal: null,
  starredTotal: null,
  starredIds: new Set(),
  deletedIds: new Set(),
};

const listeners = new Set<() => void>();

function setState(patch: Partial<StoryArchive>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Drop the archive, in memory and on disk.
 *
 * The persisted caches exist so the archive screen opens instantly and works
 * offline, which also means they would show the previous account's own and
 * starred stories to whoever signs in next.
 */
export async function resetArchive(): Promise<void> {
  setState({
    mine: null,
    starred: null,
    mineTotal: null,
    starredTotal: null,
    starredIds: new Set(),
    deletedIds: new Set(),
  });
  try {
    await AsyncStorage.multiRemove([MINE_KEY, STARRED_KEY, LEGACY_SAVED_KEY]);
  } catch {}
}

/** Reactive snapshot of the archive for components. */
export function useStoryArchive(): StoryArchive {
  return useSyncExternalStore(subscribe, () => state);
}

export function getStoryArchive(): StoryArchive {
  return state;
}

function starredIdsOf(starred: FeedStory[] | null): Set<number> {
  return new Set((starred ?? []).map((s) => s.id));
}

async function persist(key: string, list: FeedStory[] | null) {
  if (!list) return;
  try {
    await AsyncStorage.setItem(key, JSON.stringify(list.slice(0, CACHE_LIMIT)));
  } catch {}
}

async function loadCache(key: string): Promise<FeedStory[] | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    // Normalised on the way out too: caches written before coordinates were
    // coerced still hold strings.
    return raw ? normalizeStories(JSON.parse(raw) as FeedStory[]) : null;
  } catch {
    return null;
  }
}

/** Fill the store from the on-device cache (no-op for lists already loaded). */
export async function hydrateArchive(): Promise<void> {
  const [mine, starred] = await Promise.all([loadCache(MINE_KEY), loadCache(STARRED_KEY)]);
  const patch: Partial<StoryArchive> = {};
  if (state.mine === null && mine) patch.mine = mine;
  if (state.starred === null && starred) {
    patch.starred = starred;
    patch.starredIds = starredIdsOf(starred);
  }
  if (Object.keys(patch).length > 0) setState(patch);
}

interface ArchivePage {
  count: number;
  results: FeedStory[];
}

export async function refreshMine(): Promise<void> {
  const { data } = await api.get<ArchivePage>('/api/stories/mine/', {
    params: { limit: ARCHIVE_PAGE_SIZE, offset: 0 },
  });
  const mine = normalizeStories(data.results).filter((s) => !state.deletedIds.has(s.id));
  setState({ mine, mineTotal: data.count });
  persist(MINE_KEY, mine);
}

export async function refreshStarred(): Promise<void> {
  const { data } = await api.get<ArchivePage>('/api/stories/starred/', {
    params: { limit: ARCHIVE_PAGE_SIZE, offset: 0 },
  });
  const starred = normalizeStories(data.results);
  setState({ starred, starredTotal: data.count, starredIds: starredIdsOf(starred) });
  persist(STARRED_KEY, starred);
}

async function loadMore(kind: 'mine' | 'starred'): Promise<void> {
  const list = state[kind];
  const total = kind === 'mine' ? state.mineTotal : state.starredTotal;
  if (!list || total === null || list.length >= total) return;
  const url = kind === 'mine' ? '/api/stories/mine/' : '/api/stories/starred/';
  const { data } = await api.get<ArchivePage>(url, {
    params: { limit: ARCHIVE_PAGE_SIZE, offset: list.length },
  });
  const seen = new Set(list.map((s) => s.id));
  const merged = [...list, ...normalizeStories(data.results).filter((s) => !seen.has(s.id))];
  if (kind === 'mine') {
    setState({ mine: merged.filter((s) => !state.deletedIds.has(s.id)), mineTotal: data.count });
  } else {
    setState({ starred: merged, starredTotal: data.count, starredIds: starredIdsOf(merged) });
  }
}

export const loadMoreMine = () => loadMore('mine');
export const loadMoreStarred = () => loadMore('starred');

/** Called by the map right after a successful post — the archive picks the
 * story up immediately instead of waiting for the next fetch. */
export function recordOwnStory(story: FeedStory): void {
  if (state.mine === null) return; // archive never opened; it will fetch fresh
  if (state.mine.some((s) => s.id === story.id)) return;
  const mine = [story, ...state.mine];
  setState({ mine, mineTotal: state.mineTotal === null ? null : state.mineTotal + 1 });
  persist(MINE_KEY, mine);
}

/** Star one of your own stories (optimistic; throws on failure after
 *  rollback). Starring is the author's own act — there is no bookmarking of
 *  anyone else's story, so this only ever touches rows already in "Mine". */
export async function starStory(story: FeedStory): Promise<void> {
  if (state.starredIds.has(story.id)) return;
  const prev = state;
  const entry: FeedStory = { ...story, is_starred: true };
  const starred = [entry, ...(state.starred ?? [])];
  const patch: Partial<StoryArchive> = {
    starred,
    starredIds: starredIdsOf(starred),
    starredTotal: state.starredTotal === null ? null : state.starredTotal + 1,
  };
  if (state.mine) {
    patch.mine = state.mine.map((s) => (s.id === story.id ? { ...s, is_starred: true } : s));
  }
  setState(patch);
  try {
    await api.post(`/api/stories/${story.id}/star/`);
  } catch (e) {
    setState(prev);
    throw e;
  }
  persist(STARRED_KEY, starred);
}

/** Unstar stories — the stories themselves are never touched. */
export async function unstarStories(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const prev = state;
  const drop = new Set(ids);
  const starred = (state.starred ?? []).filter((s) => !drop.has(s.id));
  const patch: Partial<StoryArchive> = {
    starred,
    starredIds: starredIdsOf(starred),
    starredTotal: state.starredTotal === null ? null : Math.max(0, state.starredTotal - ids.length),
  };
  if (state.mine) {
    patch.mine = state.mine.map((s) => (drop.has(s.id) ? { ...s, is_starred: false } : s));
  }
  setState(patch);
  try {
    await Promise.all(ids.map((id) => api.delete(`/api/stories/${id}/star/`)));
  } catch (e) {
    setState(prev);
    throw e;
  }
  persist(STARRED_KEY, starred);
}

/** Permanently delete the user's own stories — everywhere, including the map
 * (optimistic; throws on failure after rollback). A deleted story drops out of
 * "Starred" too: there is no row left underneath that flag. */
export async function deleteOwnStories(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const prev = state;
  const drop = new Set(ids);
  const mine = (state.mine ?? []).filter((s) => !drop.has(s.id));
  const removedStarredCount = (state.starred ?? []).filter((s) => drop.has(s.id)).length;
  const starred = (state.starred ?? []).filter((s) => !drop.has(s.id));
  const deletedIds = new Set(state.deletedIds);
  ids.forEach((id) => deletedIds.add(id));
  setState({
    mine,
    starred,
    starredIds: starredIdsOf(starred),
    deletedIds,
    mineTotal: state.mineTotal === null ? null : Math.max(0, state.mineTotal - ids.length),
    starredTotal: state.starredTotal === null
      ? null
      : Math.max(0, state.starredTotal - removedStarredCount),
  });
  try {
    await Promise.all(
      ids.map((id) =>
        api.delete(`/api/stories/${id}/`).catch((e) => {
          // Already gone on the server = success for our purposes.
          if (e?.response?.status === 404) return;
          throw e;
        }),
      ),
    );
  } catch (e) {
    setState(prev);
    throw e;
  }
  persist(MINE_KEY, mine);
  persist(STARRED_KEY, starred);
}

/** Wipe one tab entirely. 'mine' permanently deletes every posted story (and
 *  everything starred, since nothing would be left to hold the flag). 'starred'
 *  only unstars — the stories stay in "Mine". */
export async function clearArchive(kind: 'mine' | 'starred'): Promise<void> {
  const prev = state;
  if (kind === 'mine') {
    const deletedIds = new Set(state.deletedIds);
    (state.mine ?? []).forEach((s) => deletedIds.add(s.id));
    setState({
      mine: [], mineTotal: 0, starred: [], starredTotal: 0, starredIds: new Set(), deletedIds,
    });
  } else {
    const patch: Partial<StoryArchive> = { starred: [], starredTotal: 0, starredIds: new Set() };
    if (state.mine) patch.mine = state.mine.map((s) => ({ ...s, is_starred: false }));
    setState(patch);
  }
  try {
    await api.delete(kind === 'mine' ? '/api/stories/mine/' : '/api/stories/starred/');
  } catch (e) {
    setState(prev);
    throw e;
  }
  persist(MINE_KEY, kind === 'mine' ? [] : (state.mine ?? []));
  persist(STARRED_KEY, []);
}
