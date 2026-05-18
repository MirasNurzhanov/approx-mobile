import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

type ScrollDir = 'down' | 'up';

interface ScrollNavValue {
  collapsed: boolean;
  reportScroll: (dir: ScrollDir) => void;
}

const ScrollNavContext = createContext<ScrollNavValue>({
  collapsed: false,
  reportScroll: () => {},
});

// After this many ms of no scroll events, expand back to full speedometer
const IDLE_MS = 1_400;

export function ScrollNavProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reportScroll = useCallback((dir: ScrollDir) => {
    if (timer.current) clearTimeout(timer.current);

    if (dir === 'down') {
      setCollapsed(true);
      timer.current = setTimeout(() => setCollapsed(false), IDLE_MS);
    } else {
      setCollapsed(false);
    }
  }, []);

  return (
    <ScrollNavContext.Provider value={{ collapsed, reportScroll }}>
      {children}
    </ScrollNavContext.Provider>
  );
}

export function useScrollNav() {
  return useContext(ScrollNavContext);
}
