import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { api } from './api';

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

export interface Story {
  id: number;
  author: StoryAuthor;
  text?: string;
  content?: string;
  image?: string;
  place_name?: string;
  latitude: number;
  longitude: number;
  created_at: string;
  expires_at: string;
  reactions: { like: number; funny: number; helpful: number; interesting: number };
  user_reaction?: ReactionType | null;
  is_saved?: boolean;
  /** Present on items from the saved list: when the bookmark was created. */
  saved_at?: string;
}

export const ARCHIVE_PAGE_SIZE = 30;
const MINE_KEY = 'aura:stories:mine';
const SAVED_KEY = 'aura:stories:saved';
const CACHE_LIMIT = 60; // items persisted per list for instant/offline open

export interface StoryArchive {
  /** null = not hydrated yet (neither cache nor network has filled it). */
  mine: Story[] | null;
  saved: Story[] | null;
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

function savedIdsOf(saved: Story[] | null): Set<number> {
  return new Set((saved ?? []).map((s) => s.id));
}

async function persist(key: string, list: Story[] | null) {
  if (!list) return;
  try {
    await AsyncStorage.setItem(key, JSON.stringify(list.slice(0, CACHE_LIMIT)));
  } catch {}
}

async function loadCache(key: string): Promise<Story[] | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Story[]) : null;
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
  results: Story[];
}

export async function refreshMine(): Promise<void> {
  const { data } = await api.get<ArchivePage>('/api/stories/mine/', {
    params: { limit: ARCHIVE_PAGE_SIZE, offset: 0 },
  });
  const mine = data.results.filter((s) => !state.deletedIds.has(s.id));
  setState({ mine, mineTotal: data.count });
  persist(MINE_KEY, mine);
}

export async function refreshSaved(): Promise<void> {
  const { data } = await api.get<ArchivePage>('/api/stories/saved/', {
    params: { limit: ARCHIVE_PAGE_SIZE, offset: 0 },
  });
  setState({ saved: data.results, savedTotal: data.count, savedIds: savedIdsOf(data.results) });
  persist(SAVED_KEY, data.results);
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
  const merged = [...list, ...data.results.filter((s) => !seen.has(s.id))];
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
export function recordOwnStory(story: Story): void {
  if (state.mine === null) return; // archive never opened; it will fetch fresh
  if (state.mine.some((s) => s.id === story.id)) return;
  const mine = [story, ...state.mine];
  setState({ mine, mineTotal: state.mineTotal === null ? null : state.mineTotal + 1 });
  persist(MINE_KEY, mine);
}

/** Bookmark someone else's story (optimistic; throws on failure after rollback). */
export async function saveStory(story: Story): Promise<void> {
  if (state.savedIds.has(story.id)) return;
  const prev = state;
  const entry: Story = { ...story, is_saved: true, saved_at: new Date().toISOString() };
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
