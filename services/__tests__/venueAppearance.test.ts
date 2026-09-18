import { venueAppearance } from '../venueAppearance';

it('preserves Dostyk styling and gives the new venues distinct, appropriate icons', () => {
  expect(venueAppearance({ slug: 'dostyk-plaza', category: 'Shopping mall' }))
    .toEqual({ color: '#6044B5', icon: 'storefront-outline', caption: 'A place to get together' });
  expect(venueAppearance({ slug: 'esentai-mall', category: 'Shopping mall' }))
    .toEqual({ color: '#24554D', icon: 'bag-handle-outline', caption: 'A little city time, together' });
  expect(venueAppearance({ slug: 'six-coffee-wine-abay', category: 'Restaurant & cafe' }))
    .toEqual({ color: '#91452F', icon: 'cafe-outline', caption: 'Coffee, conversation, your people' });
});

it('keeps a safe default for future venues and closed cards', () => {
  expect(venueAppearance(null).icon).toBe('storefront-outline');
  expect(venueAppearance({ slug: 'new-place', category: 'Other' }).color).toBe('#6044B5');
});
