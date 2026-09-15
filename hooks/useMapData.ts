// What the map knows about other people, and the poll that keeps it true.
//
// Split out of app/(tabs)/map.tsx. This is the half of that screen that talks
// to the server: the nearby list, stories, club meetups, the friend and
// connection sets, and the owner's own profile and zone. The camera and the
// device position are the other half, in hooks/useMapLocation — and the split
// is along the line that matters, because *this* file is the one that
// transmits.
//
// `tick` is the whole of the outbound traffic: one reportLocation, which
// honours the Location sharing setting and sends nothing while paused, and one
// fetch, which does not depend on it. Browsing is not publishing.

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Image } from 'expo-image';

import { api } from '@/services/api';
import { withNumericCoordsList } from '@/services/coords';
import { fetchMapNearby, isLocationNotAvailable } from '@/services/discovery';
import { reportLocation } from '@/services/location';
import type { ClubMeetup, MapNearbyResponse, NearbyUser, SelfZone } from '@/services/mapTypes';
import { registerMeetupRemove, registerNearbyRefresh } from '@/services/nearbyRefresh';
import { useGhostMode } from '@/services/privacy';
import {
  normalizeStories,
  placedStories,
  recordOwnStory,
  type ReactionType,
  type Story,
} from '@/services/stories';

const POLL_MS = 10_000;
const NO_PEOPLE: NearbyUser[] = [];

export interface MapData {
  nearby: NearbyUser[];
  currentUserId: number | null;
  friendIds: Set<number>;
  connectionIds: Set<number>;
  selfProfile: { username: string; profile_picture?: string } | null;
  selfZone: SelfZone | null;
  stories: Story[];
  clubMeetups: ClubMeetup[];
  /** Sharing is on and the server has no position for us yet. */
  awaitingFix: boolean;
  /** Re-read the friend and connection sets — after a Hi is accepted, say. */
  fetchFriends: () => Promise<void>;
  reactToStory: (storyId: number, reaction: ReactionType) => Promise<void>;
  createStory: (
    text: string,
    photoUri: string | null,
    /** Where the pin goes, or null for a story with no place. */
    at: { latitude: number; longitude: number } | null,
  ) => Promise<void>;
}

