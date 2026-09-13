import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { create as createAxios } from 'axios';
import * as Application from 'expo-application';
import { router } from 'expo-router';

import { API_URL } from './apiUrl';

/** The backend this build talks to. Set per build with EXPO_PUBLIC_API_URL; see services/apiUrl.ts. */
export const BASE_URL = API_URL;

/** Kept here rather than imported from ./presence: that module imports this
 * one, and the interceptor below needs the name at module scope. */
const PRESENCE_HEADER = 'X-Approx-Presence';

export const CLIENT_BUILD_HEADER = 'X-Approx-Build';

/**
 * Which build of the app this is, read from the binary rather than written
 * down here.
 *
 * `Application.nativeBuildVersion` is iOS's `CFBundleVersion` and Android's
 * `versionCode` — the number the store actually shipped. This project uses EAS
 * remote version management (`appVersionSource: "remote"` with
 * `autoIncrement`), so that number is assigned at build time and a constant in
 * this file could only ever be a guess that drifts. Build 33 will report 33
 * with no source change.
 *
 * It is what tells the server that this client understands a rule the previous
 * one did not — today, the Terms agreement on the sign-in screen, which build
 * 31 has never heard of. See `users/terms.py:terms_enforced_for`.
 *
 * ## Why `null` is a real answer
 *
 * Returns null when the value is absent or is not a plain positive integer:
 * Expo Go, web, a simulator run before the field is populated, or a
 * `CFBundleVersion` in dotted form. **It is never defaulted to a number.**
 * Guessing forward would claim compliance the bundle cannot deliver; guessing
 * backward would invent a build that does not exist. The caller omits the
 * header entirely instead, and the server's legacy path — which already
 * distinguishes "did not say" from any number — handles it.
 *
 * Read on each call rather than memoised at module scope: it is a cached
 * native constant, so the read is free, and a module-scope capture would make
 * the value impossible to exercise in tests without resetting the registry.
 */
export function clientBuild(): number | null {
  const raw = Application.nativeBuildVersion;
  // Strict: EAS assigns integers on both platforms. Anything else — a dotted
  // CFBundleVersion someone sets by hand, an empty string, null — is a build
  // this mechanism cannot speak for, and saying nothing is the honest answer.
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Headers every request carries, whichever client sent it.
 *
 * The `api` instance below applies these through its interceptor. This export
 * is for the calls that deliberately use bare `axios` because they run
 * *before* a session exists — sign-in — so those get the same treatment
 * without each call site knowing the header name.
 *
 * Returns an empty object when the build is unknown. An absent header is the
 * signal, not a placeholder value.
 */
export function clientHeaders(): Record<string, string> {
  const build = clientBuild();
  return build === null ? {} : { [CLIENT_BUILD_HEADER]: String(build) };
}

export const api = createAxios({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// AuthContext registers a handler so a forced logout here also flips
// isAuthenticated — otherwise app/index.tsx still sees the stale in-memory
// "logged in" state and bounces straight back into the tabs.
let onAuthFailure: (() => void) | null = null;
export function setOnAuthFailure(handler: () => void) {
  onAuthFailure = handler;
}

/**
 * True once the session is over — the user signed out, or a refresh failed
 * past recovery. It is a kill switch for this client, not a flag anyone polls.
 *
 * Without it, signing out spun the app. Screens keep polling while teardown
 * runs, every request 401s the moment the tokens go, and each 401 fell into
 * the block below: clear tokens, notify, `router.replace('/')`. But
 * `app/index.tsx` sends an authenticated user straight back to `/(tabs)/map`,
 * and the map refetches on focus — so a single sign-out became an endless
 * replace → focus → 401 → replace loop that never reached the auth screen.
 */
let sessionEnded = false;

/** Silence this client. Sign-out calls it *before* touching the tokens, so
 * there is nothing left in flight to 401 on the way out. */
export function beginSessionEnd() {
  sessionEnded = true;
}

/** Re-arm after a successful login. */
export function resumeSession() {
  sessionEnded = false;
}

/** Rejection used for requests made after the session ended. Carries no
 * `response`, so the usual `e?.response?.status` logging stays quiet. */
export class SessionEndedError extends Error {
  constructor() {
    super('Request made after sign-out');
    this.name = 'SessionEndedError';
  }
}

api.interceptors.request.use(async (config) => {
  // Cheaper and quieter than letting it round-trip to a guaranteed 401.
  if (sessionEnded) throw new SessionEndedError();

  const token = await AsyncStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Presence rides existing traffic rather than a loop of its own. Only a
  // foregrounded app claims it: the background location task keeps calling the
  // API every 30s with the app closed, and counting that would leave those
  // users showing as online indefinitely.
  //
  // Required lazily — services/presence imports this module, and pulling it in
  // at the top would be a cycle. An explicit header already set by the caller
  // (the going-to-background beacon) is left alone.
  // Every authenticated request identifies its build. Set here rather than per
  // call site, for the same reason presence is done below. Omitted rather than
  // guessed when the binary does not report one — see `clientBuild`.
  const build = clientBuild();
  if (build !== null) config.headers[CLIENT_BUILD_HEADER] = String(build);

  if (config.headers[PRESENCE_HEADER] === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isForeground } = require('./presence') as typeof import('./presence');
    if (isForeground()) config.headers[PRESENCE_HEADER] = 'foreground';
  }
  return config;
});

// The backend rotates refresh tokens and blacklists the old one
// (ROTATE_REFRESH_TOKENS + BLACKLIST_AFTER_ROTATION), so concurrent 401s must
// share one refresh call — a second refresh with the same token would 401 and
// log the user out.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = await AsyncStorage.getItem('refresh_token');
  if (!refresh) return null;
  try {
    // Bare axios: the api instance's interceptors must not run on this call.
    const { data } = await axios.post(`${BASE_URL}/api/users/token/refresh/`, { refresh });
    await AsyncStorage.setItem('access_token', data.access);
    if (data.refresh) await AsyncStorage.setItem('refresh_token', data.refresh);
    return data.access as string;
  } catch (e: any) {
    console.log('[Auth] token refresh failed:', e?.response?.status);
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    try {
      const original = error.config;
      // Nothing to recover: the tokens are already gone by design. Anything
      // still landing here is a straggler from before the switch flipped.
      if (sessionEnded) return Promise.reject(error);

      if (error.response?.status === 401 && original && !original._retried) {
        original._retried = true;
        if (!refreshPromise) {
          refreshPromise = refreshAccessToken().finally(() => {
            refreshPromise = null;
          });
        }
        const token = await refreshPromise;
        if (token) {
          // The request interceptor re-reads the new token from storage on retry.
          return api(original);
        }
        // Re-checked after the await, not just at the top of the handler:
        // concurrent 401s all queue on the same refreshPromise and resume
        // together, so the earlier check is stale by the time they land here.
        // Only the first one through tears the session down — every extra pass
        // would issue its own replace, which is what turned one dead session
        // into a navigation loop.
        if (sessionEnded) return Promise.reject(error);
        beginSessionEnd();

        await AsyncStorage.multiRemove(['access_token', 'refresh_token']);
        // The handler (AuthContext) owns the teardown *and* the navigation.
        // Falling back to a bare replace only when nothing is registered —
        // a 401 before the provider mounts still has to leave the tabs.
        if (onAuthFailure) onAuthFailure();
        else router.replace('/');
      }
    } catch (e) {
      console.log('[Auth] interceptor error:', e);
    }
    return Promise.reject(error);
  }
);
