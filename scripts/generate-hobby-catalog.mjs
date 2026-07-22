// Generates the bundled hobby catalog used by the "Other" interest flow.
//
//   npm run generate:hobbies
//
// Inputs:  scripts/hobby-sources/*.json  (see scripts/hobby-sources/SOURCES.md)
//          scripts/interests_seed.json   (curated in-repo seed, merged first)
// Outputs: data/hobbies.json                       (catalog, sorted, deterministic)
//          components/ui/hobbyIcons.generated.ts   (lucide icon map, tree-shakeable)
//
// The script fails (exit 1) if any entry maps to a lucide icon name that does
// not exist in the installed lucide-react-native package, or on duplicate ids.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'scripts', 'hobby-sources');
const LUCIDE_ICON_DIR = path.join(ROOT, 'node_modules', 'lucide-react-native', 'dist', 'esm', 'icons');

// ─── Canonical categories ─────────────────────────────────────────────────────
// category → fallback lucide icon (kebab-case)
const CATEGORY_FALLBACK_ICON = {
  sports: 'trophy',
  fitness: 'dumbbell',
  music: 'music',
  arts: 'palette',
  crafts: 'scissors',
  outdoors: 'mountain',
  food: 'utensils',
  gaming: 'gamepad-2',
  tech: 'cpu',
  collecting: 'archive',
  entertainment: 'clapperboard',
  lifestyle: 'heart',
};
const GENERIC_FALLBACK_ICON = 'shapes';

// ─── Wikipedia sources: file → default category ──────────────────────────────
const WIKI_SOURCES = {
  'List_of_sports.json': 'sports',
  'List_of_water_sports.json': 'sports',
  'List_of_martial_arts.json': 'sports',
  'List_of_dance_styles.json': 'arts',
  'List_of_musical_instruments.json': 'music',
  'List_of_cuisines.json': 'food',
  'List_of_board_games.json': 'gaming',
  'Outline_of_games.json': 'gaming',
  'Outline_of_crafts.json': 'crafts',
  'List_of_collectables.json': 'collecting',
};

// Seed categories (scripts/interests_seed.json) → canonical categories
const SEED_CATEGORY_MAP = {
  'Sports': 'sports',
  'Fitness & Wellness': 'fitness',
  'Music': 'music',
  'Arts & Creativity': 'arts',
  'Food & Drink': 'food',
  'Travel & Outdoors': 'outdoors',
  'Games & Tech': 'gaming', // refined to "tech" by keyword rules below
  'Entertainment & Culture': 'entertainment',
  'Lifestyle & Social': 'lifestyle',
};

// Keyword → category refinements, applied after the source default
const CATEGORY_RULES = [
  [/\b(coding|programming|web development|software|ai |machine learning|robot|electronic|computer|pc |3d printing|drone|cyber|crypto|tech)\b/i, 'tech'],
  [/\b(gym|yoga|pilates|zumba|crossfit|weightlift|powerlift|bodybuild|calisthenic|meditation|welln|fitness)\b/i, 'fitness'],
  [/\b(hiking|camping|fishing|climbing|kayak|canoe|birdwatch|foraging|garden|stargaz|backpack|outdoor)\b/i, 'outdoors'],
  [/\bcollect|philately|numismat/i, 'collecting'],
  [/\b(knitting|crochet|sewing|embroidery|quilt|woodwork|pottery|origami|scrapbook|candle|soap making|crafting)\b/i, 'crafts'],
];

