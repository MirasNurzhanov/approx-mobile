// Resolves free-text hobby input against the bundled catalog (data/hobbies.json).
//
// Pipeline: normalize → exact name/alias → unique-prefix → fuzzy (Levenshtein)
// → keyword overlap → none. Confidence bands:
//   ≥ AUTO_THRESHOLD  → auto-resolve ('exact' / 'confident')
//   AMBIGUOUS..AUTO   → 'ambiguous', caller shows top candidates
//   below             → 'none', caller keeps the input as a custom interest
//
// The catalog is require()d lazily on first use so the ~600KB JSON is only
// parsed when the "Other" input is actually opened.

export interface Hobby {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  icon: string;
  keywords: string[];
}

export type ResolveStatus = 'exact' | 'confident' | 'ambiguous' | 'none';

export interface ResolveResult {
  status: ResolveStatus;
  /** Set when status is 'exact' or 'confident'. */
  match: Hobby | null;
  /** Ranked candidates (best first); populated for 'ambiguous', best-effort otherwise. */
  candidates: Hobby[];
  confidence: number;
}

export const AUTO_THRESHOLD = 0.84;
export const AMBIGUOUS_THRESHOLD = 0.6;

// Keep in sync with normalizeKey() in scripts/generate-hobby-catalog.mjs.
export function normalizeInput(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}& -]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Lazy index ───────────────────────────────────────────────────────────────
interface Index {
  exact: Map<string, Hobby>; // names + aliases → hobby (names win)
  keys: string[]; // all lookup keys, sorted, for prefix scans
  keywordMap: Map<string, Hobby[]>; // keyword token → hobbies
  entries: Hobby[];
}

let index: Index | null = null;

function buildIndex(): Index {
  // Deferred so the JSON parse cost is only paid when the Other flow opens.
  const catalog = require('@/data/hobbies.json') as { entries: Hobby[] };
  const exact = new Map<string, Hobby>();
  const keywordMap = new Map<string, Hobby[]>();

  // Aliases first, then names, so a name always wins a conflicting alias.
  for (const hobby of catalog.entries) {
    for (const alias of hobby.aliases) {
      if (!exact.has(alias)) exact.set(alias, hobby);
    }
  }
  for (const hobby of catalog.entries) {
    exact.set(normalizeInput(hobby.name), hobby);
    for (const kw of hobby.keywords) {
      const list = keywordMap.get(kw);
      if (list) list.push(hobby);
      else keywordMap.set(kw, [hobby]);
    }
  }

  const keys = [...exact.keys()].sort();
  return { exact, keys, keywordMap, entries: catalog.entries };
}

export function loadCatalog(): Index {
  if (!index) index = buildIndex();
  return index;
}

/** Number of catalog entries (loads the catalog). */
export function catalogSize(): number {
  return loadCatalog().entries.length;
}

/** Exact name/alias lookup, e.g. to find the catalog icon for a stored interest. */
export function lookupHobby(name: string): Hobby | null {
  return loadCatalog().exact.get(normalizeInput(name)) ?? null;
}

// ─── Levenshtein ──────────────────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return 1 - levenshtein(a, b) / maxLen;
}

// ─── Ranked fuzzy scan ────────────────────────────────────────────────────────
interface Scored {
  hobby: Hobby;
  score: number;
}

