import { Ionicons } from '@expo/vector-icons';

import { catalogueCategory } from './interestCatalogue';

// The nine groups the interest catalogue is organised into.
//
// The server decides *which* group an interest is in and *what order* the
// groups come in — both live in `interests/categories.py` and arrive on every
// interest as `category`. What lives here is only how a group looks: its icon
// and its colour, which are presentation and no business of the backend's.
//
// Before this, neither screen had the grouping at all. The API returned 681
// interests in one alphabetical list, so the onboarding screen guessed with a
// regex over the names and most of the catalogue fell through it into a bucket
// called "Casual" — which is why Sports showed a handful of entries when 186
// exist.

export type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** A category key as the server sends it. `''` is the real value for an
 *  interest that belongs to no group — a custom entry from the retired "Other"
 *  flow — and the screens show those under a trailing "More". */
export type CategoryKey =
  | 'sports'
  | 'fitness'
  | 'music'
  | 'arts'
  | 'food'
  | 'travel'
  | 'games'
  | 'entertainment'
  | 'lifestyle'
  | '';

export interface CategoryStyle {
  key: CategoryKey;
  /** Fallback only. The server sends `category_label` on every interest, and
   *  that is what should be rendered — it stays correct when a category is
   *  added after this build shipped. */
  label: string;
  icon: IoniconName;
  color: string;
}

/** Display order, matching `interests/categories.py`. Sports leads because it
 *  is the largest group and the one people open first. */
export const CATEGORY_STYLES: CategoryStyle[] = [
  { key: 'sports',        label: 'Sports',                  icon: 'football-outline',        color: '#E8714A' },
  { key: 'fitness',       label: 'Fitness & Wellness',      icon: 'barbell-outline',         color: '#5EA83C' },
  { key: 'music',         label: 'Music',                   icon: 'musical-notes-outline',   color: '#4D8DFF' },
  { key: 'arts',          label: 'Arts & Creativity',       icon: 'color-palette-outline',   color: '#12A594' },
  { key: 'food',          label: 'Food & Drink',            icon: 'restaurant-outline',      color: '#E0567F' },
  { key: 'travel',        label: 'Travel & Outdoors',       icon: 'leaf-outline',            color: '#2FA36B' },
  { key: 'games',         label: 'Games & Tech',            icon: 'game-controller-outline', color: '#8B6FD4' },
  { key: 'entertainment', label: 'Entertainment & Culture', icon: 'film-outline',            color: '#C9932E' },
  { key: 'lifestyle',     label: 'Lifestyle & Social',      icon: 'sparkles-outline',        color: '#D2691E' },
];

/** Interests that belong to no group. Not one of the nine — this is where the
 *  retired "Other" flow's entries would have ended up. Nothing is bucketed
 *  here any more: `inferCategory` below sorts them into one of the nine
 *  instead, so a picker never has to show a leftover "More". Kept only as the
 *  fallback `styleFor` reaches for on a key it truly cannot place. */
export const UNGROUPED: CategoryStyle = {
  key: '',
  label: 'More',
  icon: 'ellipsis-horizontal-circle-outline',
  color: '#8A8577',
};

const BY_KEY = new Map<string, CategoryStyle>(
  [...CATEGORY_STYLES, UNGROUPED].map((c) => [c.key, c]),
);

export function styleFor(key: string | undefined | null): CategoryStyle {
  return BY_KEY.get(key ?? '') ?? UNGROUPED;
}

/**
 * The category for an interest the server sent with no usable `category`.
 *
 * Two steps, in order of how much they can be trusted:
 *
 * 1. The curated catalogue — all 681 seeded interests, grouped exactly as
 *    `scripts/interests_seed.json` groups them, which is the same file the
 *    backend seeds from. This is an answer, not a guess, and covers every
 *    interest a normal install has.
 * 2. Keyword matching, for a name the catalogue has never seen: an entry left
 *    behind by the retired "Other" flow, or one added on the server after this
 *    build shipped.
 *
 * Always returns one of the nine real keys, so nothing collects in a leftover
 * "More" bucket.
 */