// ─── Curated icon rules ───────────────────────────────────────────────────────
// Exact name (normalized key) → lucide icon
const ICON_EXACT = {
  'photography': 'camera', 'videography': 'video', 'filmmaking': 'clapperboard',
  'guitar': 'guitar', 'bass guitar': 'guitar', 'ukulele': 'guitar', 'banjo': 'guitar',
  'piano': 'piano', 'keyboard': 'piano', 'drums': 'drum', 'singing': 'mic',
  'karaoke': 'mic', 'djing': 'headphones', 'music production': 'headphones',
  'podcasts': 'podcast', 'chess': 'crown', 'poker': 'spade', 'astronomy': 'telescope',
  'stargazing': 'telescope', 'science': 'flask-conical', 'coffee': 'coffee',
  'tea': 'coffee', 'baking': 'cake-slice', 'cooking': 'chef-hat', 'wine tasting': 'wine',
  'craft beer': 'beer', 'cocktails': 'martini', 'pizza': 'pizza', 'sushi': 'fish',
  'travel': 'plane', 'aviation': 'plane', 'sailing': 'sailboat', 'camping': 'tent',
  'hiking': 'mountain', 'cycling': 'bike', 'running': 'footprints', 'swimming': 'waves-horizontal',
  'fishing': 'fish', 'birdwatching': 'bird', 'dogs': 'dog', 'cats': 'cat',
  'pets': 'paw-print', 'horses': 'paw-print', 'gardening': 'sprout', 'houseplants': 'sprout',
  'reading': 'book-open', 'books': 'book-open', 'writing': 'pen-tool', 'poetry': 'feather',
  'journaling': 'notebook-pen', 'blogging': 'keyboard', 'drawing': 'pencil',
  'painting': 'brush', 'sculpting': 'shapes', 'gaming': 'gamepad-2',
  'board games': 'dice-5', 'puzzles': 'puzzle', 'coding': 'code', 'robotics': 'bot',
  'startups': 'rocket', 'investing': 'trending-up', 'movies': 'film', 'tv series': 'tv',
  'anime': 'sparkles', 'theater': 'drama', 'fashion': 'shirt', 'sneakers': 'footprints',
  'watches': 'watch', 'volunteering': 'heart-handshake', 'languages': 'globe',
  'history': 'landmark', 'architecture': 'building-2', 'psychology': 'brain',
  'philosophy': 'brain', 'mathematics': 'calculator', 'geocaching': 'map-pin',
  'skiing': 'snowflake', 'snowboarding': 'snowflake', 'ice skating': 'snowflake',
  'surfing': 'waves-horizontal', 'skateboarding': 'skull', 'golf': 'land-plot', 'archery': 'target',
  'darts': 'target', 'bowling': 'circle-dot', 'billiards': 'circle-dot',
  'weightlifting': 'dumbbell', 'gym': 'dumbbell', 'yoga': 'flower-2', 'meditation': 'flower-2',
  'boxing': 'swords', 'fencing': 'swords', 'esports': 'gamepad-2',
};

