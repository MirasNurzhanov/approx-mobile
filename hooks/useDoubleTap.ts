import { useCallback, useEffect, useRef } from 'react';

/** Longest gap that still counts as a double tap. Also how long a single tap is
 *  held back while we wait to find out whether a second one is coming. */
const DOUBLE_TAP_MS = 260;

/**
 * Disambiguates single from double taps on one target.
 *
 * Deliberately not react-native-gesture-handler: this needs no root provider
 * and no interaction with the enclosing pager, and the whole behaviour is the
 * eight lines below.
 *
 * The cost is that the single-tap action waits DOUBLE_TAP_MS before firing —
 * unavoidable, since until that window closes the tap might still become a
 * double.
 */
export function useDoubleTap(onSingle: () => void, onDouble: () => void): () => void {
  const lastTapAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kept current in an effect rather than during render: both are only ever
  // read from the tap handler below, which cannot run before the commit that
  // this effect follows.
  const onSingleRef = useRef(onSingle);
  const onDoubleRef = useRef(onDouble);
  useEffect(() => {
    onSingleRef.current = onSingle;
    onDoubleRef.current = onDouble;
  });

  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);

  return useCallback(() => {
    const now = Date.now();
    if (now - lastTapAt.current < DOUBLE_TAP_MS) {
      lastTapAt.current = 0;
      if (pending.current) {
        clearTimeout(pending.current);
        pending.current = null;
      }
      onDoubleRef.current();
      return;
    }
    lastTapAt.current = now;
    pending.current = setTimeout(() => {
      pending.current = null;
      onSingleRef.current();
    }, DOUBLE_TAP_MS);
  }, []);
}
