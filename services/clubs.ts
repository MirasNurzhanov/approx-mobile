import { api } from './api';

export type ClubRole = 'president' | 'vice' | 'member';

export interface ClubInterest {
  id: number;
  name: string;
  icon: string;
}

export interface Club {
  id: number;
  name: string;
  description?: string;
  emblem?: string;
  interest?: ClubInterest;
  member_count: number;
  role?: ClubRole;
  is_member?: boolean;
}

export interface ClubMember {
  id: number;
  username: string;
  profile_picture?: string;
  role: ClubRole;
}

export const clubsApi = {
  list:     ()                          => api.get<Club[]>('/api/clubs/'),
  discover: ()                          => api.get<Club[]>('/api/clubs/discover/'),
  get:      (id: number)                => api.get<Club>(`/api/clubs/${id}/`),
  members:  (id: number)                => api.get<ClubMember[]>(`/api/clubs/${id}/members/`),
  create:   (data: FormData)            => api.post<Club>('/api/clubs/', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  join:     (id: number)                => api.post(`/api/clubs/${id}/join/`),
  leave:    (id: number)                => api.delete(`/api/clubs/${id}/leave/`),
  kick:     (clubId: number, userId: number) => api.post(`/api/clubs/${clubId}/kick/${userId}/`),
  promote:  (clubId: number, userId: number) => api.post(`/api/clubs/${clubId}/promote/${userId}/`),
  transfer: (clubId: number, userId: number) => api.post(`/api/clubs/${clubId}/transfer/${userId}/`),
};
