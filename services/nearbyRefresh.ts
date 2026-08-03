let _refresh: (() => void) | null = null;
let _removeMeetup: ((id: number) => void) | null = null;

export function registerNearbyRefresh(fn: () => void) {
  _refresh = fn;
}

export function triggerNearbyRefresh() {
  _refresh?.();
}

export function registerMeetupRemove(fn: (id: number) => void) {
  _removeMeetup = fn;
}

export function removeMeetupFromMap(id: number) {
  _removeMeetup?.(id);
}
