// Splitting the catalogue into sections.
//
// Four screens render interests — onboarding, edit-interests, and both profile
// views — and before this they each grouped them differently or not at all.
// The rule they now share is here, so what "Sports" contains is one answer
// rather than four.

import {
  CATEGORY_STYLES,
  groupAll,
  inferCategory,
  sectionise,
  styleFor,
  UNGROUPED,
} from '../interestCategories';
import { catalogueCategory } from '../interestCatalogue';

import seed from '../../scripts/interests_seed.json';

interface Row {
  name: string;
  category?: string;
  category_label?: string;
}

const row = (name: string, category?: string, category_label?: string): Row => ({
  name,
  category,
  category_label,
});

describe('sectionise', () => {
  it('returns sections in the server’s order, not the order it met them', () => {
    const sections = sectionise([
      row('Jazz', 'music'),
      row('Sushi', 'food'),
      row('Football', 'sports'),
    ]);
    expect(sections.map((s) => s.key)).toEqual(['sports', 'music', 'food']);
  });

  it('keeps every interest, and keeps them in the order given', () => {
    const sections = sectionise([
      row('Football', 'sports'),
      row('Jazz', 'music'),
      row('Futsal', 'sports'),
    ]);
    expect(sections[0].items.map((i) => i.name)).toEqual(['Football', 'Futsal']);
    expect(sections.flatMap((s) => s.items)).toHaveLength(3);
  });

  it('drops empty sections', () => {
    // A picker showing "Music (0)" is describing the catalogue rather than
    // offering anything.
    const sections = sectionise([row('Football', 'sports')]);
    expect(sections).toHaveLength(1);
  });

  it('sorts an interest with no category into a real one, never a leftover "More"', () => {
    const sections = sectionise([
      row('Chess'),
      row('Football', 'sports'),
    ]);
    expect(sections.map((s) => s.key)).toEqual(['sports', 'games']);
    expect(sections.every((s) => s.key !== '')).toBe(true);
  });

  it('prefers the label the server sent over the one bundled here', () => {
    // So a category renamed on the server is renamed in the app without a
    // release.
    const [section] = sectionise([row('Football', 'sports', 'Sport & Games')]);
    expect(section.label).toBe('Sport & Games');
    expect(section.icon).toBe(
      CATEGORY_STYLES.find((c) => c.key === 'sports')!.icon,
    );
  });

  it('gives a category it has never heard of a real heading rather than dropping it', () => {
    // The forward-compatible case: a tenth category added on the server. It
    // has no icon or colour here, but it has a name, and showing it under its
    // own name beats hiding those interests or calling them "More".
    const sections = sectionise([
      row('Football', 'sports'),
      row('Falconry', 'wildlife', 'Wildlife'),
    ]);
    expect(sections.map((s) => s.label)).toEqual(['Sports', 'Wildlife']);
    expect(sections[1].items).toHaveLength(1);
  });

  it('handles an empty list', () => {
    expect(sectionise([])).toEqual([]);
  });
});

// What the bubble field renders. Unlike `sectionise` it is a fixed nine: the
// field's slots are authored positions on a canvas, so a group appearing or
// disappearing with the data would move the other bubbles around.
describe('groupAll', () => {
  it('always returns all nine, in the server’s order, even when empty', () => {
    const groups = groupAll([row('Jazz', 'music')]);
    expect(groups).toHaveLength(9);
    expect(groups.map((g) => g.style.key)).toEqual(CATEGORY_STYLES.map((c) => c.key));
    expect(groups.find((g) => g.style.key === 'music')!.items).toHaveLength(1);
    expect(groups.find((g) => g.style.key === 'sports')!.items).toEqual([]);
  });

  it('keeps every interest and keeps them in the order given', () => {
    const groups = groupAll([
      row('Football', 'sports'),
      row('Jazz', 'music'),
      row('Futsal', 'sports'),
    ]);
    expect(groups.find((g) => g.style.key === 'sports')!.items.map((i) => i.name))
      .toEqual(['Football', 'Futsal']);
    expect(groups.flatMap((g) => g.items)).toHaveLength(3);
  });

  it('places an uncategorised interest rather than dropping it', () => {
    const groups = groupAll([row('Chess')]);
    expect(groups.find((g) => g.style.key === 'games')!.items.map((i) => i.name))
      .toEqual(['Chess']);
  });

  it('places a category it has never heard of by name, not in a tenth bubble', () => {
    // `sectionise` gives an unknown category its own heading at the end, which
    // a list can do and the field cannot — there is no tenth slot.
    const groups = groupAll([row('Falconry', 'wildlife', 'Wildlife')]);
    expect(groups).toHaveLength(9);
    expect(groups.flatMap((g) => g.items)).toHaveLength(1);
  });

  it('handles an empty list without losing the bubbles', () => {
    const groups = groupAll([]);
    expect(groups).toHaveLength(9);
    expect(groups.every((g) => g.items.length === 0)).toBe(true);
  });
});

