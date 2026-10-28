/** Where the app finds the Approx API: chosen per build, never by editing this file.
 *
 * Set `EXPO_PUBLIC_API_URL` to point a build at another backend:
 *   - locally, in `.env.local` (gitignored), e.g. `http://192.168.1.20:8000` for a dev server on
 *     your network, or `http://10.0.2.2:8000` from the Android emulator;
 *   - for an EAS build, in that build profile's `env` in `eas.json`.
 *
 * Unset, every build talks to production. That is the only safe default: a release that forgot the
 * variable still reaches the real API, and nothing committed can make it reach someone's laptop.
 * A release build also refuses plain http and local or private-network hosts outright, so a
 * development URL that leaks into one fails on launch instead of shipping.
 */
export const PRODUCTION_API_URL = 'https://api.getapprox.com';

// HTTP(S), ASCII DNS name or IPv4 host, optional port and path; no userinfo, query or fragment.
// Deliberately narrower than a URL parser, for the reason given in services/routing.ts.
const API_URL_PATTERN = /^(https?):\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?(\/[^?#\s\\]*)?$/i;

function isLocalHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return true;
  const octets = hostname.split('.');
  if (octets.length !== 4 || !octets.every(part => /^[0-9]{1,3}$/.test(part))) return false;
  const [a, b] = octets.map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The API base URL for `raw` (the value of EXPO_PUBLIC_API_URL), without a trailing slash.
 * Throws for a malformed value in any build, and for http or a local host in a release build. */
export function resolveApiUrl(raw: string | undefined, isDevelopment: boolean): string {
  const value = raw?.trim();
  if (!value) return PRODUCTION_API_URL;

  const match = value.match(API_URL_PATTERN);
  const hostname = match?.[2].toLowerCase() ?? '';
  const port = match?.[3];
  if (!match
    || !hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || (port !== undefined && (Number(port) < 1 || Number(port) > 65535))) {
    throw new Error(`EXPO_PUBLIC_API_URL must be an http(s) address with an optional port and path, not "${value}".`);
  }

  const scheme = match[1].toLowerCase();
  if (!isDevelopment && scheme !== 'https') {
    throw new Error(`EXPO_PUBLIC_API_URL must use https in a release build, not "${value}".`);
  }
  if (!isDevelopment && isLocalHost(hostname)) {
    throw new Error(`EXPO_PUBLIC_API_URL cannot point a release build at a local or private-network host ("${value}").`);
  }

  const path = (match[4] ?? '').replace(/\/+$/, '');
  return `${scheme}://${hostname}${port ? `:${port}` : ''}${path}`;
}

// Expo inlines EXPO_PUBLIC_* values at build time only for direct `process.env.NAME` access.
export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, __DEV__);
