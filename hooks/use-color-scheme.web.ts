import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 *
 * `useSyncExternalStore` is what makes that safe: `getServerSnapshot` is the
 * value the static HTML is built with, `getSnapshot` is the real scheme once
 * there is a client to ask. React swaps between them as part of hydration, so
 * the correct scheme is known *before* the first client paint — the older
 * "render light, then flip a flag in an effect" version always cost a second
 * render, and showed a frame of light theme to dark-mode readers on the way.
 */

function subscribe(onChange: () => void): () => void {
  const sub = Appearance.addChangeListener(onChange);
  return () => sub.remove();
}

function getSnapshot(): 'light' | 'dark' {
  // RN 0.86 widened ColorSchemeName to include 'unspecified', which is what
  // the web Appearance shim returns before a media query has resolved. Treated
  // the same as null: fall back to light rather than widening the return type,
  // because every caller of this hook switches on exactly two values.
  const scheme = Appearance.getColorScheme();
  return scheme === 'dark' ? 'dark' : 'light';
}

function getServerSnapshot(): 'light' | 'dark' {
  return 'light';
}

export function useColorScheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
