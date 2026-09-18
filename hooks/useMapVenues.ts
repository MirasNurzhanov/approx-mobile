import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { venuesApi, type Venue } from '@/services/venues';

/** Editorial places are separate from the frequent, privacy-sensitive people poll. */
export function useMapVenues() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const request = ++generation.current;
    setError(false);
    venuesApi.list().then(({ data }) => {
      if (request === generation.current) setVenues(data.results);
    }).catch(() => {
      if (request === generation.current) { setError(true); setVenues([]); }
    });
  }, []);
  useFocusEffect(useCallback(() => {
    refresh();
    return () => { generation.current += 1; };
  }, [refresh]));
  return { venues, error, retry: refresh };
}
