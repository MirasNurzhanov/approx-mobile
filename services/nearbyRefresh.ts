let _fn: (() => void) | null = null;

export function registerNearbyRefresh(fn: () => void) {
  _fn = fn;
}

export function triggerNearbyRefresh() {
  _fn?.();
}
