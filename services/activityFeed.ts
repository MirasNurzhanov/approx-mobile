import AsyncStorage from '@react-native-async-storage/async-storage';

// Locally generated notifications (nearby matches, story reactions), persisted
// on device. The server's generic proximity notifications are ignored by the
// notifications screen in favor of this feed, which enforces the product rule:
// only friends and interest-matched users may notify you.

export type LocalNotifType = 'nearby_friend' | 'nearby_interest' | 'story_reaction';

export interface LocalNotification {
  id: string;
  type: LocalNotifType;
  message: string; // "title · subtitle" — the notifications row splits on " · "
  created_at: string;
  read: boolean;
}

export interface NearbySighting {
  id: number;
  username: string;
  isFriend: boolean;
  sharedInterests: string[];
  distanceKm?: number;
}

const FEED_KEY = 'aura:activity:feed';
const SEEN_KEY = 'aura:activity:seenNearby';
const REACT_KEY = 'aura:activity:storyReactions';

const FEED_LIMIT = 50;
const NEARBY_COOLDOWN_MS = 60 * 60_000; // re-notify about the same user hourly at most

// AsyncStorage writes are read-modify-write; serialize them so concurrent
// recordings from different effects can't drop each other's items.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function saveJSON(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function fmtDistance(km?: number): string | null {
  if (km == null) return null;
  const m = km * 1000;
  return m < 1000 ? `${Math.round(m)} m away` : `${km.toFixed(1)} km away`;
}

async function pushFeed(items: LocalNotification[]): Promise<void> {
  if (items.length === 0) return;
  const feed = await loadJSON<LocalNotification[]>(FEED_KEY, []);
  await saveJSON(FEED_KEY, [...items, ...feed].slice(0, FEED_LIMIT));
}

export function getFeed(): Promise<LocalNotification[]> {
  return enqueue(() => loadJSON<LocalNotification[]>(FEED_KEY, []));
}

export function markFeedRead(): Promise<void> {
  return enqueue(async () => {
    const feed = await loadJSON<LocalNotification[]>(FEED_KEY, []);
    await saveJSON(FEED_KEY, feed.map((n) => ({ ...n, read: true })));
  });
}

/**
 * Record who is currently visible nearby. Generates notifications only for
 * friends (with distance) and interest-matched users — never anyone else.
 */
export function recordNearbySightings(users: NearbySighting[]): Promise<void> {
  return enqueue(async () => {
    const seen = await loadJSON<Record<string, number>>(SEEN_KEY, {});
    const now = Date.now();
    const fresh: LocalNotification[] = [];

    for (const u of users) {
      const key = String(u.id);
      if (now - (seen[key] ?? 0) < NEARBY_COOLDOWN_MS) continue;

      if (u.isFriend) {
        const dist = fmtDistance(u.distanceKm);
        fresh.push({
          id: `nearby-${u.id}-${now}`,
          type: 'nearby_friend',
          message: `${u.username} is nearby${dist ? ` · ${dist}` : ''}`,
          created_at: new Date(now).toISOString(),
          read: false,
        });
        seen[key] = now;
      } else if (u.sharedInterests.length > 0) {
        fresh.push({
          id: `nearby-${u.id}-${now}`,
          type: 'nearby_interest',
          message: `${u.username} shares your interests · ${u.sharedInterests.slice(0, 2).join(', ')}`,
          created_at: new Date(now).toISOString(),
          read: false,
        });
        seen[key] = now;
      }
    }

    // Prune sighting timestamps older than a day so the map stays small.
    for (const [key, ts] of Object.entries(seen)) {
      if (now - ts > 24 * 60 * 60_000) delete seen[key];
    }

    await pushFeed(fresh);
    await saveJSON(SEEN_KEY, seen);
  });
}

const REACTION_VERB: Record<string, string> = {
  like: 'liked',
  funny: 'found funny',
  helpful: 'found helpful',
  interesting: 'found interesting',
};

/**
 * Compare current reaction counts on the user's own stories against the last
 * seen counts and generate a notification per new reaction. The first sighting
 * of a story only records a baseline (no notification flood).
 */
export function recordStoryReactions(
  stories: { id: number; authorId: number; reactions: Record<string, number> }[],
  meId: number | null,
): Promise<void> {
  if (meId == null) return Promise.resolve();
  return enqueue(async () => {
    const prev = await loadJSON<Record<string, Record<string, number>>>(REACT_KEY, {});
    const next: Record<string, Record<string, number>> = {};
    const fresh: LocalNotification[] = [];
    const now = Date.now();

    for (const s of stories) {
      if (s.authorId !== meId) continue;
      const key = String(s.id);
      const before = prev[key];
      next[key] = s.reactions;
      if (!before) continue;

      for (const [type, count] of Object.entries(s.reactions)) {
        const delta = (count ?? 0) - (before[type] ?? 0);
        if (delta <= 0) continue;
        const verb = REACTION_VERB[type] ?? 'reacted to';
        fresh.push({
          id: `reaction-${s.id}-${type}-${now}`,
          type: 'story_reaction',
          message: delta === 1 ? `Someone ${verb} your story` : `${delta} people ${verb} your story`,
          created_at: new Date(now).toISOString(),
          read: false,
        });
      }
    }

    // Keeping only currently-live stories also drops expired ones automatically.
    await pushFeed(fresh);
    await saveJSON(REACT_KEY, next);
  });
}
