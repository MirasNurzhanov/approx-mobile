// The pinned-places store: what a pin is, how long it lives, and what leaves
// the device.
//
// Three properties are worth holding onto here, because each of them is a
// decision rather than an implementation detail:
//
//  - **Nothing goes to the server.** A pin is a note to self; `services/api` is
//    never imported by the module under test, and this suite would notice.
//  - **A meetup pin dies with its meetup.** Pins carry the event's `expires_at`
//    so the map cannot end up advertising something that already happened.
//  - **Sign-out takes them.** A pinned Swift location is a coordinate one
//    account was shown after asking; it must not survive into the next.

import type AsyncStorageType from '@react-native-async-storage/async-storage';

type Store = typeof import('../pinnedPlaces');

const PINS_KEY = 'aura:pins:places';

const HOUR = 3_600_000;

/**
 * A fresh copy of the module under test, and the disk it is reading.
 *
 * Both, and from the same registry generation, which is the whole trick here.
 * The store keeps its pins in module state, so each test needs its own copy —
 * and `jest.resetModules()` also hands the re-required module a *new*
 * AsyncStorage mock, whose backing object is not the one a top-level import
 * would still be holding. Seeding through the stale one writes to a disk
 * nobody reads.
 */
let storage: typeof AsyncStorageType;
let store: Store;

function freshStore() {
  jest.resetModules();
  storage = require('@react-native-async-storage/async-storage') as typeof AsyncStorageType;
  store = require('../pinnedPlaces') as Store;
}

/** Seed the disk *before* the store is asked anything — hydration is lazy, so
 *  this is what a previous launch's cache looks like. */
async function seed(rows: unknown[]): Promise<void> {
  await storage.setItem(PINS_KEY, JSON.stringify(rows));
}

