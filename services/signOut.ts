import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

import { beginSessionEnd, BASE_URL } from './api';
import { stopBackgroundLocationUpdates } from './backgroundLocation';
import { resetAlertsCount } from './alerts';
import { resetBlocked } from './blocked';
import { resetOwnMotion } from './ownMotion';
import { resetPrivacy } from './privacy';
import { resetArchive } from './stories';

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
 *
 * `aura:attestation:iosKeyId` is the non-obvious one. It looks device-scoped,
 * but the server registers attested keys per user (`unique_together
 * ('user', 'key_id')`), so leaving it behind means the next account's quest
 * photo proofs are checked against a key that was never registered to them and
 * get refused.
 */
const ACCOUNT_SCOPED_KEYS = [
  'access_token',
  'refresh_token',
  'chat_last_seen',
  'last_zone_notified',
  // The on-device activity feed is gone (alerts come from the server now), but
  // devices that ran an older build still hold its keys — and they hold the
  // previous account's alerts. Kept in the list so signing out clears them.
  'aura:activity:feed',
  'aura:activity:seenNearby',
  'aura:activity:storyReactions',
  'aura:attestation:iosKeyId',
];

/** Server round trip gets this long before we give up and finish locally.
 * Sign-out must never appear to hang because the network is down. */
const REVOKE_TIMEOUT_MS = 4000;

/** True when the session is settled and nothing needs retrying later. */
async function revokeRefreshToken(refresh: string, accessToken: string | null): Promise<boolean> {
  try {
    // Bare axios, not the `api` instance: its response interceptor treats a 401
    // as "refresh and retry", which during sign-out would resurrect the very
    // session we are tearing down.
    await axios.post(
      `${BASE_URL}/api/users/logout/`,
      { refresh },
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

  const [accessToken, refresh] = await Promise.all([
    AsyncStorage.getItem('access_token').catch(() => null),
    AsyncStorage.getItem('refresh_token').catch(() => null),
  ]);

  // Server-side revocation, plus push-token unregistration, which the logout
  // endpoint does unconditionally so a signed-out device stops being
  // addressable even when the token it sent was already expired.
  if (refresh) {
    const revoked = await revokeRefreshToken(refresh, accessToken);
    if (!revoked) {
      // Queued, not silently dropped: the token stays valid until it expires,
      // so it is worth one more attempt on the next launch.
      await AsyncStorage.setItem(PENDING_REVOCATION, refresh).catch(() => {});
    }
  }

  // OS-level tracking. This one outlives the JS context — the map's watcher
  // dies when the screen unmounts, but a registered background task keeps
  // reporting location after sign-out until it is explicitly stopped.
  await stopBackgroundLocationUpdates().catch(() => {});

  await AsyncStorage.multiRemove(ACCOUNT_SCOPED_KEYS).catch(() => {});

  // In-memory stores. These survive navigation, so without this the next
  // account inherits the previous user's privacy settings, block list and
  // story archive.
  await resetPrivacy().catch(() => {});
  await resetArchive().catch(() => {});
  resetBlocked();
  resetAlertsCount();
  // Otherwise a user who signed out mid-journey leaves the next session
  // starting in "driving" — with nearby prompts quietly suppressed for someone
  // who is sitting still.
  resetOwnMotion();
}

/**
 * Retry revocations that failed while offline. Safe to call on every launch:
 * it is a no-op when nothing is queued, and it clears the queue whether the
 * token is revoked or simply expired past the point of mattering.
 */
export async function flushPendingRevocations(): Promise<void> {
  const pending = await AsyncStorage.getItem(PENDING_REVOCATION).catch(() => null);
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
      await AsyncStorage.removeItem(PENDING_REVOCATION).catch(() => {});
    }
    return;
  }

  const done = await revokeRefreshToken(rotated, access);
  if (done) await AsyncStorage.removeItem(PENDING_REVOCATION).catch(() => {});
}
