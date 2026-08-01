import { iconForInterest, IconStar } from '@/components/ui/icons';

import seed from '../../scripts/interests_seed.json';

// Every curated interest must resolve to a real icon.
//
// This is not a style check. The map draws a stranger as a dot carrying the
// interest that put them there, so an interest with no icon of its own falls
// back to the generic star — a marker that says "you have something in common"
// and then refuses to say what. Before the "Other" flow was removed, 81% of
// the 4k hobby catalogue landed on that star; the curated list is the whole
// reason that number is now zero, and it only stays zero if adding an interest
// without an icon fails here.

/** The only interests for which the star is the right icon, not a fallback.
 *  Excluded above so they cannot mask a genuine miss, and pinned below so
 *  deleting their entries still fails. */
const DELIBERATE_STAR = new Set(['stargazing', 'astronomy', 'astrology']);

const names: string[] = Object.values(
  seed as Record<string, { name: string; icon: string }[]>,
).flatMap((group) => group.map((entry) => entry.name));

describe('curated interests', () => {
  it('ships a non-trivial catalogue', () => {
    expect(names.length).toBeGreaterThan(600);
  });

  it('gives every interest an icon that is not the generic star', () => {
    const missing = names
      .filter((name) => !DELIBERATE_STAR.has(name.trim().toLowerCase()))
      .filter((name) => iconForInterest(name) === IconStar);
    // Named in the failure so a new interest points at its own fix.
    expect(missing).toEqual([]);
  });

  it('gives every interest an emoji for its chip', () => {
    const rows = Object.values(
      seed as Record<string, { name: string; icon: string }[]>,
    ).flat();
    expect(rows.filter((r) => !r.icon).map((r) => r.name)).toEqual([]);
  });

  it('has no duplicate names', () => {
    const seen = new Map<string, number>();
    for (const n of names) {
      const k = n.trim().toLowerCase();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    expect([...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n)).toEqual([]);
  });
});

// `stargazing`/`astronomy`/`astrology` legitimately use IconStar as their own
// icon, so the check above would let those three through even if their entries
// were deleted. Pinning them separately keeps the assertion honest.
describe('IconStar as a deliberate choice', () => {
  it.each(['Stargazing', 'Astronomy', 'Astrology'])('%s keeps the star on purpose', (name) => {
    expect(iconForInterest(name)).toBe(IconStar);
  });
});
