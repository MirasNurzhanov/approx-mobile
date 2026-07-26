import { useSyncExternalStore } from 'react';

import { api } from './api';

// Single source of truth for the block list. The Chat "Blocked" tab, the
// Settings → Blocked users screen, and the profile Block action all go
// through this module, so a block/unblock on any surface updates the others
// immediately. The backend endpoints (friends app):
//   POST   /api/friends/<id>/block/     — block
//   GET    /api/friends/blocked/        — list (users I blocked)
//   DELETE /api/friends/<id>/unblock/   — unblock

export interface BlockedUserSummary {
  id: number;
  username: string;
  profile_picture?: string;
}

interface BlockedState {
  /** null = not fetched yet this session. */
  list: BlockedUserSummary[] | null;
}

let state: BlockedState = { list: null };
const listeners = new Set<() => void>();

function setState(next: BlockedState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBlockedUsers(): BlockedState {
  return useSyncExternalStore(subscribe, () => state);
}

export async function refreshBlocked(): Promise<void> {
  const { data } = await api.get<BlockedUserSummary[]>('/api/friends/blocked/');
  setState({ list: Array.isArray(data) ? data : [] });
}

/** Optimistic block; throws after rollback if the request fails. */
export async function blockUser(user: BlockedUserSummary): Promise<void> {
  const prev = state;
  const list = state.list ?? [];
  if (!list.some((u) => u.id === user.id)) {
    setState({ list: [user, ...list] });
  }
  try {
    await api.post(`/api/friends/${user.id}/block/`);
  } catch (e: any) {
    // Already blocked server-side = success for our purposes.
    if (e?.response?.status !== 400) {
      setState(prev);
      throw e;
    }
  }
}

/** Optimistic unblock; throws after rollback if the request fails. */
export async function unblockUser(userId: number): Promise<void> {
  const prev = state;
  setState({ list: (state.list ?? []).filter((u) => u.id !== userId) });
  try {
    await api.delete(`/api/friends/${userId}/unblock/`);
  } catch (e: any) {
    // Already unblocked server-side = success for our purposes.
    if (e?.response?.status !== 404) {
      setState(prev);
      throw e;
    }
  }
}
