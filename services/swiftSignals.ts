import { api } from './api';

/**
 * Reporting what happened, so the feed can get better at guessing.
 *
 * ## Batched, because a signal per swipe is a request per swipe
 *
 * Every card a viewer scrolls past produces a signal — mostly skips, which are
 * the most informative thing this file collects. Sent individually that is more
 * traffic than the feed itself. So they queue and flush on a timer, on size, or
 * when the screen goes away, whichever comes first.
 *
 * The queue is deliberately lossy at the edges: a batch that fails is dropped
 * rather than retried forever. A missing skip costs the ranker a little
 * accuracy; a retry loop holding stale events costs the viewer their battery,
 * and the ranker gets the same information from the next hundred swipes anyway.
 *
 * ## What is never sent
 *
 * No coordinates. `location_reveal` reports that a reveal happened and nothing
 * about where anybody was — the server's serializer declares no location field
 * at all, so one added here would be silently dropped, but the reason it is not
 * added here is that ranking must never be a reason to transmit a position.
 *
 * No captions, no usernames, no free text. Ids, an enum, and two numbers.
 */

export type SwiftSignalKind =
  | 'like'
  | 'comment'
  | 'repost'
  | 'profile_open'
  | 'location_reveal'
  | 'watch'
  | 'complete'
  | 'replay'
  | 'pause'
  | 'skip'
  | 'not_interested'
  | 'report'
  | 'block_creator';

export interface SwiftSignal {
  kind: SwiftSignalKind;
  swift_id?: number;
  /** Longest single watch, milliseconds. */
  watch_ms?: number;
  /** 0–100. The server reinterprets a low value as a skip — the thresholds are
   *  tuning decisions and do not belong in an app build. */
  completion_pct?: number;
  /** Which candidate source served this Swift, from the feed response. */
  served_by?: string;
  /** Slot in the feed. Without it a model learns the feed's own ordering
   *  rather than the viewer's taste, because position drives watching. */
  position?: number;
}

/** Matches the server's `MAX_BATCH`. A larger batch is a 400, not a truncation. */
const MAX_BATCH = 50;
/** Long enough that a burst of scrolling becomes one request, short enough that
 *  a viewer who stops watching has their session recorded before they leave. */
const FLUSH_AFTER_MS = 8000;

let queue: SwiftSignal[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Queue one signal. Never throws, never blocks the interaction that caused it.
 *
 * Reporting is strictly best-effort: the like already happened through its own
 * endpoint, and this is the analytics shadow of it. A failure here must not
 * surface anywhere near the viewer.
 */
export function reportSwiftSignal(signal: SwiftSignal): void {
  queue.push(signal);
  if (queue.length >= MAX_BATCH) {
    void flushSwiftSignals();
    return;
  }
  if (timer === null) {
    timer = setTimeout(() => { void flushSwiftSignals(); }, FLUSH_AFTER_MS);
  }
}

/**
 * Send whatever is queued.
 *
 * Called on the timer, on a full batch, and by the feed when the screen loses
 * focus or the app backgrounds — the moment a session's signals are most at
 * risk of never being sent at all.
 */
export async function flushSwiftSignals(): Promise<void> {
  clearTimer();
  if (inFlight || queue.length === 0) return;

  // Taken before the await, so signals arriving during the request join the
  // next batch instead of being dropped with this one on failure.
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(batch.length);
  inFlight = true;

  try {
    await api.post('/api/swifts/signals/', { signals: batch });
  } catch {
    // Dropped on purpose. See the module note: a retry queue costs more than
    // the information is worth, and the next hundred swipes carry it again.
  } finally {
    inFlight = false;
    if (queue.length > 0 && timer === null) {
      timer = setTimeout(() => { void flushSwiftSignals(); }, FLUSH_AFTER_MS);
    }
  }
}

/** Test seam. Nothing in the app calls this. */
export function __resetSignalQueue(): void {
  clearTimer();
  queue = [];
  inFlight = false;
}

/** Test seam. */
export function __pendingSignalCount(): number {
  return queue.length;
}
