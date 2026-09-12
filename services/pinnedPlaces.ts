import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { toLatitude, toLongitude } from './coords';

/**
 * Places the user has saved to their own map.
 *
 * Two things can be pinned, and they arrive from opposite directions:
 *
 *  - **A Swift's location**, after the viewer asked for it and got an answer.
 *    Somewhere you saw and want to be able to find again.
 *  - **A club meetup**, when the viewer decides they are going. The event is
 *    already on the map for as long as it is near them and unexpired; pinning
 *    it is the difference between "an event exists" and "I am going to this".
 *
 * ## Why this is on the device and not on the server
 *
 * A pin is a note to self. Nothing about it is anybody else's business — a
 * pinned meetup is not an RSVP the club can see, and a pinned Swift location is
 * not a signal back to its creator. Both of those are features somebody could
 * reasonably want, and both are a different feature from this one; sending
 * either to the server would decide that question by accident.
 *
 * ## Why the coordinates are allowed to be written down at all
 *
 * `SwiftLocation` says, in as many words, that a revealed coordinate is never
 * persisted (see services/swifts.ts). That rule is about the app keeping a
 * position it was handed for one sheet — merging it into the feed, carrying it
 * in a route param, warming it for the next card. It is not a rule against the
 * person who asked for it writing it down on purpose, which is what this is:
 * one explicit press, visible as a pin they can see and remove.
 *
 * The rule the reveal design *does* impose here is scope. `PINS_KEY` is flat
 * rather than namespaced by user id, and `resetPinnedPlaces` is called from
 * services/signOut — so a revealed location cannot outlive the account that
 * was allowed to see it. That is deliberately different from
 * services/tutorial.ts, which namespaces by id precisely so its flags *do*
 * survive: a "seen this once" flag is about the person, and a place somebody
 * was shown in confidence is about the session they were shown it in.
 */

export type PinnedPlaceKind = 'swift' | 'meetup';

export interface PinnedPlace {
  /** `${kind}:${sourceId}` — stable, so pinning the same thing twice is a
   *  no-op rather than a duplicate marker at the same coordinate. */
  id: string;
  kind: PinnedPlaceKind;
  /** The Swift's id, or the club event's. */
  source_id: number;
  latitude: number;
  longitude: number;
  /** The line the marker and the sheet lead with. */
  title: string;
  /** The named place under the point, when the source had one. */
  place_name?: string;
  /** `@username` for a Swift, the club's name for a meetup. */
  subtitle?: string;
  /** Meetups only: when it happens. */
  event_datetime?: string;
  /** Meetups only: when the event stops existing, and this pin with it. */
  expires_at?: string;
  /** Swifts only. 'approximate' means the creator shares a fuzzed position, so
   *  the map draws the ~500m cell rather than a point that looks exact. */
  precision?: 'exact' | 'approximate';
  /**
   * What the viewer wrote about this place — why they saved it, what to
   * remember, who they are meeting.
   *
   * Absent rather than empty when there is none, so "has a note" is one check
   * everywhere and a note removed leaves nothing behind in the row. Never sent
   * anywhere: this is the most personal thing in the store and the only part
   * of it the person wrote themselves.
   */
  note?: string;
  pinned_at: string;
}

/** What a caller needs to hand over to pin a Swift's location. Deliberately
 *  not a `SwiftLocation` plus a `Swift`: the two together carry a video URL, a
 *  view count and an author object, none of which belong on a map pin. */
export interface SwiftPinInput {
  swiftId: number;
  latitude: number;
  longitude: number;
  placeName?: string;
  authorName?: string;
  precision?: 'exact' | 'approximate';
  capturedAt?: string;
}

export interface MeetupPinInput {
  meetupId: number;
  latitude: number;
  longitude: number;
  title: string;
  clubName?: string;
  locationName?: string;
  eventDatetime?: string;
  expiresAt?: string;
}

const PINS_KEY = 'aura:pins:places';