// Substring rules (checked in order after ICON_EXACT), name → icon
const ICON_RULES = [
  [/cuisine|food|dining|dish/i, 'utensils'],
  [/dance|dancing|ballet|salsa|tango|waltz|polka/i, 'footprints'],
  [/guitar|lute|banjo|mandolin|sitar/i, 'guitar'],
  [/piano|organ|harpsichord|accordion|keyboard/i, 'piano'],
  [/drum|percussion|cymbal|tambourine|marimba|xylophone/i, 'drum'],
  [/violin|viola|cello|fiddle|harp|flute|clarinet|oboe|trumpet|trombone|horn|sax|whistle|bagpipe|ocarina|harmonica/i, 'music'],
  [/swim|surf|dive|diving|kayak|canoe|row|raft|paddle|polo|aquatic/i, 'waves-horizontal'],
  [/sail|boat|yacht/i, 'sailboat'],
  [/climb|mountain|alpin|boulder/i, 'mountain'],
  [/cycl|bike|bmx|biking/i, 'bike'],
  [/run(ning)?\b|marathon|sprint|athletic/i, 'footprints'],
  [/box|karate|judo|jiu|kung|taekwondo|aikido|wrestl|martial|combat|fenc|kickbox|sumo|silat|krav|sambo|capoeira/i, 'swords'],
  [/shoot|archery|dart|target|rifle|pistol/i, 'target'],
  [/ski|snow|ice |skat|curling|sled|luge|bobsle/i, 'snowflake'],
  [/fish/i, 'fish'],
  [/bird/i, 'bird'],
  [/horse|equestrian|rodeo|polo/i, 'paw-print'],
  [/car |racing|motor|kart|rally|drift/i, 'car'],
  [/fly|glid|parachut|skydiv|balloon|aero/i, 'plane'],
  [/card|poker|bridge|rummy|solitaire/i, 'spade'],
  [/game|dominoes|mahjong|backgammon|checkers|draughts|go\b/i, 'dice-5'],
  [/knit|crochet|sew|embroider|quilt|weav|spin|textile|yarn|cross-stitch|needle/i, 'scissors'],
  [/wood|carv|whittl|carpen|lathe/i, 'hammer'],
  [/metal|blacksmith|weld|forg/i, 'wrench'],
  [/pott|ceramic|clay|glass/i, 'shapes'],
  [/paint|draw|sketch|illustrat|calligraph|art\b/i, 'brush'],
  [/photo|camera/i, 'camera'],
  [/coin|stamp|antiqu|collect|memorabilia|figurine/i, 'archive'],
  [/book|read|literature|manga|comic/i, 'book-open'],
  [/cook|bak|grill|barbecue|brew/i, 'chef-hat'],
  [/wine|beer|whisk|cocktail|spirits/i, 'wine'],
  [/garden|plant|flower|botan|bonsai/i, 'sprout'],
  [/hik|trek|walk|rambl|orienteer/i, 'mountain'],
  [/camp|scout/i, 'tent'],
  [/tennis|badminton|squash|racket|racquet|pickleball|paddle/i, 'trophy'],
  [/ball\b|football|soccer|rugby|cricket|hockey|lacrosse|baseball|softball|basket|volley|netball|handball/i, 'trophy'],
  [/gymnast|acrobat|parkour|cheer|tumbl/i, 'activity'],
];

