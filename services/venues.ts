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

export function venueProposalRoute(clubId: number, venueId: number, clubName?: string) {
  return {
    pathname: '/clubs/[id]/chat' as const,
    params: { id: String(clubId), venueId: String(venueId), venueRequest: String(Date.now()),
      ...(clubName ? { name: clubName } : {}) },
  };
}
