import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { api } from './api';
import { markCheckedOut } from './checkIn';

// Single source of truth for privacy settings, shared by the Privacy & safety
// screen and the Settings tab so a change on one updates the other without a
// refetch. Backed by GET/PATCH /api/users/privacy/.
//
// Everything here is a *mirror* of server state, never the enforcement point:
// the API omits fields the viewer may not see, so hiding something in the UI
// is a rendering detail, not a privacy control.

export type Audience = 'everyone' | 'friends' | 'nobody';

/** Who besides friends may ever see you. `private` is friends-only, with no
 *  check-in to make; `discoverable` puts the Check in button on the map. It
 *  never makes anybody visible by itself — only the tap does, each session. */
export type DiscoveryMode = 'private' | 'discoverable';

export interface PrivacySettings {
  /** The one off switch for the map, and it cuts both ways: a ghost is on
   * nobody's map and has nobody on theirs. Replaced a three-way
   * live/approximate/paused mode — precision is not chosen any more, friends
   * see the precise point and everybody else a ~500m cell, decided per viewer
   * on the server. */
  ghost_mode: boolean;
  discovery_mode: DiscoveryMode;
  is_private: boolean;
  visibility_interests: Audience;
  visibility_stories: Audience;
  visibility_stats: Audience;
  visibility_zone_audio: Audience;
  visibility_connections: Audience;
  visibility_links: Audience;
  /** Online/offline and last-seen. Motion state follows this too, but is
   * additionally capped to friends and connections server-side — a stranger
   * never sees it whatever this is set to. */
  visibility_presence: Audience;
  discoverable_by_username: boolean;
  discoverable_by_interest: boolean;
}

export const AUDIENCES: Audience[] = ['everyone', 'friends', 'nobody'];

export const AUDIENCE_LABEL: Record<Audience, string> = {
  everyone: 'Everyone',
  friends: 'Friends',
  nobody: 'Nobody',
};

interface State {
  /** null = not fetched yet this session. */
  settings: PrivacySettings | null;
}

// The background location task wakes in a fresh JS context with an empty
// store, so Ghost Mode is mirrored to disk and read from there. Somebody who
// turned themselves off must stay off even when the app is not running.
const GHOST_STORAGE = 'aura:privacy:ghostMode';

let state: State = { settings: null };
const listeners = new Set<() => void>();

function setState(next: State) {
  state = next;
  if (next.settings) {
    // Mirrored to disk so the background task, which wakes in a fresh JS
    // context, can read it without a round trip.
    AsyncStorage.setItem(
      GHOST_STORAGE, next.settings.ghost_mode ? '1' : '0',
    ).catch(() => {});
  }
  listeners.forEach((l) => l());
}

/**
 * Whether Ghost Mode is on, readable from a background task.
 *
 * Defaults to *off* when nothing is known, matching the server's default for a
 * new account. That is a fail-open guess and it is a deliberate one now: the
 * thing it risks is transmitting a position for somebody who had turned
 * themselves off, and the mirror is written on every change precisely so that
 * cannot happen — a ghost has `'1'` on disk before this is ever consulted.
 * Guessing the other way would instead hide a sharing user from the map until
 * their first fetch landed, on every cold start, which is the failure people
 * actually hit.
 *
 * The disclosure gate is the separate protection against a cold install
 * transmitting anything at all — see services/locationDisclosure.ts.
 */
export async function getCachedGhostMode(): Promise<boolean> {
  if (state.settings) return state.settings.ghost_mode;
  try {
    const stored = await AsyncStorage.getItem(GHOST_STORAGE);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    // Fall through to the default.
  }
  return false;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrivacySettings(): State {
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * Ghost Mode, for screens that only read it. `null` means "not known yet" — a
 * caller drawing something that depends on it should wait rather than assume,
 * so the map does not flash a state the user is not in.
 *
 * No fetch: the privacy screen writes every change into this store and mirrors
 * it to disk, so reading the mirror is enough and costs nothing on a screen
 * that is already polling.
 */
export function useGhostMode(): boolean | null {
  const { settings } = usePrivacySettings();
  const [mirrored, setMirrored] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    getCachedGhostMode()
      .then((ghost) => { if (active) setMirrored(ghost); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return settings?.ghost_mode ?? mirrored;
}

/**
 * Drop the signed-in user's settings, in memory and on disk.
 *
 * Both halves matter. The in-memory copy would otherwise be inherited by the
 * next account to sign in on this device, and the disk mirror is read by the
 * background location task — so a previous user's Ghost Mode (or worse, the
 * absence of it) would govern the next user's location reporting until they
 * happened to open the privacy screen.
 */
export async function resetPrivacy(): Promise<void> {
  setState({ settings: null });
  try {
    await AsyncStorage.removeItem(GHOST_STORAGE);
  } catch {}
}

export async function refreshPrivacy(): Promise<PrivacySettings | null> {
  const { data } = await api.get<PrivacySettings>('/api/users/privacy/');
  setState({ settings: data });
  return data;
}

/**
 * Optimistic update; rolls back and rethrows if the server rejects it. The
 * server is authoritative — the value that lands in the store is the one it
 * echoes back, not the one we sent.
 */
export async function updatePrivacy(patch: Partial<PrivacySettings>): Promise<void> {
  const previous = state.settings;
  if (previous) setState({ settings: { ...previous, ...patch } });
  try {
    const { data } = await api.patch<PrivacySettings>('/api/users/privacy/', patch);
    setState({ settings: data });
    // The server ends a check-in on going Private or Ghost; mirror that so the
    // map's button does not keep claiming a visibility that is gone.
    if (data.ghost_mode || data.discovery_mode === 'private') markCheckedOut();
  } catch (e) {
    if (previous) setState({ settings: previous });
    throw e;
  }
}
