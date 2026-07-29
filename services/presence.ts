import { AppState, type AppStateStatus } from 'react-native';

import { api } from './api';

// Presence, read and reported.
//
// There is no polling loop here on purpose. The app already talks to the
// server constantly while it is open — the nav bar's badge polls run on every
// authenticated screen, and the map adds its own 10s tick — so presence rides
// that traffic via a request header rather than adding a second loop and a
// second battery cost to a screen people leave open.
//
// The header matters as much as the heartbeat. `backgroundLocation` keeps
// hitting the API every 30s with the app closed, so "any authenticated request
// means online" would leave those users pinned online indefinitely. Only a
// foregrounded app sets the header; the background task never does.

/** What the API sends when it is willing to say. Absent entirely when hidden —
 * a missing `presence` key means "render no indicator", never "offline". */
export interface Presence {
  is_online: boolean;
  /** ISO timestamp, and only ever set when offline. */
  last_seen: string | null;
}

/** Coarse buckets. The API never carries a numeric speed or a bearing. */
export type MotionClass = 'stationary' | 'moving' | 'fast';

export const PRESENCE_HEADER = 'X-Aura-Presence';

// ─── App state ────────────────────────────────────────────────────────────────
let appState: AppStateStatus = AppState.currentState;

AppState.addEventListener('change', (next) => {
  const wasActive = appState === 'active';
  appState = next;

  // One explicit beacon on the way out, so closing the app drops you offline
  // now rather than when the server's window happens to lapse. Fire-and-forget:
  // the app is being suspended, so there is nobody left to handle a failure,
  // and the server-side window is the backstop if it never lands.
  if (wasActive && next !== 'active') {
    api
      .get('/api/users/me/', { headers: { [PRESENCE_HEADER]: 'background' } })
      .catch(() => {});
  }
});

/** Whether requests should currently claim presence. Read by the api request
 * interceptor. */
export function isForeground(): boolean {
  return appState === 'active';
}

// ─── Rendering ────────────────────────────────────────────────────────────────
/** "just now", "4m", "3h", "6d" — deliberately coarse. */
export function formatLastSeen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;

  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return 'a while ago';
}

/**
 * The screen-reader label for a presence state.
 *
 * Colour is never the only cue — the dot is filled when online and a hollow
 * ring when offline — but shape is no use to a screen reader either, so the
 * state is always spelled out in words too.
 */
export function presenceLabel(presence: Presence | null | undefined): string | null {
  if (!presence) return null;
  if (presence.is_online) return 'Online';
  const ago = formatLastSeen(presence.last_seen);
  return ago ? `Offline, last seen ${ago}` : 'Offline';
}

/** The short visible text next to a name, where a row has space for it. */
export function presenceText(presence: Presence | null | undefined): string | null {
  if (!presence) return null;
  if (presence.is_online) return 'Online';
  return formatLastSeen(presence.last_seen);
}

/** Screen-reader wording for motion. The trail itself is decorative and hidden
 * from assistive tech, so the state it conveys has to be said somewhere. */
export function motionLabel(motion: MotionClass | null | undefined): string | null {
  if (motion === 'fast') return 'moving fast';
  if (motion === 'moving') return 'on the move';
  return null;
}
