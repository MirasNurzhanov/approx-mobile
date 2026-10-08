import type { Venue } from './venues';

/**
 * A venue chosen on the search screen, waiting for the map to show it.
 *
 * Search sits on the stack above the tabs, so it hands the choice back rather
 * than navigating "to" the map: it leaves the venue here and goes back, and the
 * map takes it the next time it gains focus. A route param would do the same
 * job but lands differently depending on whether the map tab is already
 * mounted; a one-slot handoff does not care.
 *
 * Holds the whole row, not just the id — it came from the same list the map
 * draws, so there is nothing to look up again.
 */
let pending: Venue | null = null;

export function requestVenueFocus(venue: Venue) {
  pending = venue;
}

/** The waiting venue, once. A second call returns null. */
export function takeVenueFocus(): Venue | null {
  const venue = pending;
  pending = null;
  return venue;
}
