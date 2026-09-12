import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { fetchSwiftAnalytics, type AnalyticsDays, type SwiftAnalytics } from '@/services/swiftAnalytics';

type State = {
  key: string;
  data: SwiftAnalytics | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
};

export function useSwiftAnalytics(days: AnalyticsDays, swiftId?: number) {
  const key = `${days}:${swiftId ?? 'all'}`;
  const [state, setState] = useState<State>({
    key, data: null, loading: true, refreshing: false, error: null,
  });
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async (refreshing = false) => {
    const request = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState(previous => ({
      key, data: refreshing && previous.key === key ? previous.data : null,
      loading: !refreshing, refreshing, error: null,
    }));
    try {
      const data = await fetchSwiftAnalytics(days, swiftId, abort.signal);
      if (generation.current === request && !abort.signal.aborted) {
        setState({ key, data, loading: false, refreshing: false, error: null });
      }
    } catch {
      if (generation.current === request && !abort.signal.aborted) {
        setState(previous => ({
          ...previous, loading: false, refreshing: false,
          error: 'Your analytics could not be loaded. Please try again.',
        }));
      }
    }
  }, [days, swiftId, key]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      generation.current += 1;
      controller.current?.abort();
    };
  }, [load]));

  const visible = state.key === key ? state : {
    key, data: null, loading: true, refreshing: false, error: null,
  };
  return { ...visible, refresh: () => load(true), retry: () => load() };
}
