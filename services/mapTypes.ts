// The shapes the map screen and its hooks agree on.
//
// Split out of app/(tabs)/map.tsx when that screen began handing its data to
// hooks: useMapOverlays and useMarkerSlots both need NearbyUser and SelfZone,
// and a hook importing them back from the screen that imports the hook is a
// cycle. Nothing here is behaviour — these are the payloads /nearby/ and
// /users/zone/ answer with, described once.

import type { Presence, MotionClass } from '@/services/presence';
import type { Story } from '@/services/stories';
import type { ZoneMode } from '@/services/zoneArea';

export type Relationship = 'stranger' | 'hi_sent' | 'connected' | 'friend';

export interface NearbyUser {
  id: number;
  username: string;
  latitude: number;
  longitude: number;
  relationship: Relationship;
  distance?: number;
  distance_km?: number;
  shared_interests?: string[];
  profile_picture?: string;
  zone_active?: boolean;
  zone_radius?: number;
  /** 'region' means the zone is a real place's border, not a circle — draw
   *  `zone_region_id`'s outline instead of `zone_radius`. */
  zone_mode?: ZoneMode;
  /** Id only: the outline is ~1500 points and this payload is polled every
   *  10s. Resolved through services/zoneArea, which caches per region. */
  zone_region_id?: number | null;
  zone_audio_url?: string;
  /** Their music zone: how close you have to be to *hear* them, which is not
   *  how big their zone is. Sent only to viewers allowed to hear the track and
   *  only while the music zone is switched on, so its absence means either "no
   *  audio for you" or "there is no music zone" — and both draw nothing. */
  music_zone_radius?: number;
  /** Present for Apple Music tracks, which have a real name and cover art.
   *  Everything else is still named by services/zoneAudio from its URL. */
  zone_track_title?: string;
  zone_track_artist?: string;
  zone_track_artwork?: string;
  /** The slice of the track its owner set to repeat. Absent means the whole
   *  thing. Honoured here, not just on the owner's screen — the trim is part
   *  of what the zone plays. */
  zone_track_start_ms?: number;
  zone_track_end_ms?: number | null;
  /** 'approximate' means the position is snapped to a ~500m cell, so it should
   * be drawn as an area rather than a point that looks exact. */
  location_precision?: 'precise' | 'approximate';
  /** Absent when the viewer is not allowed to see it — which is not the same
   * as offline. Render nothing at all rather than a grey dot. */
  presence?: Presence;
  /** Coarse bucket, friends and connections only. Absent means no trail. */
  motion_class?: MotionClass;
}

/** Only what the owner's own zone circle needs. Their own audio is no longer
 * surfaced on the map — see the zone-detection effect. */
export interface SelfZone {
  zone_active: boolean;
  zone_radius: number;
  zone_mode: ZoneMode;
  zone_region_id: number | null;
  /** The music zone, drawn as its own ring. The owner is the one person who
   *  cannot hear their own zone from the map, so seeing where the sound stops
   *  is the only feedback they get — and it is the only place the radius they
   *  set on Zone Music is visible at real scale. */
  music_zone_radius: number;
  /** Whether they have a music zone at all. Off means no ring: the zone has
   *  been removed, not muted, so there is no edge left to mark. */
  music_zone_active: boolean;
  /** Whether there is a track at all. Nothing carries from an empty zone, so a
   *  ring around one would mark the reach of silence. */
  has_track: boolean;
}

export interface ClubMeetup {
  id: number;
  club: number;
  club_name: string;
  club_emblem?: string;
  created_by: { id: number; username: string; profile_picture?: string };
  title: string;
  description?: string;
  location_name?: string;
  latitude: number;
  longitude: number;
  event_datetime: string;
  status: string;
  expires_at: string;
}

export interface MapNearbyResponse {
  users: NearbyUser[];
  stories: Story[];
  meetups: ClubMeetup[];
}

