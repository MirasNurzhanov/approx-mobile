import type { Venue } from './venues';

/**
 * Venue search, done on the device.
 *
 * The whole editorial list is already fetched for the map — a few dozen rows —
 * so filtering it here answers as the user types, works offline once loaded,
 * and asks the server nothing new. If the list ever outgrows one page this is
 * the function to swap for a request; its callers only see venues in, venues out.
 */

/** Lowercase, accents folded, punctuation dropped: "Caffè Nero" ≈ "caffe nero",
 *  "% Arabica" ≈ "arabica", "Carluccio's" ≈ "carluccios". */
function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** 0 = name starts with the query, 1 = a word in the name does, 2 = the name
 *  contains it, 3 = only the category or address match, null = no match. */
function rank(venue: Pick<Venue, 'name' | 'category' | 'address'>, query: string, tokens: string[]): number | null {
  const name = normalise(venue.name);
  const rest = `${normalise(venue.category)} ${normalise(venue.address)}`;
  const all = `${name} ${rest}`;
  // Every word typed must appear somewhere, so "coffee jbr" narrows rather
  // than widens.
  if (!tokens.every(token => all.includes(token))) return null;
  if (name.startsWith(query)) return 0;
  if (name.split(' ').some(word => word.startsWith(tokens[0]))) return 1;
  if (name.includes(tokens[0])) return 2;
  return 3;
}

/** Venues matching `query`, best first. An empty query returns every venue by
 *  name, so the list doubles as a browsable directory. */
export function searchVenues<T extends Pick<Venue, 'name' | 'category' | 'address'>>(venues: T[], query: string): T[] {
  const q = normalise(query);
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  if (!q) return [...venues].sort(byName);
  const tokens = q.split(' ');
  return venues
    .map(venue => ({ venue, score: rank(venue, q, tokens) }))
    .filter((row): row is { venue: T; score: number } => row.score !== null)
    .sort((a, b) => a.score - b.score || byName(a.venue, b.venue))
    .map(row => row.venue);
}
