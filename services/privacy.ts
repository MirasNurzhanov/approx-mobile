import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { api } from './api';

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
    AsyncStorage.setItem(SHARING_STORAGE, next.settings.location_sharing).catch(() => {});
  }
  listeners.forEach((l) => l());
}

/** The sharing mode, readable from a background task. Defaults to 'live',
 * matching a brand-new account that has never opened the privacy screen. */
export async function getCachedLocationSharing(): Promise<LocationSharing> {
  if (state.settings) return state.settings.location_sharing;
  try {
    const stored = await AsyncStorage.getItem(SHARING_STORAGE);
    if (stored === 'live' || stored === 'approximate' || stored === 'paused') return stored;
  } catch {
    // Fall through to the default.
  }
  return 'live';
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
  } catch (e) {
    if (previous) setState({ settings: previous });
    throw e;
  }
}