/**
 * How many places one account may keep pinned.
 *
 * A ceiling rather than a rolling window: silently dropping the oldest pin to
 * make room for a new one loses something the user chose to keep and never
 * says so. At the limit the pin is refused and the caller tells them, which at
 * least leaves them holding the decision.
 */
export const MAX_PINS = 60;

/**
 * How long a note may be.
 *
 * A line or two — "ask for the back terrace", "Aisha's birthday, bring the
 * cake". Long enough to be useful on a card that also has to show a title, a
 * time and two buttons; short enough that it never turns the card into a
 * document. Enforced here rather than only in the field, so a note that
 * arrives from an older build is trimmed on the way in too.
 */
export const MAX_NOTE_LENGTH = 280;

export type PinResult =
  | { ok: true; place: PinnedPlace }
  | { ok: false; reason: 'limit' | 'unplaceable' };

interface State {
  /** null = not hydrated from disk yet. Distinct from `[]`, which is a user
   *  who has read the disk and has no pins — the map draws nothing for both,
   *  but a "pin" press must not race ahead of the hydration that would tell it
   *  the place is already pinned. */
  places: PinnedPlace[] | null;
}

/** Stable identity, so a screen reading an empty store does not re-render for
 *  a fresh `[]` on every notification. */
const EMPTY: PinnedPlace[] = [];

let state: State = { places: null };
const listeners = new Set<() => void>();

function setState(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pinIdFor(kind: PinnedPlaceKind, sourceId: number): string {
  return `${kind}:${sourceId}`;
}

/**
 * Drop what has stopped being true.
 *
 * A meetup pin dies with its event — the club chat can delete it, and it
 * expires on its own — so a pin whose `expires_at` has passed is a marker for
 * something that is not happening. Swift pins have no expiry: a place does not
 * stop existing.
 *
 * Runs on the first read, on every write, and whenever a screen that shows
 * pins mounts (`usePinnedPlaces`) — never on a timer. An expiry that lands
 * while somebody has the card open should not make the thing they are reading
 * vanish under them; it goes the next time they arrive at the map.
 */
function prune(places: PinnedPlace[], now = Date.now()): PinnedPlace[] {
  return places.filter((p) => {
    if (!p.expires_at) return true;
    const at = new Date(p.expires_at).getTime();
    return !Number.isFinite(at) || at > now;
  });
}

/**
 * A note as it is stored: trimmed, capped, and absent when it says nothing.
 *
 * One function for the field, the disk and the store, so "" and "   " and a
 * missing key cannot end up meaning three different things — a card that shows
 * an empty note block because somebody saved a space is the bug this prevents.
 */
function cleanNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, MAX_NOTE_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Newest pin first — the order the map's slot pool and any future list read
 *  them in, so a pin made just now is never the one that falls off the end. */
function sortPins(places: PinnedPlace[]): PinnedPlace[] {
  return [...places].sort(
    (a, b) => new Date(b.pinned_at).getTime() - new Date(a.pinned_at).getTime(),
  );
}

/**
 * A row off the disk, or null.
 *
 * Everything is re-validated rather than trusted, because this cache outlives
 * the code that wrote it: a build that stored a string coordinate — which is
 * what DRF hands out, see services/coords.ts — would otherwise keep crashing
 * the native map from disk long after the boundary was fixed.
 */
function reviveOne(raw: unknown): PinnedPlace | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const kind = row.kind === 'swift' || row.kind === 'meetup' ? row.kind : null;
  const sourceId = typeof row.source_id === 'number' ? row.source_id : Number(row.source_id);
  const latitude = toLatitude(row.latitude);
  const longitude = toLongitude(row.longitude);
  if (!kind || !Number.isFinite(sourceId) || latitude === null || longitude === null) return null;

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;

  return {
    id: str(row.id) ?? pinIdFor(kind, sourceId),
    kind,
    source_id: sourceId,
    latitude,
    longitude,
    title: str(row.title) ?? 'Pinned place',
    place_name: str(row.place_name),
    subtitle: str(row.subtitle),
    event_datetime: str(row.event_datetime),
    expires_at: str(row.expires_at),
    precision: kind === 'swift' ? (row.precision === 'approximate' ? 'approximate' : 'exact') : undefined,
    note: cleanNote(row.note),
    pinned_at: str(row.pinned_at) ?? new Date().toISOString(),
  };
}

