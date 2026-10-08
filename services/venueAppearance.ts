import type { Venue } from './venues';

/** Editorial styling, not the businesses' official branding. */
export function venueAppearance(venue: Pick<Venue, 'slug' | 'category'> | null) {
  if (venue?.slug === 'esentai-mall') return {
    color: '#24554D', icon: 'bag-handle-outline' as const,
    caption: 'A little city time, together',
  };
  if (venue?.category === 'Restaurant & cafe') return {
    color: '#91452F', icon: 'cafe-outline' as const,
    caption: 'Coffee, conversation, your people',
  };
  return { color: '#6044B5', icon: 'storefront-outline' as const, caption: 'A place to get together' };
}
