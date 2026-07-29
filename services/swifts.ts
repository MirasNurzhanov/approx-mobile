import { mockSwifts } from '@/data/mockSwifts';

// Swifts — short-form vertical video. This module is the seam: every screen and
// component reads through the functions below, so swapping mocks for real
// endpoints is a change to this file only. Nothing here touches the API client
// yet on purpose.

export interface SwiftAuthor {
  id: number;
  username: string;
  avatarUrl?: string;
}

export interface Swift {
  id: string;
  videoUrl: string;
  thumbnailUrl: string;
  author: SwiftAuthor;
  caption: string;
  audioTitle: string;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  isLiked: boolean;
  createdAt: string;
  durationMs: number;
}

/** Mimics a network round-trip so the feed's loading state is exercised in dev
 *  rather than only appearing once a real backend is wired up. */
const MOCK_LATENCY_MS = 600;

// TODO(api): GET /api/swifts/ — replace the mock resolve with api.get<Swift[]>.
export function getSwifts(): Promise<Swift[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(mockSwifts), MOCK_LATENCY_MS);
  });
}

// TODO(api): POST/DELETE /api/swifts/:id/like/. The feed already applies the
// optimistic update and rolls back on rejection, so this only needs to resolve
// or throw.
export function setSwiftLiked(id: string, liked: boolean): Promise<void> {
  void id;
  void liked;
  return Promise.resolve();
}
