/**
 * Lets another screen tell the profile tab "this changed", without polling.
 *
 * Same shape as services/nearbyRefresh.ts. The profile tab already refetches
 * on every focus (see app/(tabs)/profile.tsx's useFocusEffect), which would
 * eventually show an edit made elsewhere — but "eventually" is a visible flash
 * of the old value for however long that request takes. Edit Profile already
 * has the server's authoritative response the moment a save succeeds; pushing
 * it here paints the profile tab with it immediately; the focus refetch that
 * follows just reconciles.
 */
let _refresh: ((fresh: object) => void) | null = null;

export function registerProfileRefresh(fn: (fresh: object) => void) {
  _refresh = fn;
}

export function pushProfileUpdate(fresh: object) {
  _refresh?.(fresh);
}