export function useMapData(
  /** The device position, mirrored so the poll does not re-subscribe on it. */
  coordsRef: React.RefObject<{ latitude: number; longitude: number } | null>,
  /** Latest platform speed estimate; rides along on the same request. */
  speedRef: React.RefObject<number | null>,
  /** Whether there is a position to report at all — drives the poll on and off. */
  hasCoords: boolean,
  /** Accuracy from the same accepted platform fix; null explicitly means unknown. */
  accuracyRef: React.RefObject<number | null>,
): MapData {
  const ghost = useGhostMode();
  const privacyVersion = useRef(0);
  const [nearby, setNearby]           = useState<NearbyUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [friendIds, setFriendIds]     = useState<Set<number>>(new Set());
  const [connectionIds, setConnectionIds] = useState<Set<number>>(new Set());
  const [selfProfile, setSelfProfile] = useState<{ username: string; profile_picture?: string } | null>(null);
  const [selfZone, setSelfZone]       = useState<SelfZone | null>(null);
  const [stories, setStories]         = useState<Story[]>([]);
  const [clubMeetups, setClubMeetups] = useState<ClubMeetup[]>([]);

  const currentUserIdRef = useRef<number | null>(null);
  // Mirrors state for the polling callbacks below. Declared above every effect
  // that reads it, so on any commit where both run this one lands first.
  // `coordsRef` is the same arrangement one level up, in useMapLocation.
  useEffect(() => { currentUserIdRef.current = currentUserId; });

  // Clear old people on every privacy transition, including leaving Ghost
  // Mode. Leaving it must fetch a current audience, never restore a cache.
  // The render gate below applies immediately, before this effect runs.
  useEffect(() => {
    privacyVersion.current += 1;
    setNearby([]);
    setStories(previous => previous.filter(s => Number(s.author.id) === currentUserIdRef.current));
    return () => { privacyVersion.current += 1; };
  }, [ghost]);

  const fetchFriends = useCallback(async () => {
    try {
      const r = await api.get<{ friends: { id: number }[]; connections: { id: number }[] }>('/api/friends/list/');
      setFriendIds(new Set(r.data.friends.map((u) => Number(u.id))));
      setConnectionIds(new Set(r.data.connections.map((u) => Number(u.id))));
    } catch {}
  }, []);

  /** Sharing is on and the server has no position for us yet. */
  const [awaitingFix, setAwaitingFix] = useState(false);

  const fetchMapData = useCallback(async () => {
    const version = privacyVersion.current;
    try {
      // Two anchors behind one call. Somebody sharing their location is
      // answered from the position the server already holds for them; somebody
      // Paused has no stored position at all, so their device's coordinate
      // rides along with the request, answers it, and is discarded. See
      // services/discovery.ts — the map does not need to know which it got.
      const r = await fetchMapNearby<MapNearbyResponse>(coordsRef.current);
      if (version !== privacyVersion.current) return;
      // Null means Paused with no fix yet. Nothing to draw and nothing to
      // clear: the previous frame is still the best answer we have.
      if (!r) return;
      const { users, stories, meetups } = r;
      // Stories and meetups are ModelSerializer output, so their coordinates
      // arrive as strings and have to be coerced before they reach a Marker —
      // see services/coords.ts. `users` is hand-assembled server-side and comes
      // through numeric today; it goes through the same gate anyway so one
      // serializer changing shape can't put the redbox back.
      setNearby(ghost === false ? withNumericCoordsList(users) : []);
      // `placedStories`, not the plain normaliser: this is the map, and a
      // story with no coordinate is not a thing it can draw. Those still exist
      // and still reach their friends — they arrive through the Chats rings,
      // which is the surface that does not need a position. See
      // services/stories.ts.
      const drawable = placedStories(stories).filter(
        s => ghost === false || Number(s.author.id) === currentUserIdRef.current,
      );
      setStories(drawable);
      drawable.forEach(s => { if (s.image) Image.prefetch(s.image); });
      const now = Date.now();
      setClubMeetups(
        withNumericCoordsList(meetups).filter((e) => new Date(e.expires_at).getTime() > now),
      );
      setAwaitingFix(false);
    } catch (e) {
      if (version !== privacyVersion.current) return;
      // Sharing is on but no position has reached the server, and we had no
      // fix to answer with either — so `fetchMapNearby` could not fall back to
      // the private query. Say we are still finding it rather than leaving a
      // map that reads as "nobody is here".
      //
      // No retry is started from here. The tick that called this runs again in
      // POLL_MS and reports a position alongside the next attempt, which is
      // the existing resume path and is bounded by construction — a retry
      // scheduled here would be a second loop racing the first.
      if (isLocationNotAvailable(e)) setAwaitingFix(true);
    }
    // `coordsRef` is a parameter now rather than a local, so it has to be
    // listed. It never changes identity — the effect still runs exactly once.
  }, [coordsRef, ghost]);

  async function reactToStory(storyId: number, reaction: ReactionType) {
    try {
      await api.post(`/api/stories/${storyId}/react/`, { reaction });
      const applyReaction = <T extends Story>(s: T): T => {
        if (s.id !== storyId) return s;
        const wasActive = s.user_reaction === reaction;
        const updated = { ...s.reactions };
        if (s.user_reaction) updated[s.user_reaction] = Math.max(0, updated[s.user_reaction] - 1);
        if (!wasActive) updated[reaction] = (updated[reaction] ?? 0) + 1;
        return { ...s, reactions: updated, user_reaction: wasActive ? null : reaction };
      };
      // Only the master list is patched: the open viewer reads its rows out of
      // it, so it picks the reaction up from here without a copy of its own.
      setStories((prev) => prev.map(applyReaction));
      await fetchMapData();
    } catch (error: any) {
      console.log('[Reaction] error:', error.response?.status, JSON.stringify(error.response?.data));
    }
  }

  async function createStory(
    text: string,
    photoUri: string | null,
    at: { latitude: number; longitude: number } | null,
  ) {
    // A position if we have one, and no position is fine. Posting a story does
    // not require being on the map — the server drops the coordinate anyway
    // while sharing is paused, and refusing here would only turn that into a
    // failure the user has to decode.
    //
    // `at` is where the composer was opened — a long-press pin, or nothing.
    // The live position is the fallback, read through the ref so posting does
    // not depend on which render this was called from.
    const c = at ?? coordsRef.current;
    const position = c
      ? {
          latitude: parseFloat(c.latitude.toFixed(6)),
          longitude: parseFloat(c.longitude.toFixed(6)),
        }
      : {};
    /** Set when the POST succeeded but the echo could not be read; thrown below
     *  the try/catch, which is the only place the compiler allows it. */
    let unreadable = false;
    // Derived before the `try`: a `??` inside one is a "value block", which
    // React Compiler cannot lower.
    const photoName = photoUri ? (photoUri.split('/').pop() ?? 'story.jpg') : null;
    try {
      const form = new FormData();
      form.append('content', text);
      if ('latitude' in position) form.append('latitude', String(position.latitude));
      if ('longitude' in position) form.append('longitude', String(position.longitude));
      if (photoUri) {
        form.append('image', {
          uri: photoUri,
          name: photoName,
          type: 'image/jpeg',
        } as any);
      }
      const response = await api.post('/api/stories/', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // The POST echoes the story back through the same serializer as the map
      // poll, so its coordinates need the same coercion — this is the one path
      // that puts a marker on screen without going through fetchMapData first.
      const [newStory] = normalizeStories([response.data]);
      if (newStory) {
        // Only on the map if it came back with somewhere to be. A story posted
        // while paused is saved, is in the archive, and reaches friends through
        // Chats — it simply has no pin, and the missing marker is the feature.
        const [drawable] = placedStories([newStory]);
        if (drawable) setStories(prev => [...prev, drawable]);
        recordOwnStory(newStory);
        setTimeout(() => fetchMapData(), 500);
      } else {
        unreadable = true;
      }
    } catch (error: any) {
      console.log('[Story] error:', error.response?.status ?? error.message);
      throw error;
    }

    // Raised out here rather than inside the `try`: React Compiler cannot lower
    // a `throw` within a try/catch and bails on this whole hook when it meets
    // one — which is what used to cost the map screen its memoization. The
    // catch above only logged and rethrew, so both are done by hand instead.
    if (unreadable) {
      const message = 'Story saved but came back unreadable';
      console.log('[Story] error:', message);
      throw new Error(message);
    }
  }

  // Self data is refetched on every focus: a fetch that failed right after
  // login would otherwise never retry (leaving the owner's zone invisible),
  // and changes made in Zone Setup must show up when returning to the map.
  const loadSelf = useCallback(() => {
    api.get<{ id: number; username: string }>('/api/users/me/')
      .then((r) => setCurrentUserId(r.data.id))
      .catch((e: any) => console.log(
        '[Map] /users/me/ error:', e?.response?.status ?? e?.code ?? e?.message,
      ));

    api.get<{ username: string; profile_picture?: string }>('/api/users/profile/')
      .then((r) => setSelfProfile({
        username: r.data.username,
        profile_picture: r.data.profile_picture,
      }))
      // The failure is worth a line; the success is not. This logged the
      // username and the photo URL on every focus, which put a signed-in
      // person's identity into any log anyone happened to be capturing.
      .catch((e: any) => console.log(
        '[Map] /users/profile/ error:', e?.response?.status ?? e?.code ?? e?.message,
      ));

    // The zone endpoint answers with either {zone_active, zone_radius, ...} or
    // {active, ...} and may omit the radius — normalize so the owner's circle
    // renders regardless of which shape arrives.
    api.get<Record<string, any>>('/api/users/zone/')
      .then((r) => {
        const d = r.data ?? {};
        const normalized: SelfZone = {
          zone_active: Boolean(d.zone_active ?? d.active ?? false),
          zone_radius: Number(d.zone_radius) > 0 ? Number(d.zone_radius) : 500,
          // `effective_zone_mode`, not the raw one: a region evicted from the
          // cache leaves the stored mode saying 'region' with nothing to draw.
          zone_mode: (d.effective_zone_mode ?? d.zone_mode) === 'region' ? 'region' : 'radius',
          zone_region_id: d.zone_region ?? null,
          // The music zone's own radius, never the map zone's. The server used
          // to resolve a "separate or inherited" question into `music_radius_m`
          // for this; there is no question left to resolve.
          music_zone_radius:
            Number(d.music_zone_radius) > 0 ? Number(d.music_zone_radius) : 200,
          // `!== false`, not `Boolean(...)`: on is the server's default and an
          // older build's response has no such key. Reading a missing field as
          // off would take the ring off the map for everyone who has not
          // touched the switch.
          music_zone_active: d.music_zone_active !== false,
          has_track: Boolean(d.zone_audio_url),
        };
        setSelfZone(normalized);
      })
      .catch((e: any) => console.log(
        '[Zone] self zone fetch error:', e?.response?.status ?? e?.code ?? e?.message,
      ));

    fetchFriends();
  }, [fetchFriends]);

  useFocusEffect(useCallback(() => { loadSelf(); }, [loadSelf]));

  const tick = useCallback(async () => {
    const c = coordsRef.current;
    if (!c) return;

    // Without our own id the nearby list stays hidden (we couldn't filter
    // ourselves out of it), so keep retrying the identity fetch until it lands.
    if (currentUserIdRef.current === null) loadSelf();

    await Promise.allSettled([
      // Honours the Location sharing setting; sends nothing when paused, and
      // the server would refuse it anyway. Speed rides along on the same
      // request — the server buckets it into a coarse class and never stores
      // the figure itself.
      reportLocation({ latitude: c.latitude, longitude: c.longitude }, speedRef.current, accuracyRef.current),
      // Independent of the line above, which is the whole point: browsing does
      // not depend on publishing, and a paused user reaches the map through
      // the private query instead.
      fetchMapData(),
    ]);
  }, [fetchMapData, loadSelf, coordsRef, speedRef, accuracyRef]);

  // Mirrors AppState into render-visible state, so the polling effect below
  // can simply depend on it instead of an interval being started/stopped
  // from inside this subscription's own callback.
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setAppActive(next === 'active'));
    return () => sub.remove();
  }, []);

  // Poll on an interval while there are coords to report and the app is in
  // the foreground; torn down and restarted whenever either condition flips,
  // which is what pauses the tick in the background and resumes it on return.
  //
  // `hasCoords` is a boolean rather than the position itself, and always was —
  // it used to be spelled `!!coords` in the dependency array, with a lint
  // suppression to allow the expression. Taking it as a boolean is the same
  // behaviour said plainly: the poll restarts when a position first arrives,
  // not every time one moves.
  useEffect(() => {
    if (!hasCoords || !appActive) return;
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [hasCoords, appActive, tick]);

  // Register tick as the global refresh so other screens can trigger it. Each
  // registration returns its own unregister as the cleanup, so once the map
  // unmounts a trigger from another screen no longer polls or sets state here.
  useEffect(() => registerNearbyRefresh(tick), [tick]);

  useEffect(() => registerMeetupRemove((id) => {
    setClubMeetups((prev) => prev.filter((m) => m.id !== id));
  }), []);

  // Unknown privacy is also hidden. Every consumer (pins, trails, music zones
  // and sheets) receives the same gated lists rather than its own UI check.
  const visibleStories = useMemo(() => (
    ghost === false ? stories : stories.filter(s => Number(s.author.id) === currentUserId)
  ), [ghost, stories, currentUserId]);

  return {
    nearby: ghost === false ? nearby : NO_PEOPLE,
    currentUserId,
    friendIds,
    connectionIds,
    selfProfile,
    selfZone,
    stories: visibleStories,
    clubMeetups,
    awaitingFix,
    fetchFriends,
    reactToStory,
    createStory,
  };
}
