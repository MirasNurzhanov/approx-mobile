import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { api } from './api';
import { forgetSharingSession, rememberSharingSession } from './sharingSession';

// Single source of truth for privacy settings, shared by the Privacy & safety
// screen and the Settings tab so a change on one updates the other without a
// refetch. Backed by GET/PATCH /api/users/privacy/.
//
// Everything here is a *mirror* of server state, never the enforcement point:
// the API omits fields the viewer may not see, so hiding something in the UI
// is a rendering detail, not a privacy control.

export type Audience = 'everyone' | 'friends' | 'nobody';
export type LocationSharing = 'live' | 'approximate' | 'paused';

export interface PrivacySettings {
  location_sharing: LocationSharing;
  /** Which run of the app turned sharing on; null while paused. Held in memory
   * by services/sharingSession.ts and deliberately never written to disk — a
   * token that survived a restart would be the "previous preference says you
   * were visible" the whole mechanism exists to prevent. */
  sharing_session?: string | null;
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

export const LOCATION_SHARING_LABEL: Record<LocationSharing, string> = {
  live: 'Live',
  approximate: 'Approximate',
  paused: 'Paused',
};

interface State {
  /** null = not fetched yet this session. */
  settings: PrivacySettings | null;
}

// The background location task wakes in a fresh JS context with an empty
// store, so the sharing mode is mirrored to disk and read from there. A user
// who paused sharing must stay paused even when the app is not running.
const SHARING_STORAGE = 'aura:privacy:locationSharing';

let state: State = { settings: null };
const listeners = new Set<() => void>();

function setState(next: State) {
  state = next;
  if (next.settings) {
    // The mode is mirrored to disk so the background task can read it. The
    // session token deliberately is not: it lives in memory for exactly as
    // long as this run of the app does, and that is what makes going visible
    // a per-launch decision instead of a stored preference.
    AsyncStorage.setItem(SHARING_STORAGE, next.settings.location_sharing).catch(() => {});
    // Unowned: this runs for reads as well as writes, and a token merely read
    // back belongs to whichever run set it. It still clears on a null, which
    // is the only direction a read may safely move it. `updatePrivacy` claims
    // ownership explicitly for the writes it makes.
    rememberSharingSession(next.settings.sharing_session);
  }
  listeners.forEach((l) => l());
}

/**
 * The sharing mode, readable from a background task.
 *
 * Defaults to 'paused' when nothing is known, which is both the server's
 * default for a new account and the safe direction to be wrong in. It used to
 * default to 'live', from when that was the server default — a fail-*open*
 * guess that would have had a brand-new install transmitting a position before
 * its owner had chosen anything. The server refuses those writes now (403), so
 * nothing leaked, but a client that has to be caught by the server is a client
 * making the wrong assumption.
 *
 * Only reached on a genuinely cold start: every change writes the mirror, so a
 * returning sharer reads their real mode off disk. The cost of being wrong here
 * is one tick of the map answered by the private query, which is read-only.
 */
export async function getCachedLocationSharing(): Promise<LocationSharing> {
  if (state.settings) return state.settings.location_sharing;
  try {
    const stored = await AsyncStorage.getItem(SHARING_STORAGE);
    if (stored === 'live' || stored === 'approximate' || stored === 'paused') return stored;
  } catch {
    // Fall through to the default.
  }
  return 'paused';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrivacySettings(): State {
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * The sharing mode, for screens that only read it. `null` means "not known
 * yet" — a caller that draws the owner's position should wait rather than
 * assume, because assuming 'live' for one frame draws the precise point an
 * approximate sharer asked us not to show.
 *
 * No fetch: the privacy screen writes every change into this store and mirrors
 * it to disk, so reading the mirror is enough and costs nothing on a screen
 * that is already polling.
 */
export function useLocationSharing(): LocationSharing | null {
  const { settings } = usePrivacySettings();
  const [mirrored, setMirrored] = useState<LocationSharing | null>(null);

  useEffect(() => {
    let active = true;
    getCachedLocationSharing()
      .then((mode) => { if (active) setMirrored(mode); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return settings?.location_sharing ?? mirrored;
}

/**
 * Drop the signed-in user's settings, in memory and on disk.
 *
 * Both halves matter. The in-memory copy would otherwise be inherited by the
 * next account to sign in on this device, and the disk mirror is read by the
 * background location task — so a previous user's "paused" (or worse, "live")
 * would govern the next user's location reporting until they happened to open
 * the privacy screen.
 */
export async function resetPrivacy(): Promise<void> {
  setState({ settings: null });
  forgetSharingSession();
  try {
    await AsyncStorage.removeItem(SHARING_STORAGE);
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
    // Ours: the server minted this in response to a request this run made, so
    // the startup call may present it and be told to leave us alone. See
    // services/sharingSession.ts.
    rememberSharingSession(data.sharing_session, true);
  } catch (e) {
    if (previous) setState({ settings: previous });
    throw e;
  }
}
