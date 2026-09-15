import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { tokenStore } from './tokenStore';

import { beginSessionEnd, BASE_URL } from './api';
import { stopBackgroundLocationUpdates } from './backgroundLocation';
import { resetAlertsCount } from './alerts';
import { resetBlocked } from './blocked';
import { getInstallId } from './device';
import { resetOwnMotion } from './ownMotion';
import { resetPositionSmoothing } from './positionSmoothing';
import { clearRouteCache } from './routing';
import { resetTravelCalibration } from './travelCalibration';
import { resetPinnedPlaces } from './pinnedPlaces';
import { resetNotificationPrefs } from './notificationPrefs';
import { resetLocationDisclosure } from './locationDisclosure';
import { resetPrivacy } from './privacy';
import { clearGoogleSession } from './socialAuth';
import { resetArchive } from './stories';
import { resetTerms } from './terms';
import { resetRegionCache } from './zoneArea';

// Signing out, properly.
//
// The old implementation removed two AsyncStorage keys and navigated. That
// leaves the refresh token valid on the server for its full seven days, the
// device still registered for push, the OS still tracking location, and the
// next account to sign in inheriting the previous user's cached state.

/** A refresh token we could not revoke because the network was down. Retried
 * on the next launch — see `flushPendingRevocations`. */
const PENDING_REVOCATION = 'aura:auth:pendingRevocation';

/**
 * Storage that belongs to *the signed-in account* and must not survive them.
 *
 * Deliberately not everything: `onboarding_seen` and the `aura:pref:` keys
 * describe the device and the person holding it, not the account, and wiping
 * them would re-run onboarding and silently reset the background-location
 * choice for the next sign-in.
 */
const ACCOUNT_SCOPED_KEYS = [
  'access_token',
  'refresh_token',
  'chat_last_seen',
  'last_zone_notified',
  // The feature tutorial (services/tutorial.ts) is deliberately NOT here —
  // its keys are namespaced by user id, not flat flags, so it does not need
  // wiping on sign-out to behave correctly for the next account. Clearing it
  // here would undo that: the same account would see it again every time
  // they logged back in.
  // The on-device activity feed is gone (alerts come from the server now), but
  // devices that ran an older build still hold its keys — and they hold the
  // previous account's alerts. Kept in the list so signing out clears them.
  'aura:activity:feed',
  'aura:activity:seenNearby',
  'aura:activity:storyReactions',
  // Device attestation went out with quests. Nothing writes this any more, but
  // devices upgrading from a build that had it still hold the previous
  // account's key — clear it rather than leave it stranded.
  'aura:attestation:iosKeyId',
];

/** Server round trip gets this long before we give up and finish locally.
 * Sign-out must never appear to hang because the network is down. */
const REVOKE_TIMEOUT_MS = 4000;

/** True when the session is settled and nothing needs retrying later. */
async function revokeRefreshToken(refresh: string, accessToken: string | null): Promise<boolean> {
  try {
    // Which device is leaving. Without it the server can only clear the
    // account-wide push column, which on an account signed in elsewhere would
    // read as "silence this account" — signing out of a phone would stop the
    // tablet's notifications too. Best-effort: an id that cannot be read still
    // signs out, it just leaves this device's row to be corrected on its next
    // registration.
    const installId = await getInstallId().catch(() => '');

    // Bare axios, not the `api` instance: its response interceptor treats a 401
    // as "refresh and retry", which during sign-out would resurrect the very
    // session we are tearing down.
    await axios.post(
      `${BASE_URL}/api/users/logout/`,
      { refresh, install_id: installId },
      {
        timeout: REVOKE_TIMEOUT_MS,
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      },
    );
    return true;
  } catch (e: any) {
    const status = e?.response?.status;
    // 400 is the server saying the token is invalid or already expired — there
    // is nothing left to revoke, so this counts as settled.
    if (status === 400) return true;
    // 401 (our access token expired) and 5xx and transport failures are all
    // "we could not do it *yet*", which is what the retry queue is for.
    return false;
  }
}

/**
 * Tear down the session.
 *
 * Ordered so the irreversible, outward-facing part happens first and the local
 * cleanup always happens: revocation is attempted while we still hold valid
 * credentials, and everything after it runs whether or not it succeeded. Sign
 * out must work offline — a user who cannot reach the server still gets to
 * leave the device in a signed-out state.
 */
