import { api } from './api';
import type { Swift, SwiftPage } from './swifts';

export const CREATOR_PAGE_SIZE = 24;

/** This endpoint applies profile, block and video-audience permissions on every page. */
export async function fetchCreatorSwifts(
  creatorId: number,
  { offset = 0, limit = CREATOR_PAGE_SIZE, signal }: {
    offset?: number; limit?: number; signal?: AbortSignal;
  } = {},
): Promise<SwiftPage> {
  const { data } = await api.get<SwiftPage>(`/api/swifts/creator/${creatorId}/`, {
    params: { limit, offset }, signal,
  });
  return { count: data.count, results: data.results };
}

export function creatorSwiftLabel(swift: Swift): string {
  if (!swift.is_mine) return '';
  if (swift.status === 'failed') return 'Upload failed';
  if (swift.review_state === 'needs_review') return 'Awaiting review';
  if (swift.review_state === 'reviewing') return 'Being reviewed';
  if (swift.status !== 'ready' || swift.review_state === 'processing') return 'Processing';
  if (swift.visibility === 'private') return 'Only me';
  if (swift.visibility === 'friends') return 'Friends';
  return 'Published';
}
