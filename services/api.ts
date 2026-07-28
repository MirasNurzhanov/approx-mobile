import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { router } from 'expo-router';

export const BASE_URL = 'https://project-x-production-3261.up.railway.app';

/** Kept here rather than imported from ./presence: that module imports this
 * one, and the interceptor below needs the name at module scope. */
const PRESENCE_HEADER = 'X-Aura-Presence';

export const api = axios.create({
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

api.interceptors.request.use(async (config) => {
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
        await AsyncStorage.multiRemove(['access_token', 'refresh_token']);
        onAuthFailure?.();
        router.replace('/');
      }
    } catch (e) {
      console.log('[Auth] interceptor error:', e);
    }
    return Promise.reject(error);
  }
);
