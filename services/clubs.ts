import { api } from './api';

export type ClubRole = 'owner' | 'member';

export interface ClubInterest {
  id: number;
  name: string;
  icon: string;
}

// ─── Where a club reaches ─────────────────────────────────────────────────────
// A club is scoped to one of three nested places, chosen when it is created and
// never wider than the city it was created in. The rule is enforced entirely on
// the server — nothing here filters anything, and nothing here should start to.
// These types exist so the app can *say* where a club reaches and offer the
// right choices, not so it can decide who sees what.
//
// `global` is the fourth value and not a choice: it marks the clubs that existed
// before this feature and belong nowhere in particular.

export type ClubVisibilityLevel = 'district' | 'region' | 'city';
export type StoredVisibilityLevel = ClubVisibilityLevel | 'global';

/** One tier of a place. `id` is the stable region id everything matches on;
 *  `name` is what a person reads, and the only thing left if the shared region
 *  cache ever drops the row. */
export interface PlaceTier {
  id: number | null;
  name: string;
}

export interface ClubVisibility {
  level: StoredVisibilityLevel;
  /** The place at the chosen level — "Orbita", "Bostandyk", "Almaty". Empty
   *  for a legacy club. */
  place_name: string;
  city: PlaceTier | null;
  region: PlaceTier | null;
  district: PlaceTier | null;
  country_code: string;
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
  visibility_level?: StoredVisibilityLevel;
  visibility?: ClubVisibility;
}

export interface ClubMember {
  user: {
    id: number;
    username: string;
    profile_picture?: string;
  };
  role: ClubRole;
}

// ─── Where the user is ────────────────────────────────────────────────────────
/** Why the server cannot place this user, when it cannot.
 *
 *  Each one has a different fix, which is the whole reason they are separate
 *  values rather than one "no location" flag — telling somebody to turn on
 *  location access when what they need is to open the map for a moment is how
 *  a feature gets a reputation for being broken. */
export type LocationStatus =
  | 'ok'
  | 'no_location'
  | 'stale_location'
  | 'inaccurate_location'
  | 'unmapped_location';

export interface MyClubLocation {
  resolved: boolean;
  location_status: LocationStatus;
  /** Sentence to show the user when `resolved` is false. Written server-side so
   *  the wording cannot drift between the two places that surface it. */
  detail: string;
  city: PlaceTier | null;
  region: PlaceTier | null;
  district: PlaceTier | null;
  country_code: string;
  /** The levels this user may pick right now, narrowest first. A level is
   *  missing when no boundary is mapped for that tier where they are standing —
   *  offering it anyway would make a club nobody could be found inside. */
  available_levels: ClubVisibilityLevel[];
  updated_at?: string;
}

export const UNPLACED: MyClubLocation = {
  resolved: false,
  location_status: 'no_location',
  detail: '',
  city: null,
  region: null,
  district: null,
  country_code: '',
  available_levels: [],
};

/** The label for one visibility option, as the picker shows it: the place
 *  itself, then what kind of place it is. */
export function levelLabel(level: ClubVisibilityLevel, place: MyClubLocation): string {
  const tier = place[level];
  const suffix = level === 'city' ? 'city' : level;
  return tier?.name ? `${tier.name} ${suffix}` : suffix;
}

/** How far a club reaches, for a badge on its card. */
export function visibilityLabel(club: Club): string {
  const visibility = club.visibility;
  if (!visibility || visibility.level === 'global') return '';
  if (visibility.place_name) return visibility.place_name;
  return visibility.level;
}

export const clubsApi = {
  list:         ()                               => api.get<Club[]>('/api/clubs/'),
  myList:       ()                               => api.get<Club[]>('/api/clubs/?joined=true'),
  // Somebody *else's* clubs come from their profile — `profile.clubs` on
  // GET /api/users/profile/<id>/ — and only from there. There used to be a
  // `userClubs(id)` helper here calling `/api/clubs/?user=<id>`; the list
  // endpoint has never read a `user` parameter, so it silently ignored the id
  // and answered with the *caller's* own discovery list instead. The profile
  // endpoint is the one that applies the club visibility rules per viewer.
  get:          (id: number)                     => api.get<Club>(`/api/clubs/${id}/`),
  members:      (id: number)                     => api.get<ClubMember[]>(`/api/clubs/${id}/members/`),
  create:       (data: FormData)                 => api.post<Club>('/api/clubs/', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  join:         (id: number)                     => api.post(`/api/clubs/${id}/join/`),
  leave:        (id: number)                     => api.post(`/api/clubs/${id}/leave/`),
  kick:         (clubId: number, userId: number) => api.delete(`/api/clubs/${clubId}/kick/${userId}/`),
  promoteOwner: (clubId: number, userId: number) => api.patch(`/api/clubs/${clubId}/promote-owner/${userId}/`),
  deleteClub:   (clubId: number)                 => api.delete(`/api/clubs/${clubId}/`),
  invite:       (clubId: number, userId: number) => api.post(`/api/clubs/${clubId}/invite/${userId}/`),

  /** Where the server thinks this user is, from stored boundaries only. Cheap
   *  enough to call whenever a club screen opens. */
  myLocation:   ()                               => api.get<MyClubLocation>('/api/clubs/my-location/'),
  /** The same question, allowed to go and find out. Slow, rate-limited
   *  upstream, and the only thing that can place somebody in a city nobody has
   *  opened a club screen in before — so it is the "I have moved" button and
   *  the create screen's first load, and nothing else. */
  refreshLocation: ()                            => api.post<MyClubLocation>('/api/clubs/my-location/'),
};

/** The user's place, or a shape describing why it is unknown. Never throws:
 *  every screen that asks has a "we cannot place you" state to fall into, and
 *  a failed lookup is that state. */
export async function fetchMyLocation(refresh = false): Promise<MyClubLocation> {
  try {
    const { data } = refresh
      ? await clubsApi.refreshLocation()
      : await clubsApi.myLocation();
    return data;
  } catch (e: any) {
    return {
      ...UNPLACED,
      detail:
        e?.response?.data?.detail ??
        'Approx could not check where you are. Try again in a moment.',
    };
  }
}
