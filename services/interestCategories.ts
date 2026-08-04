import { Ionicons } from '@expo/vector-icons';

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

/** Interests that belong to no group. Not one of the nine — it is where the
 *  retired "Other" flow's entries ended up — so it is only ever shown when
 *  something is actually in it. */
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

/** Anything the interest endpoints return. Deliberately structural rather than
 *  an import: three screens have their own local `Interest` shape and none of
 *  them should have to change to use this. */
export interface Categorised {
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
 * `''` sorts last, and only appears when something is in it.
 */
export function sectionise<T extends Categorised>(items: T[]): CategorySection<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = item.category ?? '';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const ordered = [...CATEGORY_STYLES, UNGROUPED];
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