// ─── Curated aliases / misspellings / Russian variants ───────────────────────
// normalized entry key → extra aliases
const ALIAS_TABLE = {
  'photography': ['photog', 'taking photos', 'photograpy', 'fotography', 'фотография', 'фото'],
  'football': ['футбол'],
  'basketball': ['баскетбол'],
  'volleyball': ['волейбол'],
  'swimming': ['плавание'],
  'running': ['jogging', 'бег'],
  'cycling': ['biking', 'велоспорт', 'велосипед'],
  'boxing': ['бокс'],
  'chess': ['шахматы'],
  'cooking': ['cookery', 'кулинария', 'готовка'],
  'baking': ['выпечка'],
  'reading': ['чтение', 'книги'],
  'writing': ['письмо'],
  'drawing': ['рисование'],
  'painting': ['живопись'],
  'music': ['музыка'],
  'singing': ['пение', 'вокал'],
  'guitar': ['гитара'],
  'piano': ['пианино', 'фортепиано'],
  'dancing': ['dance', 'танцы'],
  'gaming': ['video games', 'videogames', 'видеоигры', 'игры'],
  'travel': ['travelling', 'traveling', 'путешествия'],
  'hiking': ['треккинг', 'походы', 'хайкинг'],
  'camping': ['кемпинг'],
  'fishing': ['рыбалка'],
  'yoga': ['йога'],
  'meditation': ['медитация'],
  'gym': ['workout', 'working out', 'тренажерный зал', 'качалка'],
  'coding': ['programming', 'программирование'],
  'gardening': ['садоводство'],
  'knitting': ['вязание'],
  'sewing': ['шитье'],
  'movies': ['кино', 'фильмы'],
  'anime': ['аниме'],
  'coffee': ['кофе'],
  'tea': ['чай'],
  'skiing': ['лыжи'],
  'snowboarding': ['сноуборд'],
  'skateboarding': ['skating', 'скейтбординг', 'скейт'],
  'tennis': ['теннис'],
  'table tennis': ['ping pong', 'ping-pong', 'настольный теннис'],
  'martial arts': ['боевые искусства'],
  'karaoke': ['караоке'],
  'theater': ['theatre', 'театр'],
  'fashion': ['мода'],
  'astrology': ['астрология'],
  'astronomy': ['астрономия'],
  'volunteering': ['волонтерство'],
  'languages': ['language learning', 'изучение языков'],
  'baseball': ['бейсбол'],
  'surfing': ['серфинг'],
  'ice hockey': ['hockey', 'хоккей'],
  'billiards': ['pool', 'бильярд'],
  'bowling': ['боулинг'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normalizeKey(s) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^\p{L}\p{N}& -]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(key) {
  return key.replace(/[& ]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pluralAliases(key) {
  const out = [];
  if (key.endsWith('ies')) out.push(key.slice(0, -3) + 'y');
  else if (key.endsWith('es')) out.push(key.slice(0, -2), key.slice(0, -1));
  else if (key.endsWith('s')) out.push(key.slice(0, -1));
  else out.push(key + 's');
  return out;
}

function pickIcon(key, category) {
  if (ICON_EXACT[key]) return ICON_EXACT[key];
  for (const [re, icon] of ICON_RULES) if (re.test(key)) return icon;
  return CATEGORY_FALLBACK_ICON[category] ?? GENERIC_FALLBACK_ICON;
}

function refineCategory(key, fallback) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(key)) return cat;
  return fallback;
}

// ─── Parse wikitext bullet lists ─────────────────────────────────────────────
const SKIP_NAME = /list of|outline of|index of|glossary|category:|file:|wikipedia|template|history of|timeline/i;

function extractWikiEntries(wikitext) {
  const names = [];
  for (const line of wikitext.split('\n')) {
    const m = line.match(/^\*+\s*(?:'''?)?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (!m) continue;
    let name = (m[2] ?? m[1]).trim();
    name = name.replace(/\(.*?\)/g, '').replace(/<[^>]*>/g, '').replace(/'''?/g, '').trim();
    if (!name || name.length < 3 || name.length > 40) continue;
    if (SKIP_NAME.test(name) || name.includes(':') || name.includes('#') || /^\d+$/.test(name)) continue;
    names.push(name);
  }
  return names;
}

// ─── Build catalog ────────────────────────────────────────────────────────────
const entries = new Map(); // key → entry
const takenIds = new Set(); // slug collisions ("Pall Mall" vs "Pall-Mall") — first wins

function addEntry(rawName, category) {
  const key = normalizeKey(rawName);
  if (!key || key.length < 3) return;
  const cat = refineCategory(key, category);
  if (entries.has(key)) return; // first source wins (seed is added first)
  const id = slugify(key);
  if (takenIds.has(id)) return;
  takenIds.add(id);
  entries.set(key, {
    id,
    name: titleCase(rawName.trim()),
    aliases: [],
    category: cat,
    icon: pickIcon(key, cat),
    keywords: [],
  });
}

// 1) Curated seed first — its names/categories win dedupe
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'interests_seed.json'), 'utf8'));
for (const [seedCat, items] of Object.entries(seed)) {
  const cat = SEED_CATEGORY_MAP[seedCat] ?? 'lifestyle';
  for (const item of items) addEntry(item.name, cat);
}

// 2) Wikipedia snapshots
for (const [file, category] of Object.entries(WIKI_SOURCES)) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC_DIR, file), 'utf8'));
  if (!raw.parse?.wikitext) {
    console.error(`FAIL: ${file} has no parse.wikitext — re-fetch it (see SOURCES.md)`);
    process.exit(1);
  }
  for (const name of extractWikiEntries(raw.parse.wikitext)) addEntry(name, category);
}

// 3) Aliases + keywords
const claimedAliases = new Map(); // alias key → entry key (avoid cross-entry collisions)
for (const [key, entry] of entries) {
  const aliasSet = new Set();
  for (const a of pluralAliases(key)) aliasSet.add(a);
  for (const a of ALIAS_TABLE[key] ?? []) aliasSet.add(normalizeKey(a));
  aliasSet.delete(key);
  for (const a of aliasSet) {
    if (!a || entries.has(a) || claimedAliases.has(a)) continue; // real entries & first claim win
    claimedAliases.set(a, key);
    entry.aliases.push(a);
  }
  entry.aliases.sort();
  const tokens = new Set(key.split(/[ -]/).filter((t) => t.length > 2));
  tokens.add(entry.category);
  entry.keywords = [...tokens].sort();
}

