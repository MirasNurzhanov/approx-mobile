import { api } from './api';

export type ClubRole = 'owner' | 'member';

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
  creator?: number | { id: number; username: string };
  my_role?: ClubRole;   // SerializerMethodField — the viewer's own role
  is_member?: boolean;
}

export interface ClubMember {
  user: {
    id: number;
    username: string;
    profile_picture?: string;
  };
  role: ClubRole;
}

export const clubsApi = {
  list:         ()                               => api.get<Club[]>('/api/clubs/'),
  myList:       ()                               => api.get<Club[]>('/api/clubs/?joined=true'),
  userClubs:    (userId: number)                 => api.get<Club[]>(`/api/clubs/?user=${userId}`),
  get:          (id: number)                     => api.get<Club>(`/api/clubs/${id}/`),
  members:      (id: number)                     => api.get<ClubMember[]>(`/api/clubs/${id}/members/`),
  create:       (data: FormData)                 => api.post<Club>('/api/clubs/', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  join:         (id: number)                     => api.post(`/api/clubs/${id}/join/`),
  leave:        (id: number)                     => api.post(`/api/clubs/${id}/leave/`),
  kick:         (clubId: number, userId: number) => api.delete(`/api/clubs/${clubId}/kick/${userId}/`),
  promoteOwner: (clubId: number, userId: number) => api.patch(`/api/clubs/${clubId}/promote-owner/${userId}/`),
  deleteClub:   (clubId: number)                 => api.delete(`/api/clubs/${clubId}/`),
  invite:       (clubId: number, userId: number) => api.post(`/api/clubs/${clubId}/invite/${userId}/`),
};
