/**
 * Which of the nine categories each curated interest belongs to.
 *
 * The server sends `category` on every interest and that is always preferred
 * — this is the fallback for when it does not, which is the case for any
 * backend that has not run the categorising migration, and for the handful of
 * custom entries left behind by the retired "Other" flow.
 *
 * Generated from `scripts/interests_seed.json`, which is the same file the
 * backend seeds from, so the two agree by construction.
 * `services/__tests__/interestCategories.test.ts` pins that: adding an
 * interest to the seed without regenerating this file fails the suite and
 * names it.
 *
 * Split out of `interestCategories.ts` for the same reason
 * `interestIcons.ts` is split out of `icons.tsx` — this is a lookup table,
 * not logic, and it is long.
 */
import type { CategoryKey } from './interestCategories';

/** Lowercased interest name → category key. */
export const CATALOGUE_CATEGORIES: [Exclude<CategoryKey, ''>, string[]][] = [
  // Sports — 196
  ['sports', [
    'football', 'futsal', 'basketball', 'american football', 'baseball',
    'softball', 'tennis', 'padel', 'squash', 'volleyball',
    'beach volleyball', 'netball', 'rugby', 'cricket', 'ice hockey',
    'field hockey', 'lacrosse', 'table tennis', 'pickleball', 'badminton',
    'handball', 'golf', 'archery', 'bowling', 'curling', 'darts',
    'billiards', 'boxing', 'kickboxing', 'mma', 'muay thai', 'karate',
    'judo', 'taekwondo', 'jiu-jitsu', 'wrestling', 'sumo', 'fencing',
    'running', 'marathon', 'trail running', 'track & field', 'triathlon',
    'swimming', 'diving', 'scuba diving', 'snorkeling', 'water polo',
    'rowing', 'kayaking', 'canoeing', 'paddleboarding', 'sailing', 'surfing',
    'windsurfing', 'wakeboarding', 'kitesurfing', 'jet skiing', 'cycling',
    'mountain biking', 'bmx', 'horse riding', 'polo', 'gymnastics',
    'parkour', 'cheerleading', 'skateboarding', 'roller skating',
    'ice skating', 'figure skating', 'skiing', 'snowboarding', 'sledding',
    'rock climbing', 'bouldering', 'mountaineering', 'paragliding',
    'skydiving', 'motorsport', 'karting', 'motocross', 'ultimate frisbee',
    'disc golf', 'esports', 'australian rules football', 'gaelic football',
    'hurling', 'floorball', 'bandy', 'korfball', 'kabaddi', 'sepak takraw',
    'racquetball', 'snooker', 'pool', 'foosball', 'air hockey', 'dodgeball',
    'kickball', 'cornhole', 'shuffleboard', 'petanque', 'bocce',
    'lawn bowls', 'croquet', 'horseshoes', 'axe throwing', 'shooting sports',
    'clay shooting', 'paintball', 'airsoft', 'laser tag', 'sprinting',
    'hurdles', 'long jump', 'high jump', 'pole vault', 'shot put', 'javelin',
    'discus', 'decathlon', 'race walking', 'cross country running',
    'ultramarathon', 'orienteering', 'obstacle racing', 'freediving',
    'bodyboarding', 'white water rafting', 'canyoning', 'cliff diving',
    'synchronised swimming', 'open water swimming', 'dragon boat racing',
    'kung fu', 'aikido', 'krav maga', 'capoeira', 'kendo', 'sambo',
    'wing chun', 'savate', 'arm wrestling', 'kyokushin',
    'cross-country skiing', 'ski touring', 'freestyle skiing', 'ski jumping',
    'biathlon', 'ice climbing', 'snowshoeing', 'snowmobiling', 'luge',
    'bobsleigh', 'road cycling', 'track cycling', 'gravel cycling',
    'cyclocross', 'bikepacking', 'unicycling', 'sport climbing',
    'trad climbing', 'via ferrata', 'slacklining', 'hang gliding',
    'base jumping', 'bungee jumping', 'wingsuit flying',
    'hot air ballooning', 'rally racing', 'drifting', 'drag racing',
    'formula 1', 'enduro', 'trial riding', 'longboarding', 'scootering',
    'inline skating', 'roller derby', 'rodeo', 'show jumping', 'dressage',
    'tug of war', 'powerboating', 'rock fishing', 'spearfishing',
    'flag football', 'touch rugby', 'beach tennis',
    'roundnet', 'beach handball', 'underwater hockey',
    'wakesurfing', 'ski mountaineering', 'trampolining',
    'sports analytics',
  ]],
  // Fitness & Wellness — 50
  ['fitness', [
    'gym', 'weightlifting', 'powerlifting', 'crossfit', 'bodybuilding',
    'calisthenics', 'yoga', 'pilates', 'meditation', 'zumba', 'walking',
    'ice baths', 'sauna', 'massage & spa', 'self-improvement', 'stretching',
    'mobility training', 'foam rolling', 'kettlebells', 'trx training',
    'barre', 'aqua aerobics', 'aerobics', 'spinning', 'hiit',
    'bootcamp training', 'circuit training', 'tai chi', 'qigong',
    'breathwork', 'mindfulness', 'cold plunge', 'acupuncture',
    'physiotherapy', 'aromatherapy', 'reiki', 'sleep health',
    'intermittent fasting', 'personal training', 'marathon training',
    'reformer pilates', 'hot yoga', 'aerial yoga',
    'yin yoga', 'jump rope', 'resistance bands',
    'functional training', 'nordic walking', 'rucking',
    'sound baths',
  ]],
  // Music — 77
  ['music', [
    'music', 'singing', 'karaoke', 'guitar', 'bass guitar', 'ukulele',
    'piano', 'violin', 'cello', 'drums', 'saxophone', 'trumpet', 'banjo',
    'accordion', 'djing', 'music production', 'songwriting', 'rapping',
    'beatboxing', 'choir', 'rock', 'metal', 'hip-hop', 'jazz',
    'classical music', 'electronic music', 'techno', 'k-pop',
    'country music', 'flute', 'clarinet', 'oboe', 'harp', 'harmonica',
    'mandolin', 'sitar', 'tabla', 'bagpipes', 'trombone', 'tuba',
    'french horn', 'double bass', 'synthesizer', 'organ', 'music theory',
    'composing', 'orchestra', 'marching band', 'a cappella', 'opera',
    'blues', 'reggae', 'funk', 'soul', 'r&b', 'punk', 'indie music',
    'folk music', 'latin music', 'afrobeats', 'house music', 'drum & bass',
    'lo-fi', 'ambient music', 'vinyl collecting', 'live music', 'open mic',
    'pop music', 'j-pop', 'mandopop',
    'q-pop', 'disco', 'reggaeton',
    'trance', 'dubstep', 'dombra',
    'kobyz',
  ]],
  // Arts & Creativity — 101
  ['arts', [
    'drawing', 'painting', 'digital art', 'graphic design', 'animation',
    'sculpting', 'pottery', 'calligraphy', 'origami', 'photography',
    'videography', 'filmmaking', 'theater', 'improv', 'stand-up comedy',
    'cosplay', 'magic tricks', 'juggling', 'circus arts', 'dancing',
    'ballet', 'hip-hop dance', 'breakdancing', 'salsa', 'tango', 'writing',
    'poetry', 'journaling', 'blogging', 'scrapbooking', 'knitting',
    'crochet', 'sewing', 'embroidery', 'fashion design', 'jewelry making',
    'candle making', 'soap making', 'woodworking', 'diy & crafts',
    'interior design', 'flower arranging', 'makeup artistry', 'nail art',
    'tattoos', 'lego building', 'model building', 'watercolour',
    'oil painting', 'acrylic painting', 'charcoal drawing', 'sketching',
    'illustration', 'comic art', 'concept art', 'pixel art', '3d modelling',
    'motion graphics', 'ui/ux design', 'typography', 'printmaking',
    'linocut', 'screen printing', 'glassblowing', 'ceramics', 'mosaic',
    'macrame', 'quilting', 'weaving', 'leatherworking', 'bookbinding',
    'paper craft', 'resin art', 'street art', 'graffiti', 'face painting',
    'puppetry', 'voice acting', 'screenwriting', 'storytelling',
    'contemporary dance', 'jazz dance', 'tap dance', 'folk dance',
    'belly dance', 'pole dance', 'swing dance', 'bachata', 'kizomba',
    'flamenco', 'miniature painting',
    'tufting', 'needle felting', 'cross-stitch',
    'punch needle', 'diamond painting', 'stained glass',
    'air-dry clay', 'digital collage', 'stop-motion animation',
    'irish dance',
  ]],
  // Food & Drink — 71
  ['food', [
    'cooking', 'baking', 'bread making', 'bbq & grilling', 'coffee', 'tea',
    'bubble tea', 'wine tasting', 'craft beer', 'cocktails', 'sushi',
    'pizza', 'burgers', 'street food', 'ramen', 'desserts', 'chocolate',
    'ice cream', 'cheese', 'veganism', 'vegetarian', 'healthy eating',
    'nutrition', 'foodie', 'fine dining', 'brunch', 'picnics', 'smoothies',
    'meal prep', 'fermentation', 'pickling', 'home brewing', 'winemaking',
    'mixology', 'whisky', 'gin', 'sake', 'espresso', 'latte art', 'matcha',
    'pastry', 'cake decorating', 'cheesemaking', 'charcuterie',
    'pasta making', 'dim sum', 'dumplings', 'tacos', 'curry', 'kebab',
    'seafood', 'steak', 'noodles', 'salads', 'soups', 'food photography',
    'food trucks', 'farmers markets', 'keto', 'gluten-free',
    'baking sourdough',
    'korean food', 'thai food', 'indian food',
    'italian food', 'georgian food', 'kazakh food',
    'hot pot', 'kombucha', 'mocktails',
    'coffee roasting',
  ]],
  // Travel & Outdoors — 63
  ['travel', [
    'travel', 'solo travel', 'backpacking', 'camping', 'hiking',
    'road trips', 'van life', 'beach', 'cruises', 'train travel',
    'adventure travel', 'geocaching', 'national parks', 'stargazing',
    'astronomy', 'fishing', 'foraging', 'birdwatching', 'gardening',
    'houseplants', 'beekeeping', 'farming', 'off-roading', 'city breaks',
    'island hopping', 'safari', 'desert trips', 'hot springs', 'glamping',
    'overlanding', 'caving', 'wild swimming', 'waterfalls',
    'digital nomad life', 'language exchange', 'volunteer travel',
    'pilgrimage', 'cycling tours', 'motorcycle touring', 'wildlife watching',
    'whale watching', 'nature photography', 'mushroom picking', 'composting',
    'permaculture', 'bonsai', 'terrariums', 'succulents',
    'vegetable gardening', 'urban gardening', 'kayak fishing', 'fly fishing',
    'ice fishing',
    'nature walks', 'botanical gardens', 'forest bathing',
    'tide pooling', 'rock collecting', 'beachcombing',
    'scenic train rides', 'hostel travel', 'cultural travel',
    'local exploring',
  ]],
  // Games & Tech — 76
  ['games', [
    'gaming', 'retro gaming', 'vr gaming', 'board games', 'card games',
    'poker', 'chess', 'puzzles', 'mahjong', 'trivia', 'd&d & tabletop rpgs',
    'trading cards', 'escape rooms', 'coding', 'web development',
    'game development', 'ai & machine learning', 'robotics', 'pc building',
    '3d printing', 'electronics', 'drones', 'cybersecurity', 'crypto',
    'investing', 'personal finance', 'startups', 'entrepreneurship',
    'podcasts', 'streaming', 'console gaming', 'mobile gaming', 'mmorpgs',
    'fps games', 'strategy games', 'simulation games', 'speedrunning',
    'game modding', 'minecraft', 'sudoku', 'crosswords', 'rubik\'s cube',
    'jigsaw puzzles', 'backgammon', 'go', 'shogi', 'checkers', 'dominoes',
    'warhammer', 'magic: the gathering', 'open source', 'linux',
    'data science', 'cloud computing', 'app development', 'automation',
    'smart home', 'raspberry pi', 'arduino', 'ham radio', 'retro computing',
    'blockchain', 'trading', 'real estate', 'productivity', 'note-taking',
    'co-op games', 'cozy games', 'indie games',
    'rhythm games', 'fighting games', 'roguelikes',
    'sim racing', 'flight simulation', 'mechanical keyboards',
    'hackathons',
  ]],
  // Entertainment & Culture — 68
  ['entertainment', [
    'movies', 'tv series', 'anime', 'manga', 'comics', 'reading', 'concerts',
    'music festivals', 'museums & galleries', 'history', 'architecture',
    'philosophy', 'psychology', 'science', 'space exploration',
    'mathematics', 'languages', 'true crime', 'sci-fi', 'fantasy', 'horror',
    'documentaries', 'astrology', 'tarot', 'reality tv', 'sitcoms',
    'thrillers', 'musicals', 'theatre trips', 'film festivals',
    'indie films', 'classic films', 'korean drama', 'bollywood',
    'podcasting', 'audiobooks', 'book clubs', 'libraries', 'poetry slams',
    'archaeology', 'anthropology', 'mythology', 'religion', 'politics',
    'economics', 'sociology', 'linguistics', 'physics', 'chemistry',
    'biology', 'geology', 'meteorology', 'paleontology', 'ancient history',
    'art history', 'debate', 'public speaking', 'chess puzzles',
    'romance books', 'mystery books', 'historical fiction',
    'nonfiction', 'webtoons', 'c-dramas',
    'turkish drama', 'film clubs', 'ballet performances',
    'cultural festivals',
  ]],
  // Lifestyle & Social — 69
  ['lifestyle', [
    'dogs', 'cats', 'pets', 'horses', 'aquariums', 'reptiles',
    'volunteering', 'sustainability', 'thrifting', 'fashion', 'sneakers',
    'streetwear', 'vintage fashion', 'skincare', 'fragrances', 'cars',
    'motorcycles', 'car tuning', 'aviation', 'coin collecting',
    'stamp collecting', 'antiques', 'watches', 'nightlife', 'genealogy',
    'birds', 'rabbits', 'hamsters', 'guinea pigs', 'dog training',
    'animal rescue', 'wildlife conservation', 'zero waste', 'recycling',
    'minimalism', 'home decor', 'organising', 'perfume', 'haircare',
    'barbering', 'hairdressing', 'modelling', 'content creation', 'vlogging',
    'networking', 'mentoring', 'community building', 'activism', 'charity',
    'board game nights', 'clubbing', 'bar hopping', 'karaoke nights',
    'meetups', 'festivals', 'watch collecting', 'sneaker collecting',
    'vintage cars', 'cycling commute',
    'pet adoption', 'dog walking', 'cat cafes',
    'community gardening', 'beach cleanups', 'clothing swaps',
    'upcycling', 'repair cafes', 'pen pals',
    'dinner parties',
  ]],
];

const BY_NAME = new Map<string, Exclude<CategoryKey, ''>>();
for (const [key, names] of CATALOGUE_CATEGORIES) {
  for (const n of names) BY_NAME.set(n, key);
}

/** The category the curated catalogue puts this interest in, if it knows it. */
export function catalogueCategory(name: string): Exclude<CategoryKey, ''> | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}