async function persist(places: PinnedPlace[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PINS_KEY, JSON.stringify(places));
  } catch {
    // A pin that could not be written is still on the map for this session.
    // Losing it on the next launch is worth less than an alert about storage.
  }
}

let hydrating: Promise<PinnedPlace[]> | null = null;

/**
 * Read the pins off disk, once.
 *
 * The in-flight promise is shared: the map and a Swift sheet can both mount in
 * the same frame, and two hydrations racing would have the second one write
 * back a list that predates the first one's pin.
 */
export function hydratePinnedPlaces(): Promise<PinnedPlace[]> {
  if (state.places) return Promise.resolve(state.places);
  if (hydrating) return hydrating;

  hydrating = (async () => {
    let places: PinnedPlace[] = [];
    try {
      const raw = await AsyncStorage.getItem(PINS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        places = parsed.reduce<PinnedPlace[]>((acc, row) => {
          const place = reviveOne(row);
          if (place) acc.push(place);
          return acc;
        }, []);
      }
    } catch {
      places = [];
    }
    const live = sortPins(prune(places));
    setState({ places: live });
    // Written back only when the read actually changed something, so a launch
    // with nothing expired costs no write at all.
    if (live.length !== places.length) void persist(live);
    hydrating = null;
    return live;
  })();

  return hydrating;
}

async function writePins(next: PinnedPlace[]): Promise<void> {
  const live = sortPins(prune(next));
  setState({ places: live });
  await persist(live);
}

async function addPin(place: PinnedPlace): Promise<PinResult> {
  if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
    return { ok: false, reason: 'unplaceable' };
  }
  const current = await hydratePinnedPlaces();
  const existing = current.find((p) => p.id === place.id);
  // Re-pinning something already pinned refreshes what it says — a meetup's
  // time can be edited after it was pinned — and keeps the original date, so
  // it does not jump to the top of the list for having been looked at.
  //
  // The note is kept for a stronger reason: it is the one field on a pin the
  // server knows nothing about, so a refresh from a `ClubMeetup` carries no
  // note and would silently erase what the viewer wrote.
  if (existing) {
    const merged: PinnedPlace = {
      ...place,
      pinned_at: existing.pinned_at,
      note: existing.note,
    };
    await writePins(current.map((p) => (p.id === place.id ? merged : p)));
    return { ok: true, place: merged };
  }
  if (current.length >= MAX_PINS) return { ok: false, reason: 'limit' };
  await writePins([place, ...current]);
  return { ok: true, place };
}

/** Where a Swift was made, saved. Called from the reveal sheet and nowhere
 *  else — the coordinate does not exist anywhere a caller could reach it
 *  from. */
export function pinSwiftLocation(input: SwiftPinInput): Promise<PinResult> {
  const latitude = toLatitude(input.latitude);
  const longitude = toLongitude(input.longitude);
  if (latitude === null || longitude === null) {
    return Promise.resolve({ ok: false, reason: 'unplaceable' });
  }
  return addPin({
    id: pinIdFor('swift', input.swiftId),
    kind: 'swift',
    source_id: input.swiftId,
    latitude,
    longitude,
    title: input.placeName || 'Where a Swift was made',
    place_name: input.placeName || undefined,
    subtitle: input.authorName ? `@${input.authorName}` : undefined,
    precision: input.precision ?? 'exact',
    pinned_at: new Date().toISOString(),
  });
}

/** A meetup the viewer means to go to. */
export function pinMeetup(input: MeetupPinInput): Promise<PinResult> {
  const latitude = toLatitude(input.latitude);
  const longitude = toLongitude(input.longitude);
  if (latitude === null || longitude === null) {
    return Promise.resolve({ ok: false, reason: 'unplaceable' });
  }
  return addPin({
    id: pinIdFor('meetup', input.meetupId),
    kind: 'meetup',
    source_id: input.meetupId,
    latitude,
    longitude,
    title: input.title || 'Meetup',
    place_name: input.locationName || undefined,
    subtitle: input.clubName || undefined,
    event_datetime: input.eventDatetime,
    expires_at: input.expiresAt,
    pinned_at: new Date().toISOString(),
  });
}

