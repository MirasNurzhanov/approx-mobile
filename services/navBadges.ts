import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { api } from '@/services/api';

export interface NavBadges {
  chat: number;
  alerts: number;
}

const EMPTY: NavBadges = { chat: 0, alerts: 0 };
const POLL_MS = 30_000;
const listeners = new Set<() => void>();
let snapshot = EMPTY;
let timer: ReturnType<typeof setTimeout> | null = null;
let appSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let failures = 0;
let flight: { controller: AbortController; promise: Promise<void> } | null = null;

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function cancelRequest(): void {
  clearTimer();
  const previous = flight;
  flight = null;
  previous?.controller.abort();
}

function publish(next: NavBadges): void {
  if (next.chat === snapshot.chat && next.alerts === snapshot.alerts) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function schedule(): void {
  clearTimer();
  if (!listeners.size || AppState.currentState !== 'active') return;
  // Spread reconnect traffic; failures back off to at most two minutes.
  const delay = Math.min(POLL_MS * 2 ** failures * (0.9 + Math.random() * 0.2), 120_000);
  timer = setTimeout(() => { void refreshNavBadges(); }, delay);
}

/** All nav styles and mounted tabs share one request and one foreground timer. */
export function refreshNavBadges(): Promise<void> {
  if (AppState.currentState !== 'active') return Promise.resolve();
  if (flight) return flight.promise;
  clearTimer();
  const request = { controller: new AbortController(), promise: Promise.resolve() };
  flight = request;
  request.promise = (async () => {
    try {
      const { data } = await api.get<NavBadges>('/api/notifications/badges/', {
        signal: request.controller.signal,
        timeout: 10_000,
      });
      if (!data || !validCount(data.chat) || !validCount(data.alerts)) {
        throw new Error('Invalid navigation counts');
      }
      // Sign-out, backgrounding or unmounting invalidates the old response,
      // even if a transport ignores cancellation and finishes afterwards.
      if (flight !== request) return;
      failures = 0;
      publish({ chat: data.chat, alerts: data.alerts });
    } catch {
      if (flight === request) failures = Math.min(failures + 1, 2);
      // Preserve the last valid counts during a network failure.
    } finally {
      if (flight === request) {
        flight = null;
        schedule();
      }
    }
  })();
  return request.promise;
}

export function subscribeNavBadges(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    appSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshNavBadges();
      } else {
        cancelRequest();
      }
    });
    void refreshNavBadges();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      cancelRequest();
      appSubscription?.remove();
      appSubscription = null;
    }
  };
}

export function getNavBadges(): NavBadges {
  return snapshot;
}

export function useSharedNavBadges(): NavBadges {
  return useSyncExternalStore(subscribeNavBadges, getNavBadges, () => EMPTY);
}

export function resetNavBadges(): void {
  cancelRequest();
  failures = 0;
  publish(EMPTY);
}
