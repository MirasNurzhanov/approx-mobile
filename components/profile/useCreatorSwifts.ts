import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { fetchCreatorSwifts } from '@/services/swiftCreator';
import type { Swift } from '@/services/swifts';

/** No shared cache: leaving a profile invalidates every in-flight page. */
export function useCreatorSwifts(creatorId: number, enabled: boolean, limit: number, refreshKey = 0) {
  const [items, setItems] = useState<Swift[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [settled, setSettled] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const nextOffset = useRef(0);
  const exhausted = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || !Number.isInteger(creatorId) || creatorId < 1) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    busy.current = true;
    setLoading(true);
    setLoadingMore(false);
    nextOffset.current = 0;
    exhausted.current = false;
    setItems([]);
    setCount(0);
    setError(null);
    setUnavailable(false);
    await fetchCreatorSwifts(creatorId, { limit, signal: controller.signal }).then((page) => {
      if (current !== generation.current) return;
      nextOffset.current = page.results.length;
      exhausted.current = page.results.length === 0 || nextOffset.current >= page.count;
      setItems(page.results);
      setCount(page.count);
    }).catch((cause: unknown) => {
      if (current !== generation.current) return;
      const status = (cause as { response?: { status?: number } })?.response?.status;
      setUnavailable(status === 403 || status === 404);
      setError(status === 403 || status === 404
        ? 'These Swifts are no longer available.' : 'Could not load Swifts. Try again.');
    }).finally(() => {
      if (current !== generation.current) return;
      busy.current = false;
      setLoading(false);
      setSettled(true);
    });
  }, [creatorId, enabled, limit]);

  useFocusEffect(useCallback(() => {
    // A parent pull-to-refresh also revalidates the gallery.
    void refreshKey;
    void refresh();
    return () => {
      generation.current += 1;
      request.current?.abort();
      busy.current = false;
      setLoading(false);
      setLoadingMore(false);
      setItems([]);
      setCount(0);
      setSettled(false);
    };
  }, [refresh, refreshKey]));

  const loadMore = useCallback(async () => {
    if (!enabled || busy.current || unavailable || exhausted.current || nextOffset.current >= count) return;
    const offset = nextOffset.current;
    const current = generation.current;
    const controller = new AbortController();
    request.current = controller;
    busy.current = true;
    setLoadingMore(true);
    setError(null);
    await fetchCreatorSwifts(creatorId, { offset, limit, signal: controller.signal }).then((page) => {
      if (current !== generation.current) return;
      // Advance by rows consumed, even when a concurrent upload shifted an already-seen row into this page.
      nextOffset.current = offset + page.results.length;
      exhausted.current = page.results.length === 0 || nextOffset.current >= page.count;
      setItems((previous) => {
        const known = new Set(previous.map((item) => item.id));
        return [...previous, ...page.results.filter((item) => !known.has(item.id))];
      });
      setCount(page.count);
    }).catch((cause: unknown) => {
      if (current !== generation.current) return;
      const status = (cause as { response?: { status?: number } })?.response?.status;
      if (status === 403 || status === 404) {
        setItems([]);
        setCount(0);
        setUnavailable(true);
        setError('These Swifts are no longer available.');
      } else setError('Could not load more Swifts. Try again.');
    }).finally(() => {
      if (current !== generation.current) return;
      busy.current = false;
      setLoadingMore(false);
    });
  }, [creatorId, enabled, limit, count, unavailable]);

  return { items, count, loading: loading || (enabled && !settled), loadingMore, error, unavailable, refresh, loadMore };
}