/**
 * Write, change or remove the note on one pin.
 *
 * Empty — or whitespace, or a note somebody deleted the text of — removes it,
 * which is why there is no separate `clearPinnedNote`: "no note" is the same
 * state as never having written one, and two ways to reach it is two things to
 * keep in step. A pin that is no longer there is a no-op rather than an error;
 * the sheet that was open when it expired should not throw on save.
 */
export async function setPinnedNote(id: string, note: string): Promise<void> {
  const current = await hydratePinnedPlaces();
  const existing = current.find((p) => p.id === id);
  if (!existing) return;

  const cleaned = cleanNote(note);
  if (cleaned === existing.note) return;

  await writePins(current.map((p) => {
    if (p.id !== id) return p;
    // Rebuilt rather than spread-with-undefined, so a removed note leaves no
    // `note: undefined` key behind to be serialized as one.
    const { note: _dropped, ...rest } = p;
    return cleaned ? { ...rest, note: cleaned } : rest;
  }));
}

/**
 * Drop pins whose events are over, if any are.
 *
 * Cheap and silent when there is nothing to do, which is the common case — so
 * it can be called from every mount without thinking about it. Does nothing
 * before hydration, because `hydratePinnedPlaces` prunes what it reads.
 */
export async function prunePinnedPlaces(): Promise<void> {
  const current = state.places;
  if (!current) return;
  const live = prune(current);
  if (live.length !== current.length) await writePins(live);
}

export async function unpinPlace(id: string): Promise<void> {
  const current = await hydratePinnedPlaces();
  if (!current.some((p) => p.id === id)) return;
  await writePins(current.filter((p) => p.id !== id));
}

/** The whole point of a toggle: the caller says what the pin *is*, not which
 *  half of the toggle it is on. */
export async function togglePin(
  kind: PinnedPlaceKind,
  sourceId: number,
  makePin: () => Promise<PinResult>,
): Promise<PinResult | null> {
  const id = pinIdFor(kind, sourceId);
  const current = await hydratePinnedPlaces();
  if (current.some((p) => p.id === id)) {
    await unpinPlace(id);
    return null;
  }
  return makePin();
}

/**
 * Drop every pin, in memory and on disk.
 *
 * Called from sign-out. Both halves matter for the same reason the key is in
 * `ACCOUNT_SCOPED_KEYS`: a pinned Swift location is a place one account was
 * shown, and the next account on this phone has no business inheriting either
 * the marker or the coordinate behind it.
 */
export async function resetPinnedPlaces(): Promise<void> {
  hydrating = null;
  setState({ places: null });
  try {
    await AsyncStorage.removeItem(PINS_KEY);
  } catch {}
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Everything pinned, newest first. `[]` until the disk has been read, so a
 *  screen mounting mid-hydration draws no pins rather than the wrong ones. */
export function usePinnedPlaces(): PinnedPlace[] {
  const snapshot = useSyncExternalStore(subscribe, () => state.places);
  // Every reader asks; the first one does the work and the rest join its
  // promise. Cheap enough to run unconditionally, and unconditional is what
  // keeps it a real effect rather than a conditional hook. The prune is what
  // makes arriving at a screen the moment a meetup pin stops being true.
  useEffect(() => {
    void hydratePinnedPlaces().then(prunePinnedPlaces);
  }, []);
  return snapshot ?? EMPTY;
}

/** Whether one Swift or meetup is pinned, for a toggle's own state. */
export function useIsPinned(kind: PinnedPlaceKind, sourceId: number | null | undefined): boolean {
  const places = usePinnedPlaces();
  if (sourceId === null || sourceId === undefined) return false;
  const id = pinIdFor(kind, sourceId);
  return places.some((p) => p.id === id);
}
