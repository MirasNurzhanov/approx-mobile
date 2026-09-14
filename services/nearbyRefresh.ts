/**
 * Lets another screen ask the map to refresh, or to drop a meetup, without importing it.
 *
 * One slot per callback, filled by whichever map is mounted. Registering returns the matching
 * unregister, and the map's effects return it as their cleanup: without that, an unmounted map's
 * closures stayed installed, and a later trigger ran its poll and its setState against a screen
 * that no longer existed. The unregister clears the slot only while it still holds that same
 * function, so a map that has already remounted keeps its registration when the old cleanup runs.
 */
let _refresh: (() => void) | null = null;
let _removeMeetup: ((id: number) => void) | null = null;

export function registerNearbyRefresh(fn: () => void): () => void {
  _refresh = fn;
  return () => {
    if (_refresh === fn) _refresh = null;
  };
}

export function triggerNearbyRefresh() {
  _refresh?.();
}

export function registerMeetupRemove(fn: (id: number) => void): () => void {
  _removeMeetup = fn;
  return () => {
    if (_removeMeetup === fn) _removeMeetup = null;
  };
}

export function removeMeetupFromMap(id: number) {
  _removeMeetup?.(id);
}
