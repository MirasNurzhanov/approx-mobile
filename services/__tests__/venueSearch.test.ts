import { searchVenues } from '../venueSearch';
import { dismissSnap, FREE_CURSOR, nextSnap, pointsFromCenter, SNAP_ENTER, SNAP_LEAVE } from '../venueSnap';
import { requestVenueFocus, takeVenueFocus } from '../venueFocus';
import type { Venue } from '../venues';

const row = (id: number, name: string, category: string, address: string, latitude = 25.08, longitude = 55.14): Venue =>
  ({ id, slug: `v-${id}`, name, category, address, description: '', image_url: '', latitude, longitude });

describe('searchVenues', () => {
  const venues = [
    row(1, 'Caffè Nero', 'Restaurant & cafe', 'Ground Floor, Dubai Marina Mall, Dubai'),
    row(2, '% Arabica JBR', 'Restaurant & cafe', 'The Beach, Jumeirah Beach Residence, Dubai'),
    row(3, "Carluccio's", 'Restaurant & cafe', 'Level P, Dubai Marina Mall, Dubai'),
    row(4, 'Dubai Marina Mall', 'Shopping mall', 'Al Marsa Street, Dubai Marina, Dubai'),
    row(5, 'UFC GYM JBR', 'Sport & fitness', 'Murjan 6, Jumeirah Beach Residence, Dubai'),
  ];
  const names = (query: string) => searchVenues(venues, query).map(v => v.name);

  it('returns everything by name for an empty query', () => {
    expect(names('  ')).toEqual(['% Arabica JBR', 'Caffè Nero', "Carluccio's", 'Dubai Marina Mall', 'UFC GYM JBR']);
  });

  it('ignores case, accents and punctuation', () => {
    expect(names('caffe')).toEqual(['Caffè Nero']);
    expect(names('arabica')).toEqual(['% Arabica JBR']);
    expect(names('carluccios')).toEqual(["Carluccio's"]);
  });

  it('puts name matches ahead of address and category matches', () => {
    // "Dubai Marina Mall" is named that; the two cafes are only inside it.
    expect(names('marina mall')).toEqual(['Dubai Marina Mall', 'Caffè Nero', "Carluccio's"]);
    expect(names('jbr')[0]).toBe('% Arabica JBR');
  });

  it('needs every word to match somewhere', () => {
    expect(names('gym jbr')).toEqual(['UFC GYM JBR']);
    expect(names('gym marina')).toEqual([]);
    expect(names('fitness')).toEqual(['UFC GYM JBR']);
  });
});

describe('nextSnap', () => {
  const size = { width: 400, height: 800 };
  // 0.004° across 400pt: 1pt is 0.00001° of longitude.
  const region = { latitude: 25, longitude: 55, latitudeDelta: 0.008, longitudeDelta: 0.004 };
  const at = (id: number, dxPt: number) => ({ id, latitude: 25, longitude: 55 + dxPt * 0.00001 });

  it('measures distance in screen points', () => {
    expect(pointsFromCenter(at(1, 30), region, size)).toBeCloseTo(30);
  });

  it('takes the nearest venue inside the enter radius', () => {
    const venues = [at(1, SNAP_ENTER - 2), at(2, 5), at(3, SNAP_ENTER + 5)];
    expect(nextSnap(venues, region, size, FREE_CURSOR)).toEqual({ snappedId: 2, dismissedId: null });
  });

  it('holds a venue until the cursor passes the leave radius', () => {
    const venues = [at(1, SNAP_ENTER + 5)];
    expect(nextSnap(venues, region, size, FREE_CURSOR).snappedId).toBeNull();
    const held = { snappedId: 1, dismissedId: null };
    expect(nextSnap(venues, region, size, held).snappedId).toBe(1);
    expect(nextSnap([at(1, SNAP_LEAVE + 1)], region, size, held).snappedId).toBeNull();
  });

  it('does not re-offer a cancelled venue until the cursor has left it', () => {
    const venues = [at(1, 0)];
    const cancelled = dismissSnap({ snappedId: 1, dismissedId: null });
    expect(cancelled).toEqual({ snappedId: null, dismissedId: 1 });
    expect(nextSnap(venues, region, size, cancelled)).toEqual(cancelled);
    const away = nextSnap([at(1, SNAP_LEAVE + 1)], region, size, cancelled);
    expect(away).toEqual(FREE_CURSOR);
    expect(nextSnap(venues, region, size, away).snappedId).toBe(1);
  });

  it('snaps to a different venue next to a cancelled one', () => {
    const cancelled = { snappedId: null, dismissedId: 1 };
    expect(nextSnap([at(1, 0), at(2, 10)], region, size, cancelled).snappedId).toBe(2);
  });

  it('holds nothing before the map has a size or with undrawable venues', () => {
    expect(nextSnap([at(1, 0)], region, { width: 0, height: 0 }, { snappedId: 1, dismissedId: null }).snappedId).toBeNull();
    expect(nextSnap([{ id: 1, latitude: NaN, longitude: 55 }], region, size, FREE_CURSOR).snappedId).toBeNull();
  });
});

describe('venue focus handoff', () => {
  it('hands the chosen venue over exactly once', () => {
    const venue = row(9, 'Pier 7', 'Restaurant & cafe', 'Dubai Marina');
    expect(takeVenueFocus()).toBeNull();
    requestVenueFocus(venue);
    expect(takeVenueFocus()).toBe(venue);
    expect(takeVenueFocus()).toBeNull();
  });
});
