import { AppState } from 'react-native';

import { api } from './api';

// Which run of the app turned location sharing on.
//
// Visibility has no expiry — backgrounding, locking the phone and the
// background location task all leave it alone. What it does not do is outlive
// the app: App Review's list of things that must never check somebody in ends
// with "any previous preference says they were visible", and a sharing mode
// still switched on from yesterday is exactly that preference.
//
// The mechanism is one value that is deliberately hard to keep. The server
// mints a token when the user goes visible; this module holds it in a module
// variable — never AsyncStorage, never SecureStore, never anywhere that
// survives the process — and hands it back once at startup. A run that comes
// back without it is a run that did not choose anything, and the server ends
// the previous session.
//
// So the storage rule here is not an implementation detail, it is the feature:
//
//     persisting this token would rebuild the preference it exists to prevent
//
// A token rather than a bare "pause me" call, because startup races the user.
// Somebody who opens the app and immediately taps Live has a fresh token by
// the time this lands; it matches, and the server leaves them alone.

/** In memory only. Cleared by the process ending, which is the point. */
let sessionToken: string | null = null;

/** Fired once per process. Not a "have we paused yet" flag — a "has this run
 * already told the server what it was carrying" flag. */
let reported = false;

/**
 * Remember a session token, if it is ours to remember.
 *
 * `owned` is the whole of the rule, and it is a distinction about provenance
 * rather than timing:
 *
 *   * a token *read back* from the server belongs to whichever run set it,
 *     which on a fresh launch is not this one. Remembering it would let the
 *     startup call present a token that matches, and a match means "leave this
 *     visibility alone" — the user would silently stay visible from last time.
 *     This is not a rare race: React runs child effects before parent ones, so
 *     a screen with `refreshPrivacy()` on mount lands before the root layout's
 *     startup effect, every time.
 *
 *   * a token in the response to *our own* PATCH was minted by this run's
 *     request, so it is ours. Recording it is what lets a startup call that
 *     lands late present a matching token and leave the tap alone.
 *
 * A null is always accepted whatever the provenance: it can only mean "not
 * visible", which is the safe direction.
 */
export function rememberSharingSession(
  token: string | null | undefined,
  owned = false,
): void {
  if (!token) {
    sessionToken = null;
    return;
  }
  if (!owned) return;
  sessionToken = token;
}

/** For sign-out, which drops everything else about the account too. */
export function forgetSharingSession(): void {
  sessionToken = null;
  reported = false;
}

/** Testing seam. Nothing in the app reads this. */
export function currentSharingSession(): string | null {
  return sessionToken;
}

/**
 * Tell the server what this run is carrying, once, at startup.
 *
 * Ends a visibility that belongs to a previous run — a cold launch, a relaunch
 * after the OS killed us, a device restart — and does nothing at all when the
 * token matches or there was no visibility to end.
 *
 * Two guards, and both matter:
 *
 *   * Once per process, so a re-render or a second mount cannot turn this into
 *     a loop that fights the user's taps.
 *   * Foreground only. iOS relaunches the app in the background to deliver
 *     location updates, and that spins up a fresh JS context with an empty
 *     module scope — indistinguishable from a cold launch from in here. Ending
 *     the session there would make backgrounding a check-out, which is
 *     precisely what we were asked not to build. `AppState` is the one thing
 *     that tells the two apart.
 *
 * Never throws. A failure leaves the previous session standing until the next
 * launch, which is a known gap rather than a silent one — see the report.
 */
export async function endStaleSharingSession(): Promise<void> {
  if (reported) return;
  if (AppState.currentState !== 'active') return;
  reported = true;

  try {
    const { data } = await api.post<{ location_sharing?: string }>(
      '/api/proximity/sharing-session/end/', { session: sessionToken },
    );
    if (data?.location_sharing === 'paused') sessionToken = null;
  } catch {
    // Retried on the next launch, not on a timer: a retry loop here would be
    // a background process capable of pausing somebody mid-session. The user
    // stays visible for this run — the server never heard otherwise — and the
    // next launch ends it.
    reported = false;
  }
}
