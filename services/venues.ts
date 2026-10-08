import { api } from './api';

export interface Venue {
  id: number;
  name: string;
  slug: string;
  address: string;
  category: string;
  description: string;
  image_url: string;
  latitude: number;
  longitude: number;
}

export const venuesApi = {
  list: () => api.get<{ results: Venue[]; next: string | null }>('/api/venues/'),
  get: (id: number) => api.get<Venue>(`/api/venues/${id}/`),
};

/**
 * Making a Swift at a venue.
 *
 * Carries the id and nothing else, for the same reason `venueProposalRoute`
 * does: the composer asks the server where the venue is. A coordinate that
 * travelled through navigation state would be a coordinate anybody could edit,
 * and it ends up attached to a published Swift.
 */
export function venueSwiftRoute(venueId: number) {
  return {
    pathname: '/swifts/compose' as const,
    params: { venueId: String(venueId) },
  };
}

export function venueProposalRoute(clubId: number, venueId: number, clubName?: string) {
  return {
    pathname: '/clubs/[id]/chat' as const,
    params: { id: String(clubId), venueId: String(venueId), venueRequest: String(Date.now()),
      ...(clubName ? { name: clubName } : {}) },
  };
}
