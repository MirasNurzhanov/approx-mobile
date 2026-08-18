import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { api } from './api';
import { toLatitude, toLongitude, withNumericCoordsList, type Placed } from './coords';

// Shared story types + the story-archive store. The archive ("Mine" = every
// story the user posted, "Saved" = bookmarks of other people's stories) is
// cached on device so the saved-stories screen opens instantly and offline;
// the backend stays the source of truth via refresh/loadMore. The map and the
// story viewer mutate through this module too, so every surface stays in sync
// without manual refreshes.

export type ReactionType = 'like' | 'funny' | 'helpful' | 'interesting';

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
  reactions: { like: number; funny: number; helpful: number; interesting: number };
  user_reaction?: ReactionType | null;
  is_saved?: boolean;
  /** Present on items from the saved list: when the bookmark was created. */
  saved_at?: string;
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
const SAVED_KEY = 'aura:stories:saved';
const CACHE_LIMIT = 60; // items persisted per list for instant/offline open

export interface StoryArchive {
  /** null = not hydrated yet (neither cache nor network has filled it). */
  mine: FeedStory[] | null;
  saved: FeedStory[] | null;
  /** Server-side totals; null until the first successful fetch. */
  mineTotal: number | null;
  savedTotal: number | null;
  /** Ids of stories the user has bookmarked (drives the viewer's toggle). */
  savedIds: Set<number>;
  /** Own stories deleted this session — the map filters its markers by this. */
  deletedIds: Set<number>;
}

let state: StoryArchive = {
  mine: null,
  saved: null,
  mineTotal: null,
  savedTotal: null,
  savedIds: new Set(),
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
 * saved stories to whoever signs in next.
 */
export async function resetArchive(): Promise<void> {
  setState({
    mine: null,
    saved: null,
    mineTotal: null,
    savedTotal: null,
    savedIds: new Set(),
    deletedIds: new Set(),
  });
  try {
    await AsyncStorage.multiRemove([MINE_KEY, SAVED_KEY]);
  } catch {}
}

/** Reactive snapshot of the archive for components. */
export function useStoryArchive(): StoryArchive {
  return useSyncExternalStore(subscribe, () => state);
}

export function getStoryArchive(): StoryArchive {
  return state;
}

function savedIdsOf(saved: FeedStory[] | null): Set<number> {
  return new Set((saved ?? []).map((s) => s.id));
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
  const [mine, saved] = await Promise.all([loadCache(MINE_KEY), loadCache(SAVED_KEY)]);
  const patch: Partial<StoryArchive> = {};
  if (state.mine === null && mine) patch.mine = mine;
  if (state.saved === null && saved) {
    patch.saved = saved;
    patch.savedIds = savedIdsOf(saved);
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

export async function refreshSaved(): Promise<void> {
  const { data } = await api.get<ArchivePage>('/api/stories/saved/', {
    params: { limit: ARCHIVE_PAGE_SIZE, offset: 0 },
  });
  const saved = normalizeStories(data.results);
  setState({ saved, savedTotal: data.count, savedIds: savedIdsOf(saved) });
  persist(SAVED_KEY, saved);
}

async function loadMore(kind: 'mine' | 'saved'): Promise<void> {
  const list = state[kind];
  const total = kind === 'mine' ? state.mineTotal : state.savedTotal;
  if (!list || total === null || list.length >= total) return;
  const url = kind === 'mine' ? '/api/stories/mine/' : '/api/stories/saved/';
  const { data } = await api.get<ArchivePage>(url, {
    params: { limit: ARCHIVE_PAGE_SIZE, offset: list.length },
  });
  const seen = new Set(list.map((s) => s.id));
  const merged = [...list, ...normalizeStories(data.results).filter((s) => !seen.has(s.id))];
  if (kind === 'mine') {
    setState({ mine: merged.filter((s) => !state.deletedIds.has(s.id)), mineTotal: data.count });
  } else {
    setState({ saved: merged, savedTotal: data.count, savedIds: savedIdsOf(merged) });
  }
}

export const loadMoreMine = () => loadMore('mine');
export const loadMoreSaved = () => loadMore('saved');

/** Called by the map right after a successful post — the archive picks the
 * story up immediately instead of waiting for the next fetch. */
export function recordOwnStory(story: FeedStory): void {
  if (state.mine === null) return; // archive never opened; it will fetch fresh
  if (state.mine.some((s) => s.id === story.id)) return;
  const mine = [story, ...state.mine];
  setState({ mine, mineTotal: state.mineTotal === null ? null : state.mineTotal + 1 });
  persist(MINE_KEY, mine);
}

/** Bookmark someone else's story (optimistic; throws on failure after rollback). */
export async function saveStory(story: FeedStory): Promise<void> {
  if (state.savedIds.has(story.id)) return;
  const prev = state;
  const entry: FeedStory = { ...story, is_saved: true, saved_at: new Date().toISOString() };
  const saved = [entry, ...(state.saved ?? [])];
  setState({
    saved,
    savedIds: savedIdsOf(saved),
    savedTotal: state.savedTotal === null ? null : state.savedTotal + 1,
  });
  try {
    await api.post(`/api/stories/${story.id}/save/`);
  } catch (e) {
    setState(prev);
    throw e;
  }
  persist(SAVED_KEY, saved);
}

/** Remove bookmarks only — never touches the original stories. */
export async function unsaveStories(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const prev = state;
  const drop = new Set(ids);
  const saved = (state.saved ?? []).filter((s) => !drop.has(s.id));
  setState({
    saved,
    savedIds: savedIdsOf(saved),
    savedTotal: state.savedTotal === null ? null : Math.max(0, state.savedTotal - ids.length),
  });
  try {
    await Promise.all(ids.map((id) => api.delete(`/api/stories/${id}/save/`)));
  } catch (e) {
    setState(prev);
    throw e;
  }
  persist(SAVED_KEY, saved);
}

/** Permanently delete the user's own stories — everywhere, including the map
 * and everyone's saved lists (optimistic; throws on failure after rollback). */
export async function deleteOwnStories(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const prev = state;
  const drop = new Set(ids);
  const mine = (state.mine ?? []).filter((s) => !drop.has(s.id));
  const deletedIds = new Set(state.deletedIds);
  ids.forEach((id) => deletedIds.add(id));
  setState({
    mine,
    deletedIds,
    mineTotal: state.mineTotal === null ? null : Math.max(0, state.mineTotal - ids.length),
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
}

/** Wipe one tab entirely. 'mine' permanently deletes every posted story. */
export async function clearArchive(kind: 'mine' | 'saved'): Promise<void> {
  const prev = state;
  if (kind === 'mine') {
    const deletedIds = new Set(state.deletedIds);
    (state.mine ?? []).forEach((s) => deletedIds.add(s.id));
    setState({ mine: [], mineTotal: 0, deletedIds });
  } else {
    setState({ saved: [], savedTotal: 0, savedIds: new Set() });
  }
  try {
    await api.delete(kind === 'mine' ? '/api/stories/mine/' : '/api/stories/saved/');
  } catch (e) {
    setState(prev);
    throw e;
  }
  persist(kind === 'mine' ? MINE_KEY : SAVED_KEY, []);
}