// ─── Validate icons against the installed lucide manifest ────────────────────
const lucideIcons = new Set(
  fs.readdirSync(LUCIDE_ICON_DIR).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, ''))
);
const badIcons = new Set();
for (const icon of [...Object.values(CATEGORY_FALLBACK_ICON), GENERIC_FALLBACK_ICON]) {
  if (!lucideIcons.has(icon)) badIcons.add(icon);
}
for (const entry of entries.values()) {
  if (!lucideIcons.has(entry.icon)) badIcons.add(entry.icon);
}
if (badIcons.size > 0) {
  console.error(`FAIL: ${badIcons.size} icon name(s) not in lucide-react-native:`);
  console.error('  ' + [...badIcons].sort().join(', '));
  process.exit(1);
}

// Duplicate-id check (slugify could collide)
const ids = new Set();
for (const e of entries.values()) {
  if (ids.has(e.id)) {
    console.error(`FAIL: duplicate id "${e.id}"`);
    process.exit(1);
  }
  ids.add(e.id);
}

// ─── Emit data/hobbies.json ──────────────────────────────────────────────────
const sorted = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
const catalog = { version: 1, count: sorted.length, entries: sorted };
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'hobbies.json'), JSON.stringify(catalog) + '\n');

// ─── Emit components/ui/hobbyIcons.generated.ts ──────────────────────────────
function pascal(kebab) {
  return kebab.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}
const usedIcons = [...new Set([
  ...sorted.map((e) => e.icon),
  ...Object.values(CATEGORY_FALLBACK_ICON),
  GENERIC_FALLBACK_ICON,
])].sort();

const ts = `// AUTO-GENERATED by scripts/generate-hobby-catalog.mjs — do not edit.
// Regenerate with: npm run generate:hobbies
// Per-icon deep imports (via the package's "./icons/*" export) so Metro only
// bundles these ${usedIcons.length} modules — never the ${lucideIcons.size}-icon barrel file.
import type { ComponentType } from 'react'
${usedIcons.map((i) => `import ${pascal(i)} from 'lucide-react-native/icons/${i}'`).join('\n')}

export interface HobbyIconProps {
  size?: number
  color?: string
  strokeWidth?: number
}

export type HobbyIconComponent = ComponentType<HobbyIconProps>

const ICONS: Record<string, HobbyIconComponent> = {
${usedIcons.map((i) => `  '${i}': ${pascal(i)},`).join('\n')}
}

const CATEGORY_FALLBACK: Record<string, string> = ${JSON.stringify(CATEGORY_FALLBACK_ICON, null, 2).replace(/"([a-z]+)":/g, "'$1':").replace(/"/g, "'")}

const GENERIC_FALLBACK = '${GENERIC_FALLBACK_ICON}'

/** Resolve a catalog icon name (with category, then generic, fallback). */
export function hobbyIcon(icon?: string, category?: string): HobbyIconComponent {
  if (icon && ICONS[icon]) return ICONS[icon]
  const fallback = category ? CATEGORY_FALLBACK[category] : undefined
  return (fallback && ICONS[fallback]) || ICONS[GENERIC_FALLBACK]
}
`;
fs.writeFileSync(path.join(ROOT, 'components', 'ui', 'hobbyIcons.generated.ts'), ts);

// ─── Report ──────────────────────────────────────────────────────────────────
const byCat = {};
for (const e of sorted) byCat[e.category] = (byCat[e.category] ?? 0) + 1;
console.log(`hobbies.json: ${sorted.length} entries, ${usedIcons.length} distinct icons`);
console.log(Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, n]) => `  ${c}: ${n}`).join('\n'));
if (sorted.length < 1500) {
  console.error('FAIL: catalog smaller than 1500 entries — check sources');
  process.exit(1);
}
if (sorted.length < 2000) console.warn('WARN: catalog below the 2000-entry target');