async function storedRows(): Promise<Record<string, unknown>[]> {
  const raw = await storage.getItem(PINS_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(() => {
  freshStore();
});

describe('pinning where a Swift was made', () => {
  it('keeps the place, the creator and the precision', async () => {
    const result = await store.pinSwiftLocation({
      swiftId: 42,
      latitude: 43.238,
      longitude: 76.889,
      placeName: 'Kok Tobe',
      authorName: 'miras',
      precision: 'exact',
    });

    expect(result.ok).toBe(true);
    const pins = await store.hydratePinnedPlaces();
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({
      id: 'swift:42',
      kind: 'swift',
      source_id: 42,
      latitude: 43.238,
      longitude: 76.889,
      title: 'Kok Tobe',
      subtitle: '@miras',
      precision: 'exact',
    });
    // And it is on disk, not only in memory — the point of a pin is the next
    // launch.
    expect(await storedRows()).toHaveLength(1);
  });

  it('pins the same Swift once, however many times it is asked', async () => {
    await store.pinSwiftLocation({ swiftId: 7, latitude: 1, longitude: 2 });
    await store.pinSwiftLocation({ swiftId: 7, latitude: 1, longitude: 2 });

    expect(await store.hydratePinnedPlaces()).toHaveLength(1);
  });

  it('refuses a coordinate that is not a place on Earth', async () => {
    const result = await store.pinSwiftLocation({
      swiftId: 9,
      latitude: Number.NaN,
      longitude: 76.889,
    });

    expect(result).toEqual({ ok: false, reason: 'unplaceable' });
    expect(await store.hydratePinnedPlaces()).toHaveLength(0);
  });

  it('stops at the cap rather than dropping something the user kept', async () => {
    for (let i = 0; i < store.MAX_PINS; i++) {
      await store.pinSwiftLocation({ swiftId: i, latitude: 10, longitude: 10 });
    }
    const overflow = await store.pinSwiftLocation({
      swiftId: 9_999, latitude: 10, longitude: 10,
    });

    expect(overflow).toEqual({ ok: false, reason: 'limit' });
    const pins = await store.hydratePinnedPlaces();
    expect(pins).toHaveLength(store.MAX_PINS);
    expect(pins.some((p) => p.source_id === 0)).toBe(true);
  });
});

describe('pinning a meetup the viewer is going to', () => {
  it('carries the event, and its expiry with it', async () => {
    const expiresAt = new Date(Date.now() + 4 * HOUR).toISOString();

    await store.pinMeetup({
      meetupId: 3,
      latitude: 43.2,
      longitude: 76.9,
      title: 'Sunday run',
      clubName: 'Almaty Runners',
      locationName: 'Central Park gate',
      eventDatetime: new Date(Date.now() + 2 * HOUR).toISOString(),
      expiresAt,
    });

    const [pin] = await store.hydratePinnedPlaces();
    expect(pin).toMatchObject({
      id: 'meetup:3',
      kind: 'meetup',
      title: 'Sunday run',
      subtitle: 'Almaty Runners',
      place_name: 'Central Park gate',
      expires_at: expiresAt,
    });
  });

  it('drops a meetup whose event is over, on the next read', async () => {
    await seed([
      {
        id: 'meetup:1', kind: 'meetup', source_id: 1,
        latitude: 43.2, longitude: 76.9, title: 'Last night',
        expires_at: new Date(Date.now() - HOUR).toISOString(),
        pinned_at: new Date(Date.now() - 2 * HOUR).toISOString(),
      },
      {
        id: 'meetup:2', kind: 'meetup', source_id: 2,
        latitude: 43.3, longitude: 76.8, title: 'Tonight',
        expires_at: new Date(Date.now() + HOUR).toISOString(),
        pinned_at: new Date().toISOString(),
      },
      {
        id: 'swift:5', kind: 'swift', source_id: 5,
        latitude: 43.4, longitude: 76.7, title: 'A rooftop',
        pinned_at: new Date(Date.now() - 100 * HOUR).toISOString(),
      },
    ]);
    const pins = await store.hydratePinnedPlaces();

    // The expired meetup is gone; the live one and the Swift place — which has
    // no expiry at all, because a place does not stop existing — are not.
    expect(pins.map((p) => p.id)).toEqual(['meetup:2', 'swift:5']);
    // And the prune was written back, so it does not have to be redone.
    expect(await storedRows()).toHaveLength(2);
  });
});

describe('what comes back off the disk', () => {
  it('repairs the string coordinates DRF hands out', async () => {
    await seed([{
      id: 'swift:8', kind: 'swift', source_id: 8,
      latitude: '43.238', longitude: '76.889',
      title: 'Kok Tobe', pinned_at: new Date().toISOString(),
    }]);
    const [pin] = await store.hydratePinnedPlaces();

    expect(pin.latitude).toBe(43.238);
    expect(pin.longitude).toBe(76.889);
  });

  it('throws away a row that cannot be drawn at all', async () => {
    await seed([
      { id: 'swift:1', kind: 'swift', source_id: 1, latitude: 'somewhere', longitude: null, title: 'x', pinned_at: '' },
      'not even an object',
      { kind: 'wildlife', source_id: 2, latitude: 1, longitude: 1 },
    ]);
    expect(await store.hydratePinnedPlaces()).toHaveLength(0);
  });

  it('survives a cache that is not JSON', async () => {
    await storage.setItem(PINS_KEY, '{ half a write');
    expect(await store.hydratePinnedPlaces()).toEqual([]);
  });
});

describe('removing pins', () => {
  it('unpins one and leaves the rest', async () => {
    await store.pinSwiftLocation({ swiftId: 1, latitude: 1, longitude: 1 });
    await store.pinSwiftLocation({ swiftId: 2, latitude: 2, longitude: 2 });

    await store.unpinPlace(store.pinIdFor('swift', 1));

    const pins = await store.hydratePinnedPlaces();
    expect(pins.map((p) => p.id)).toEqual(['swift:2']);
  });

  it('takes every pin, and the disk copy, on sign-out', async () => {
    await store.pinSwiftLocation({ swiftId: 1, latitude: 1, longitude: 1 });
    await store.pinMeetup({ meetupId: 2, latitude: 2, longitude: 2, title: 'Run' });

    await store.resetPinnedPlaces();

    expect(await storage.getItem(PINS_KEY)).toBeNull();
    expect(await store.hydratePinnedPlaces()).toEqual([]);
  });
});

describe('hydration', () => {
  it('reads the disk once however many callers ask at the same time', async () => {
    await seed([{
      id: 'swift:1', kind: 'swift', source_id: 1,
      latitude: 1, longitude: 1, title: 'x', pinned_at: new Date().toISOString(),
    }]);
    const getItem = jest.spyOn(storage, 'getItem');

    const [a, b, c] = await Promise.all([
      store.hydratePinnedPlaces(),
      store.hydratePinnedPlaces(),
      store.hydratePinnedPlaces(),
    ]);

    expect(getItem).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    getItem.mockRestore();
  });
});

describe('pruning between launches', () => {
  it('drops an expired meetup when a screen asks again mid-session', async () => {
    await store.pinMeetup({
      meetupId: 4,
      latitude: 43.2,
      longitude: 76.9,
      title: 'Already over',
      expiresAt: new Date(Date.now() + 50).toISOString(),
    });
    expect(await store.hydratePinnedPlaces()).toHaveLength(1);

    // The event ends while the app is still running. Nothing re-reads the disk
    // — `hydratePinnedPlaces` short-circuits once hydrated — so the prune has
    // to be its own step, which is what every screen showing pins runs on
    // mount.
    await new Promise((resolve) => setTimeout(resolve, 60));
    await store.prunePinnedPlaces();

    expect(await store.hydratePinnedPlaces()).toHaveLength(0);
    expect(await storedRows()).toHaveLength(0);
  });
});

describe('notes on a pin', () => {
  it('writes one, and keeps it on the disk copy', async () => {
    await store.pinSwiftLocation({ swiftId: 1, latitude: 1, longitude: 1, placeName: 'A rooftop' });

    await store.setPinnedNote('swift:1', '  Ask for the back terrace  ');

    const [pin] = await store.hydratePinnedPlaces();
    // Trimmed on the way in, so a note is never stored with the whitespace
    // somebody's keyboard added.
    expect(pin.note).toBe('Ask for the back terrace');
    expect((await storedRows())[0].note).toBe('Ask for the back terrace');
  });

  it('removes the note when it is emptied, leaving the pin', async () => {
    await store.pinSwiftLocation({ swiftId: 1, latitude: 1, longitude: 1 });
    await store.setPinnedNote('swift:1', 'Worth the walk');

    await store.setPinnedNote('swift:1', '   ');

    const [pin] = await store.hydratePinnedPlaces();
    expect(pin).toBeDefined();
    // Absent, not empty: "no note" is one state, and a `note` key holding ''
    // would be a second one for every reader to handle.
    expect('note' in pin).toBe(false);
    expect('note' in (await storedRows())[0]).toBe(false);
  });

  it('caps a very long note rather than refusing it', async () => {
    await store.pinSwiftLocation({ swiftId: 1, latitude: 1, longitude: 1 });

    await store.setPinnedNote('swift:1', 'x'.repeat(store.MAX_NOTE_LENGTH + 50));

    const [pin] = await store.hydratePinnedPlaces();
    expect(pin.note).toHaveLength(store.MAX_NOTE_LENGTH);
  });

  it('survives the meetup being re-pinned with fresher details', async () => {
    await store.pinMeetup({
      meetupId: 3, latitude: 1, longitude: 1, title: 'Sunday run', clubName: 'Runners',
    });
    await store.setPinnedNote('meetup:3', 'Bring the spare key');

    // What the map does on the next poll: the same event, with whatever the
    // server now says about it. The server has never heard of the note.
    await store.pinMeetup({
      meetupId: 3, latitude: 1, longitude: 1, title: 'Sunday run (moved)', clubName: 'Runners',
    });

    const [pin] = await store.hydratePinnedPlaces();
    expect(pin.title).toBe('Sunday run (moved)');
    expect(pin.note).toBe('Bring the spare key');
  });

  it('does nothing for a pin that is no longer there', async () => {
    await expect(store.setPinnedNote('swift:404', 'Hello?')).resolves.toBeUndefined();
    expect(await store.hydratePinnedPlaces()).toHaveLength(0);
  });

  it('drops a blank note that an older build wrote to disk', async () => {
    await seed([{
      id: 'swift:2', kind: 'swift', source_id: 2, latitude: 1, longitude: 1,
      title: 'x', note: '   ', pinned_at: new Date().toISOString(),
    }]);

    const [pin] = await store.hydratePinnedPlaces();

    expect(pin.note).toBeUndefined();
  });
});