export async function performSignOut(): Promise<void> {
  // First, before anything else touches the tokens. Screens poll on timers and
  // refetch on focus; left running, every one of those calls 401s during
  // teardown and drags the api layer's forced-logout path in with it.
  beginSessionEnd();
  // Invalidate coordinate-keyed routes immediately, before any logout awaits.
  clearRouteCache();

  const [accessToken, refresh] = await Promise.all([
    tokenStore.getItem('access_token').catch(() => null),
    tokenStore.getItem('refresh_token').catch(() => null),
  ]);

  // Off the map, before the credentials that could do it are thrown away.
  //
  // Nothing is written to the sharing setting here, and that is deliberate.
  //
  // Sign-out used to pause the account, because visibility had no expiry and
  // somebody who signed out would otherwise stay pinned to wherever they last
  // were forever. Two things changed. A position now expires on its own — the
  // row falls off every map about fifteen minutes after the last report, and
  // this device stops reporting a few lines below — so the stale pin problem
  // solves itself. And Ghost Mode is a *setting* rather than a session state:
  // writing it here would hand the account a choice it never made and greet it
  // ghosted at next sign-in, which is the empty-map complaint this whole change
  // set out to fix.

  // Server-side revocation, plus push-token unregistration, which the logout
  // endpoint does unconditionally so a signed-out device stops being
  // addressable even when the token it sent was already expired.
  if (refresh) {
    const revoked = await revokeRefreshToken(refresh, accessToken);
    if (!revoked) {
      // Queued, not silently dropped: the token stays valid until it expires,
      // so it is worth one more attempt on the next launch.
      await tokenStore.setItem(PENDING_REVOCATION, refresh).catch(() => {});
    }
  }

  // OS-level tracking. This one outlives the JS context — the map's watcher
  // dies when the screen unmounts, but a registered background task keeps
  // reporting location after sign-out until it is explicitly stopped.
  await stopBackgroundLocationUpdates().catch(() => {});

  await AsyncStorage.multiRemove(ACCOUNT_SCOPED_KEYS).catch(() => {});
  let credentialError: unknown;
  try { await tokenStore.clearSession(); }
  catch (error) { credentialError = error; }

  // The Google SDK keeps its own idea of who is signed in, on the far side of
  // AsyncStorage. Left alone, the next tap on the Google button re-signs the
  // same account in with no chooser — which reads as the sign-out having
  // failed, and makes a shared phone impossible to switch accounts on.
  await clearGoogleSession();

  // In-memory stores. These survive navigation, so without this the next
  // account inherits the previous user's privacy settings, block list and
  // story archive.
  await resetPrivacy().catch(() => {});
  // Per install, not per account: the next person to sign in on this device
  // has not been told what being on the map means, and inheriting somebody
  // else's acknowledgement is the one case where they would be published
  // without ever having read it.
  await resetLocationDisclosure().catch(() => {});
  await resetArchive().catch(() => {});
  // Pinned places, in memory and on disk. A pin off a Swift is a coordinate one
  // account was shown after asking for it — see services/pinnedPlaces — and it
  // has no business being on the next account'''s map, or on their phone.
  await resetPinnedPlaces().catch(() => {});
  // How long journeys take *for this person, where they go*. Ratios rather
  // than places, but derived from journeys they asked about — so the next
  // account on this phone starts from the constants, not from these.
  await resetTravelCalibration().catch(() => {});
  // City outlines are public geometry, not private data — but they are keyed
  // to the cities the previous account chose, and the next one should not
  // inherit them.
  await resetRegionCache().catch(() => {});
  resetBlocked();
  resetAlertsCount();
  // Which notifications the previous account wanted is theirs, not the next
  // person's — and the switches would otherwise be drawn from their answers
  // until the new account's own settings were fetched.
  resetNotificationPrefs();
  // Otherwise a user who signed out mid-journey leaves the next session
  // starting in "driving" — with nearby prompts quietly suppressed for someone
  // who is sitting still.
  resetOwnMotion();
  // The last account's position, and the interval still interpolating it. The
  // map's own unmount clears this too, but sign-out can happen from anywhere —
  // and a module-level timer left running is the one piece of this teardown
  // that would keep working after the screen it belongs to is gone.
  resetPositionSmoothing();
  // Whether the *previous* account had agreed to the Terms says nothing about
  // the next one. Leaving a `false` here would walk a new sign-in straight
  // past the gate.
  resetTerms();
  if (credentialError) throw credentialError;
}

/**
 * Retry revocations that failed while offline. Safe to call on every launch:
 * it is a no-op when nothing is queued, and it clears the queue whether the
 * token is revoked or simply expired past the point of mattering.
 */
export async function flushPendingRevocations(): Promise<void> {
  const pending = await tokenStore.getItem(PENDING_REVOCATION).catch(() => null);
  if (!pending) return;

  // The access token that went with this session is long gone, and /logout/
  // requires authentication — so the queued refresh token has to buy a new one
  // first.
  //
  // That exchange is itself most of the revocation: the backend runs with
  // ROTATE_REFRESH_TOKENS and BLACKLIST_AFTER_ROTATION, so the moment this
  // call succeeds the queued token is blacklisted. The logout below then
  // disposes of the replacement it just issued.
  let access: string | null = null;
  let rotated = pending;
  try {
    const { data } = await axios.post(
      `${BASE_URL}/api/users/token/refresh/`,
      { refresh: pending },
      { timeout: REVOKE_TIMEOUT_MS },
    );
    access = data.access ?? null;
    if (data.refresh) rotated = data.refresh;
  } catch (e: any) {
    // 401 means it is already dead — blacklisted, or past its seven days.
    // Either way there is nothing left to revoke.
    if (e?.response?.status === 401) {
      await tokenStore.removeItem(PENDING_REVOCATION).catch(() => {});
    }
    return;
  }

  const done = await revokeRefreshToken(rotated, access);
  if (done) await tokenStore.removeItem(PENDING_REVOCATION).catch(() => {});
}