describe('styleFor', () => {
  it('knows all nine', () => {
    for (const style of CATEGORY_STYLES) {
      expect(styleFor(style.key).label).toBe(style.label);
    }
  });

  it('falls back to More for anything else, including undefined', () => {
    expect(styleFor(undefined).key).toBe(UNGROUPED.key);
    expect(styleFor('')).toBe(UNGROUPED);
    expect(styleFor('quidditch').label).toBe('More');
  });

  it('has nine categories, each with an icon and a colour', () => {
    // The count is pinned deliberately: the layout on the onboarding screen
    // places exactly this many bubbles, and a tenth added here without a slot
    // there would be positioned by `LAYOUT[i]` reading past its end.
    expect(CATEGORY_STYLES).toHaveLength(9);
    for (const style of CATEGORY_STYLES) {
      expect(style.icon).toBeTruthy();
      expect(style.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('inferCategory', () => {
  it('recognises a keyword from each of the nine real categories', () => {
    // Names deliberately absent from the curated catalogue, so these exercise
    // the keyword fallback rather than the exact lookup.
    expect(inferCategory('Weekend Football League')).toBe('sports');
    expect(inferCategory('Morning Yoga Flow')).toBe('fitness');
    expect(inferCategory('Jazz Appreciation')).toBe('music');
    expect(inferCategory('Watercolor Painting Club')).toBe('arts');
    expect(inferCategory('Sourdough Baking')).toBe('food');
    expect(inferCategory('Weekend Hiking Trips')).toBe('travel');
    expect(inferCategory('Retro Video Games')).toBe('games');
    expect(inferCategory('Anime Watch Parties')).toBe('entertainment');
  });

  it('never returns the empty "More" key', () => {
    expect(inferCategory('Competitive Napping')).not.toBe('');
    expect(inferCategory('Competitive Napping')).toBe('lifestyle');
  });
});

// The whole catalogue must resolve exactly, not by keyword luck.
//
// This is what makes the "More" bucket unnecessary rather than merely hidden:
// every one of the 681 seeded interests lands in the category the seed file
// puts it in, whether or not the backend has run its categorising migration.
// Adding an interest to the seed without regenerating `interestCatalogue.ts`
// fails here and names it.
describe('the curated catalogue', () => {
  const SEED_HEADING_TO_KEY: Record<string, string> = {
    'Sports': 'sports',
    'Fitness & Wellness': 'fitness',
    'Music': 'music',
    'Arts & Creativity': 'arts',
    'Food & Drink': 'food',
    'Travel & Outdoors': 'travel',
    'Games & Tech': 'games',
    'Entertainment & Culture': 'entertainment',
    'Lifestyle & Social': 'lifestyle',
  };

  const entries = Object.entries(
    seed as Record<string, { name: string; icon: string }[]>,
  ).flatMap(([heading, items]) =>
    items.map((item) => ({ name: item.name, expected: SEED_HEADING_TO_KEY[heading] })),
  );

  it('covers the whole seed file', () => {
    expect(entries).toHaveLength(681);
    expect(Object.keys(seed)).toHaveLength(9);
  });

  it('groups every seeded interest exactly as the seed file does', () => {
    const wrong = entries
      .filter((e) => catalogueCategory(e.name) !== e.expected)
      .map((e) => `${e.name}: ${catalogueCategory(e.name) ?? 'MISSING'} ≠ ${e.expected}`);
    expect(wrong).toEqual([]);
  });

  it('routes every seeded interest through inferCategory to the same place', () => {
    const wrong = entries
      .filter((e) => inferCategory(e.name) !== e.expected)
      .map((e) => `${e.name}: ${inferCategory(e.name)} ≠ ${e.expected}`);
    expect(wrong).toEqual([]);
  });

  it('sections the whole catalogue into nine, with nothing left over', () => {
    // The end-to-end shape both pickers render when the server sends no
    // category at all.
    const sections = sectionise(entries.map((e) => ({ name: e.name })));
    expect(sections).toHaveLength(9);
    expect(sections.some((s) => s.key === '')).toBe(false);
    expect(sections.reduce((n, s) => n + s.items.length, 0)).toBe(681);
  });

  it('fills all nine bubbles from the catalogue, seed counts intact', () => {
    // The same end-to-end check for the bubble field: every bubble has
    // something in it, and it has exactly what the seed file puts there.
    const groups = groupAll(entries.map((e) => ({ name: e.name })));
    expect(groups).toHaveLength(9);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    for (const group of groups) {
      const expected = entries.filter((e) => e.expected === group.style.key).length;
      expect(`${group.style.key}: ${group.items.length}`).toBe(`${group.style.key}: ${expected}`);
    }
  });
});