export function inferCategory(name: string): Exclude<CategoryKey, ''> {
  const known = catalogueCategory(name);
  if (known) return known;

  const n = name.toLowerCase();
  if (/sport|football|basketball|soccer|tennis|running?|marathon|martial|boxing|cycl|volleyball|baseball|hockey|rugby|golf|skat|climbing|badminton|cricket/.test(n)) return 'sports';
  if (/fitness|yoga|pilates|workout|weight.?lift|crossfit|calisthenic|gym\b|wellness|meditat|nutrition/.test(n)) return 'fitness';
  if (/music|guitar|piano|drum|\bsing|\bdj\b|rap|hip.?hop|jazz|concert|festival|instrument|songwrit|\bband\b|orchestra/.test(n)) return 'music';
  if (/\bart\b|paint|sculpt|\bdraw|photograph|craft|design|ceramic|pottery|calligraphy|knitting|sewing/.test(n)) return 'arts';
  if (/food|cooking|baking|coffee|\bwine\b|cocktail|restaurant|recipe|vegan|culinary|\bdrink|\bbeer\b|\btea\b|barbecue|\bbbq\b/.test(n)) return 'food';
  if (/travel|hiking|camping|surfing|skiing|snowboard|outdoor|nature|backpack|road.?trip|adventure|garden|fishing/.test(n)) return 'travel';
  if (/gaming|gamer|esport|video.?game|playstation|xbox|nintendo|\brpg\b|\bfps\b|board.?game|chess|puzzle|\btech\b|programming|coding|software|robotics|cyber/.test(n)) return 'games';
  if (/film|movie|cinema|\btv\b|television|theatre|theater|dance|\bwrit|literature|poetry|novel|\bbook|anime|comic|celebrity/.test(n)) return 'entertainment';
  return 'lifestyle';
}

/** Anything the interest endpoints return. Deliberately structural rather than
 *  an import: three screens have their own local `Interest` shape and none of
 *  them should have to change to use this. */
export interface Categorised {
  name: string;
  category?: string;
  category_label?: string;
}

export interface CategorySection<T> {
  key: CategoryKey;
  /** The server's label where it sent one, so a category added after this
   *  build shipped still gets a correct heading. */
  label: string;
  icon: IoniconName;
  color: string;
  items: T[];
}

/**
 * Split a list of interests into sections, in the server's order.
 *
 * Empty sections are dropped — an interest picker showing "Music (0)" is
 * showing the shape of the catalogue rather than anything the user can act on.
 * Every interest lands in one of the nine real sections — one with no
 * `category` (a leftover "Other"-flow entry) is sorted into one of them by
 * `inferCategory` rather than collecting under a separate "More".
 */
/**
 * Every one of the nine, in the server's order, empty groups included.
 *
 * This is what the bubble field needs and `sectionise` deliberately is not: a
 * list drops a heading with nothing under it, but the field's nine bubbles are
 * a fixed composition, and a bubble vanishing because the catalogue happens to
 * be missing that group would rearrange the screen.
 */
export function groupAll<T extends Categorised>(
  items: T[],
): { style: CategoryStyle; items: T[] }[] {
  const buckets = new Map<CategoryKey, T[]>(CATEGORY_STYLES.map((c) => [c.key, []]));
  for (const item of items) {
    // A category the server sent that this build has no bubble for is placed by
    // name rather than shown as a tenth: the field's nine slots are authored,
    // not generated, and a bubble with no slot has nowhere to sit.
    const sent = item.category as CategoryKey | undefined;
    const key = sent && buckets.has(sent) ? sent : inferCategory(item.name);
    buckets.get(key)!.push(item);
  }
  return CATEGORY_STYLES.map((style) => ({ style, items: buckets.get(style.key)! }));
}

export function sectionise<T extends Categorised>(items: T[]): CategorySection<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = item.category || inferCategory(item.name);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const ordered = CATEGORY_STYLES;
  const sections: CategorySection<T>[] = [];

  for (const style of ordered) {
    const bucket = buckets.get(style.key);
    if (!bucket?.length) continue;
    sections.push({
      key: style.key,
      label: bucket[0].category_label || style.label,
      icon: style.icon,
      color: style.color,
      items: bucket,
    });
    buckets.delete(style.key);
  }

  // A category this build has never heard of. It still has a name — the server
  // sent one with every interest — so it gets a real heading at the end rather
  // than being folded into "More" or, worse, dropped.
  for (const [key, bucket] of buckets) {
    sections.push({
      key: key as CategoryKey,
      label: bucket[0].category_label || key,
      icon: UNGROUPED.icon,
      color: UNGROUPED.color,
      items: bucket,
    });
  }

  return sections;
}
