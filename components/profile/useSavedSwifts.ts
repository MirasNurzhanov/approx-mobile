import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { fetchSavedSwifts } from '@/services/swifts';
import type { Swift } from '@/services/swifts';

/**
 * The viewer's own shortlist.
 *
 * Deliberately its own hook rather than a flag on `useCreatorSwifts`. That one
 * is parameterised by *whose* Swifts to show and carries the whole visibility
 * dance that goes with looking at someone else's profile — the 403/404 that
 * means "not available to you", the creator id validation. A shortlist has no
 * such question: it is always the signed-in user's, and it is never visible to
 * anybody else, so there is no gate to model and folding the two together
 * would mean carrying that gate on a screen where it cannot apply.
 *
 * `enabled` exists so the request is not made until the Saved tab is actually
 * looked at. Someone who never opens it never fetches it.
 *
 * No de-duplication here, and that is not an oversight. The server holds one
 * row per (swift, viewer) behind a unique constraint, so a list of saves
 * cannot contain the same Swift twice — a `Set` in the client would be
 * defending against a state the database does not allow. `loadMore` still
 * filters by id, but for a different reason: a save made between two page
 * requests shifts the window, and an already-seen row can arrive again on the
 * next page. That is paging drift, not duplication.
 */
export function useSavedSwifts(enabled: boolean, limit: number, refreshKey = 0) {
  const [items, setItems] = useState<Swift[]>([]);
  const [count, setCount] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Whether a fetch has ever *finished*, successfully or not. */
  const [settled, setSettled] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const nextOffset = useRef(0);
  const exhausted = useRef(false);

  /**
   * Loading covers the gap before the first fetch has even started.
   *
   * `useFocusEffect` runs *after* the commit, so the render in which this hook
   * first becomes enabled happens with no request in flight and no items — and
   * a screen that keys its empty state off `items.length === 0` renders
   * "Nothing saved yet" for that frame, to a user who has saved plenty. The
   * flash is short and completely wrong, which is the worst combination.
   *
   * `useState(enabled)` is what `useCreatorSwifts` does and it is not enough
   * here: that hook is enabled from mount, while this one is switched on later
   * by a tab, and a `useState` initialiser only runs once. So the answer is
   * derived rather than stored — enabled, and nothing has come back yet.
   */
  const loading = fetching || (enabled && !settled);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const current = ++generation.current;
    busy.current = true;
    setFetching(true);
    setLoadingMore(false);
    nextOffset.current = 0;
    exhausted.current = false;
    setError(null);
    try {
      const page = await fetchSavedSwifts(limit, 0);
      if (current !== generation.current) return;
      nextOffset.current = page.results.length;
      exhausted.current = page.results.length === 0 || nextOffset.current >= page.count;
      setItems(page.results);
      setCount(page.count);
    } catch {
      if (current !== generation.current) return;
      setError('Could not load saved Swifts. Try again.');
    } finally {
      if (current === generation.current) {
        busy.current = false;
        setFetching(false);
        setSettled(true);
      }
    }
  }, [enabled, limit]);

  useFocusEffect(useCallback(() => {
    // Revalidated on focus so a Swift saved from the feed is already here by
    // the time the profile is opened, and one un-saved elsewhere is gone.
    void refreshKey;
    void refresh();
    return () => {
      generation.current += 1;
      // Released here as well as in `refresh`'s `finally`, which skips it when
      // its generation has been superseded. Without this a request still in
      // flight when the screen blurs leaves the flag stuck on, and `loadMore`
      // — the one caller that reads it — is refused until something else
      // happens to clear it.
      busy.current = false;
    };
  }, [refresh, refreshKey]));

  const loadMore = useCallback(async () => {
    if (!enabled || busy.current || exhausted.current || nextOffset.current >= count) return;
    const offset = nextOffset.current;
    const current = generation.current;
    busy.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchSavedSwifts(limit, offset);
      if (current !== generation.current) return;
      nextOffset.current = offset + page.results.length;
      exhausted.current = page.results.length === 0 || nextOffset.current >= page.count;
      setItems((previous) => {
        const known = new Set(previous.map((item) => item.id));
        return [...previous, ...page.results.filter((item) => !known.has(item.id))];
      });
      setCount(page.count);
    } catch {
      if (current !== generation.current) return;
      setError('Could not load more saved Swifts. Try again.');
    } finally {
      if (current === generation.current) {
        busy.current = false;
        setLoadingMore(false);
      }
    }
  }, [enabled, limit, count]);

  return { items, count, loading, loadingMore, error, refresh, loadMore };
}