function fuzzyCandidates(input: string, limit: number): Scored[] {
  const idx = loadCatalog();
  const scored: Scored[] = [];
  const maxLenDiff = Math.max(2, Math.floor(input.length * 0.4));

  for (const key of idx.keys) {
    if (Math.abs(key.length - input.length) > maxLenDiff) continue;
    const score = similarity(input, key);
    if (score < AMBIGUOUS_THRESHOLD) continue;
    scored.push({ hobby: idx.exact.get(key)!, score });
  }

  scored.sort((a, b) => b.score - a.score);
  // Dedupe by hobby id (name + aliases may all match)
  const seen = new Set<string>();
  const out: Scored[] = [];
  for (const s of scored) {
    if (seen.has(s.hobby.id)) continue;
    seen.add(s.hobby.id);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────
/** Live suggestions while typing: prefix matches first, then fuzzy fill. */
export function suggest(input: string, limit = 8): Hobby[] {
  const q = normalizeInput(input);
  if (q.length < 2) return [];
  const idx = loadCatalog();

  const seen = new Set<string>();
  const out: Hobby[] = [];

  for (const key of idx.keys) {
    if (!key.startsWith(q)) continue;
    const hobby = idx.exact.get(key)!;
    if (seen.has(hobby.id)) continue;
    seen.add(hobby.id);
    out.push(hobby);
    if (out.length >= limit) return out;
  }

  // Word-boundary contains ("tennis" → "table tennis")
  for (const key of idx.keys) {
    if (!key.includes(' ' + q) && !key.includes('-' + q)) continue;
    const hobby = idx.exact.get(key)!;
    if (seen.has(hobby.id)) continue;
    seen.add(hobby.id);
    out.push(hobby);
    if (out.length >= limit) return out;
  }

  if (q.length >= 4) {
    for (const { hobby } of fuzzyCandidates(q, limit)) {
      if (seen.has(hobby.id)) continue;
      seen.add(hobby.id);
      out.push(hobby);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// ─── Resolution ───────────────────────────────────────────────────────────────
export function resolveInterest(input: string): ResolveResult {
  const q = normalizeInput(input);
  if (q.length < 2) return { status: 'none', match: null, candidates: [], confidence: 0 };

  const idx = loadCatalog();

  // 1) Exact name/alias
  const exact = idx.exact.get(q);
  if (exact) return { status: 'exact', match: exact, candidates: [exact], confidence: 1 };

  // 2) Unique prefix (input long enough to be meaningful)
  if (q.length >= 4) {
    const prefixHits: Hobby[] = [];
    const seen = new Set<string>();
    for (const key of idx.keys) {
      if (!key.startsWith(q)) continue;
      const hobby = idx.exact.get(key)!;
      if (!seen.has(hobby.id)) {
        seen.add(hobby.id);
        prefixHits.push(hobby);
      }
      if (prefixHits.length > 3) break;
    }
    if (prefixHits.length === 1) {
      return { status: 'confident', match: prefixHits[0], candidates: prefixHits, confidence: 0.9 };
    }
    if (prefixHits.length > 1) {
      return { status: 'ambiguous', match: null, candidates: prefixHits.slice(0, 3), confidence: 0.7 };
    }
  }

  // 3) Fuzzy
  const fuzzy = fuzzyCandidates(q, 3);
  if (fuzzy.length > 0) {
    const best = fuzzy[0];
    if (best.score >= AUTO_THRESHOLD) {
      return { status: 'confident', match: best.hobby, candidates: fuzzy.map((s) => s.hobby), confidence: best.score };
    }
    return { status: 'ambiguous', match: null, candidates: fuzzy.map((s) => s.hobby), confidence: best.score };
  }

  // 4) Keyword overlap (multi-word inputs like "underwater photography")
  const tokens = q.split(' ').filter((t) => t.length > 3);
  const counts = new Map<string, { hobby: Hobby; hits: number }>();
  for (const token of tokens) {
    for (const hobby of idx.keywordMap.get(token) ?? []) {
      const cur = counts.get(hobby.id);
      if (cur) cur.hits += 1;
      else counts.set(hobby.id, { hobby, hits: 1 });
    }
  }
  const keywordHits = [...counts.values()].sort((a, b) => b.hits - a.hits).slice(0, 3);
  if (keywordHits.length > 0) {
    return {
      status: 'ambiguous',
      match: null,
      candidates: keywordHits.map((k) => k.hobby),
      confidence: AMBIGUOUS_THRESHOLD,
    };
  }

  return { status: 'none', match: null, candidates: [], confidence: 0 };
}
