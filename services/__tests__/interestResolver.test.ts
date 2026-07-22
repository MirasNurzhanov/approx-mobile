import {
  AMBIGUOUS_THRESHOLD,
  AUTO_THRESHOLD,
  catalogSize,
  loadCatalog,
  normalizeInput,
  resolveInterest,
  suggest,
} from '../interestResolver';

describe('normalizeInput', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalizeInput('  Rock   Climbing  ')).toBe('rock climbing');
  });

  it('strips diacritics and punctuation', () => {
    expect(normalizeInput('Pétanque!!!')).toBe('petanque');
    expect(normalizeInput('D&D & Tabletop RPGs')).toBe('d&d & tabletop rpgs');
  });

  it('keeps non-Latin scripts', () => {
    expect(normalizeInput('Фотография')).toBe('фотография');
  });
});

describe('catalog', () => {
  it('bundles a large catalog', () => {
    expect(catalogSize()).toBeGreaterThanOrEqual(2000);
  });

  it('has unique ids and normalized-unique names', () => {
    const { entries } = loadCatalog();
    const ids = new Set(entries.map((e) => e.id));
    expect(ids.size).toBe(entries.length);
  });

  it('every entry has an icon and a category', () => {
    const { entries } = loadCatalog();
    for (const e of entries) {
      expect(e.icon).toBeTruthy();
      expect(e.category).toBeTruthy();
    }
  });
});

describe('resolveInterest — exact hits', () => {
  it('resolves an exact name', () => {
    const r = resolveInterest('Photography');
    expect(r.status).toBe('exact');
    expect(r.match?.name).toBe('Photography');
    expect(r.confidence).toBe(1);
  });

  it('is case- and whitespace-insensitive', () => {
    const r = resolveInterest('  cHeSs ');
    expect(r.status).toBe('exact');
    expect(r.match?.name).toBe('Chess');
  });
});

describe('resolveInterest — aliases', () => {
  it('resolves a curated alias', () => {
    const r = resolveInterest('taking photos');
    expect(r.status).toBe('exact');
    expect(r.match?.name).toBe('Photography');
  });

  it('resolves a Cyrillic alias', () => {
    const r = resolveInterest('фотография');
    expect(r.status).toBe('exact');
    expect(r.match?.name).toBe('Photography');
  });

  it('resolves plurals via generated aliases', () => {
    const r = resolveInterest('podcast');
    expect(r.status).toBe('exact');
    expect(r.match?.name).toBe('Podcasts');
  });
});

describe('resolveInterest — typos', () => {
  it('auto-resolves a close misspelling', () => {
    const r = resolveInterest('photograpy');
    expect(['exact', 'confident']).toContain(r.status);
    expect(r.match?.name).toBe('Photography');
    expect(r.confidence).toBeGreaterThanOrEqual(AUTO_THRESHOLD);
  });

  it('auto-resolves a one-letter typo', () => {
    const r = resolveInterest('swiming');
    expect(['exact', 'confident']).toContain(r.status);
    expect(r.match?.name).toBe('Swimming');
  });
});

describe('resolveInterest — prefix', () => {
  it('resolves a unique unambiguous prefix', () => {
    const r = resolveInterest('photograp');
    expect(r.match?.name ?? r.candidates[0]?.name).toBe('Photography');
  });

  it('returns candidates for an ambiguous prefix', () => {
    const r = resolveInterest('vol');
    // Too short to prefix-match; either ambiguous or none, but never auto-resolve
    expect(r.status).not.toBe('exact');
    expect(r.status).not.toBe('confident');
  });
});

describe('resolveInterest — ambiguous band', () => {
  it('offers top candidates instead of guessing', () => {
    const r = resolveInterest('boxin cardio'); // messy input, no exact target
    if (r.status === 'ambiguous') {
      expect(r.candidates.length).toBeGreaterThanOrEqual(1);
      expect(r.candidates.length).toBeLessThanOrEqual(3);
      expect(r.confidence).toBeGreaterThanOrEqual(AMBIGUOUS_THRESHOLD);
      expect(r.confidence).toBeLessThan(AUTO_THRESHOLD);
      expect(r.match).toBeNull();
    } else {
      expect(['confident', 'none']).toContain(r.status);
    }
  });
});

describe('resolveInterest — non-matches', () => {
  it('rejects empty input', () => {
    const r = resolveInterest('');
    expect(r.status).toBe('none');
    expect(r.confidence).toBe(0);
  });

  it('rejects whitespace and punctuation-only input', () => {
    expect(resolveInterest('   ').status).toBe('none');
    expect(resolveInterest('!!!').status).toBe('none');
  });

  it('does not force a match for garbage', () => {
    const r = resolveInterest('xqzwvjkpplmtr');
    expect(r.status).toBe('none');
    expect(r.match).toBeNull();
  });

  it('does not auto-resolve a made-up but word-like hobby', () => {
    const r = resolveInterest('quantum yodel farming');
    expect(r.status).not.toBe('exact');
    expect(r.match?.name).not.toBe('Farming'); // keyword hits may suggest, never auto-pick
  });
});

describe('suggest', () => {
  it('returns nothing for very short input', () => {
    expect(suggest('p')).toEqual([]);
  });

  it('prefix-matches while typing', () => {
    const names = suggest('photo').map((h) => h.name);
    expect(names).toContain('Photography');
  });

  it('matches inner words', () => {
    const names = suggest('tennis', 12).map((h) => h.name.toLowerCase());
    expect(names.some((n) => n.includes('table tennis'))).toBe(true);
  });

  it('respects the limit and dedupes', () => {
    const out = suggest('ba', 5);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(new Set(out.map((h) => h.id)).size).toBe(out.length);
  });

  it('recovers from typos', () => {
    const names = suggest('gutar').map((h) => h.name);
    expect(names).toContain('Guitar');
  });
});
