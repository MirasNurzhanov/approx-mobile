import { useRef } from 'react';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';

import { useScrollNav } from '@/context/ScrollNavContext';

// Minimum delta (px) before we register a direction change
const THRESHOLD = 5;

export function useScrollHandler() {
  const { reportScroll } = useScrollNav();
  const lastY = useRef(0);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = e.nativeEvent.contentOffset.y;
    const delta = y - lastY.current;
    if (delta > THRESHOLD) {
      reportScroll('down');
    } else if (delta < -THRESHOLD) {
      reportScroll('up');
    }
    lastY.current = y;
  }

  return { onScroll, scrollEventThrottle: 16 } as const;
}
