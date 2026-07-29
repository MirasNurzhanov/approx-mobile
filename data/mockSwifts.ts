import type { Swift } from '@/services/swifts';

// Seed content for the Swifts feed. Kept in its own file so getSwifts() can be
// pointed at a real endpoint without touching any component, and so this can be
// deleted wholesale when that happens.
//
// Videos are Google's public sample MP4s — stable, CORS-open, and no CDN of our
// own required. Thumbnails come from the same bucket's poster images.

const GTV = 'https://storage.googleapis.com/gtv-videos-bucket/sample';

function minutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

export const mockSwifts: Swift[] = [
  {
    id: 'swift-1',
    videoUrl: `${GTV}/BigBuckBunny.mp4`,
    thumbnailUrl: `${GTV}/images/BigBuckBunny.jpg`,
    author: { id: 101, username: 'aylin', avatarUrl: undefined },
    caption: 'Golden hour at the lake — worth the 5am alarm ☀️',
    audioTitle: 'Sunrise Drive · Lo-fi Loops',
    likeCount: 1284,
    commentCount: 96,
    shareCount: 41,
    isLiked: false,
    createdAt: minutesAgo(24),
    durationMs: 596_000,
  },
  {
    id: 'swift-2',
    videoUrl: `${GTV}/ElephantsDream.mp4`,
    thumbnailUrl: `${GTV}/images/ElephantsDream.jpg`,
    author: { id: 102, username: 'marat', avatarUrl: undefined },
    caption: 'Trying the new bouldering route downtown. Took 11 attempts.',
    audioTitle: 'Original audio · marat',
    likeCount: 312,
    commentCount: 28,
    shareCount: 7,
    isLiked: true,
    createdAt: minutesAgo(95),
    durationMs: 653_000,
  },
  {
    id: 'swift-3',
    videoUrl: `${GTV}/ForBiggerBlazes.mp4`,
    thumbnailUrl: `${GTV}/images/ForBiggerBlazes.jpg`,
    author: { id: 103, username: 'dana.k', avatarUrl: undefined },
    caption: 'Street food tour, stop 3 of 7 🍜',
    audioTitle: 'Night Market · Kavi',
    likeCount: 8421,
    commentCount: 503,
    shareCount: 214,
    isLiked: false,
    createdAt: minutesAgo(180),
    durationMs: 15_000,
  },
  {
    id: 'swift-4',
    videoUrl: `${GTV}/ForBiggerEscapes.mp4`,
    thumbnailUrl: `${GTV}/images/ForBiggerEscapes.jpg`,
    author: { id: 104, username: 'temirlan', avatarUrl: undefined },
    caption: 'Weekend drive out to the canyon. No signal for 3 hours, highly recommend.',
    audioTitle: 'Open Road · The Hums',
    likeCount: 76,
    commentCount: 4,
    shareCount: 1,
    isLiked: false,
    createdAt: minutesAgo(420),
    durationMs: 15_000,
  },
  {
    id: 'swift-5',
    videoUrl: `${GTV}/ForBiggerJoyrides.mp4`,
    thumbnailUrl: `${GTV}/images/ForBiggerJoyrides.jpg`,
    author: { id: 105, username: 'sofia', avatarUrl: undefined },
    caption: 'Pottery class results. Mug #1 leaks, mug #2 is perfect.',
    audioTitle: 'Slow Hands · Ferro',
    likeCount: 2039,
    commentCount: 147,
    shareCount: 63,
    isLiked: false,
    createdAt: minutesAgo(1_440),
    durationMs: 15_000,
  },
];
