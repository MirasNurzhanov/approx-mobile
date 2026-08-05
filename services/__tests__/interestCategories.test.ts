// Splitting the catalogue into sections.
//
// Four screens render interests — onboarding, edit-interests, and both profile
// views — and before this they each grouped them differently or not at all.
// The rule they now share is here, so what "Sports" contains is one answer
// rather than four.

import {
  CATEGORY_STYLES,
  sectionise,
  styleFor,
  UNGROUPED,
} from '../interestCategories';

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

  it('puts interests with no category last, under More', () => {
    const sections = sectionise([
      row('Competitive Napping'),
      row('Football', 'sports'),
    ]);
    expect(sections.map((s) => s.key)).toEqual(['sports', '']);
    expect(sections[1].label).toBe('More');
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
