import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';

import { api } from './api';

// Checking in: being visible to people who are not your friends, for this
// session only (App Review 5.1.2(i), second rejection).
//
// Friends see you whenever Ghost Mode is off — across launches and in the
// background — and nothing in this file is about them. Everybody else sees you
// only after you tap Check in on the map, and only until the session ends. The
// server enforces all of it (users.visibility.on_map_q); this module is the
// client half of "ends with the session", and it is the pre-Ghost-Mode
// sharingSession.ts design brought back (see git history, 32226e0^):
//
// The server mints a token when the user checks in. This module holds it in a
// module variable — never AsyncStorage, never SecureStore, never anything that
// survives the process — and presents it once at startup. A run that comes
// back without it did not check in, and the server ends the check-in the
// previous run made. So the storage rule is the feature:
//
//     persisting this token would rebuild the preference it exists to prevent
//
// A token rather than a bare "check me out" call because startup races the
// user: somebody who opens the app and taps Check in at once has a fresh token
// by the time the startup call lands, it matches, and the server leaves them be.
//
// Only a token from the response to *our own* POST is ever held. GET /me and
// GET /privacy never carry it, so a fresh launch cannot read one back and
// present it as its own — which is how the old version's worst bug happened.

export interface CheckInState {
  checkedIn: boolean;
  /** ISO time the server will end it regardless (the eight-hour cap). */
  expiresAt: string | null;
}

interface Payload {
  checked_in?: boolean;
  check_in_expires_at?: string | null;
  session?: string;
}

/** In memory only. Cleared by the process ending, which is the point. */
let sessionToken: string | null = null;
/** Once per process: "has this run told the server what it was carrying". */
let reported = false;

let state: CheckInState = { checkedIn: false, expiresAt: null };
const listeners = new Set<() => void>();
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function setState(next: CheckInState) {
  state = next;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  // The server stops publishing at the cap whether or not we hear about it;
  // this only keeps the button honest about that.
  if (next.checkedIn && next.expiresAt) {
    const ms = Date.parse(next.expiresAt) - Date.now();
    if (ms <= 0) {
      state = { checkedIn: false, expiresAt: null };
      sessionToken = null;
    } else {
      expiryTimer = setTimeout(() => setState({ checkedIn: false, expiresAt: null }), Math.min(ms, 2 ** 31 - 1));
    }
  }
  listeners.forEach(listener => listener());
}

function apply(data: Payload | undefined) {
  const checkedIn = !!data?.checked_in;
  if (!checkedIn) sessionToken = null;
  setState({ checkedIn, expiresAt: checkedIn ? data?.check_in_expires_at ?? null : null });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCheckIn(): CheckInState {
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * Check in. **Only ever called from the Check in button** — never on launch,
 * on a permission grant, on a location fix or from a saved preference; that is
 * the whole of what App Review asked for, and noAutomaticVisibility.test.ts
 * holds every caller to it. Throws on failure (Private, Ghost Mode, offline),
 * with the server's message on the error.
 */
export async function checkIn(): Promise<CheckInState> {
  const { data } = await api.post<Payload>('/api/proximity/check-in/');
  // Ours: minted by this run's own request.
  sessionToken = data?.session ?? null;
  apply(data);
  return state;
}

/** Stop being visible to non-friends now. Friends are unaffected. */
export async function checkOut(): Promise<CheckInState> {
  const { data } = await api.post<Payload>('/api/proximity/check-out/');
  apply(data);
  return state;
}

/**
 * Tell the server what this run is carrying, once, at startup.
 *
 * Ends a check-in that belongs to a previous run — a cold launch, a relaunch
 * after the OS killed us, a device restart — and leaves this run's alone.
 *
 * Foreground only. iOS relaunches the app in the background to deliver
 * location updates, into a fresh JS context with an empty module scope that is
 * indistinguishable from a cold launch from in here. Ending the check-in there
 * would make backgrounding a check-out. `AppState` is what tells them apart.
 *
 * Never throws. A failure is retried on the next launch, not on a timer — a
 * retry loop would be a background process able to check somebody out
 * mid-session; the eight-hour cap on the server is the backstop.
 */
export async function endStaleCheckIn(): Promise<void> {
  if (reported) return;
  if (AppState.currentState !== 'active') return;
  reported = true;
  try {
    const { data } = await api.post<Payload>('/api/proximity/check-in/end-stale/', { session: sessionToken });
    apply(data);
  } catch {
    reported = false;
  }
}

/** The server ended it (Private, Ghost Mode) — say so locally without a call. */
export function markCheckedOut(): void {
  sessionToken = null;
  setState({ checkedIn: false, expiresAt: null });
}

/** For sign-out, which drops everything else about the account too. */
export function forgetCheckIn(): void {
  sessionToken = null;
  reported = false;
  setState({ checkedIn: false, expiresAt: null });
}

/** Testing seam. Nothing in the app reads this. */
export function currentCheckInSession(): string | null {
  return sessionToken;
}
