// The sheets that open from the map: a person, a club meetup, a pinned place.
// Moved out of app/(tabs)/map.tsx unchanged.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, {
    useAnimatedStyle,
    type SharedValue,
} from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { PinNoteEditor } from '@/components/PinNoteEditor';
import { StoryViewer } from '@/components/StoryViewer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useSheetDrag } from '@/components/ui/useSheetDrag';
import {
    IconBookmark,
    IconCalendar,
    IconCheck,
    IconClose,
    IconLock,
    IconPencil,
    IconPeople,
    IconPin,
} from '@/components/ui/icons';
import { ZonePlayer } from '@/components/ZonePlayer';
import { useContentActions } from '@/components/ContentActions';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { useNavContentPadding } from '@/hooks/useNavMetrics';
import { api } from '@/services/api';
import { runBusy } from '@/services/busy';
import { DirectionsSheet } from '@/components/DirectionsSheet';
import { motionLabel } from '@/services/presence';
import { PresenceDot } from '@/components/PresenceDot';
import { SHEET_H, SPRING_CFG } from '@/hooks/useMapSheets';
import {
    setPinnedNote,
    type PinnedPlace,
} from '@/services/pinnedPlaces';
import { fmtRadius, trackTitle } from '@/services/zoneAudio';
import type { ReactionType, Story } from '@/services/stories';
import type {
    ClubMeetup,
    NearbyUser,
    Relationship,
} from '@/services/mapTypes';

import { makeStyles } from '@/components/map/mapStyles';
import { fmtDistance, fmtDateTime, fmtTimeLeft, distanceBand, pinTint, pinKindLabel } from '@/components/map/mapFormat';

// SHEET_H and SPRING_CFG describe the sheet animation and live with it, in
// hooks/useMapSheets. Imported above; the drag handles below share them so a
// flick and a programmatic dismiss settle identically.

const REL_LABEL: Record<Relationship, string> = {
  stranger:  'Nearby',
  hi_sent:   'Hi Sent',
  connected: 'Connected',
  friend:    'Friend',
};

// ─── Meetup Sheet ─────────────────────────────────────────────────────────────
function MeetupSheet({
  meetup,
  pinned,
  onToggleGoing,
  sheetY,
  onDismiss,
}: {
  meetup: ClubMeetup;
  pinned: boolean;
  onToggleGoing: (meetup: ClubMeetup) => Promise<void>;
  sheetY: SharedValue<number>;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const navPad = useNavContentPadding(16);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.get() }] }));
  // `onDismiss` is the screen's own `closeMeetupSheet`, so a dragged dismiss
  // and a backdrop tap run the same teardown — see `useSheetDrag`.
  const drag = useSheetDrag({ sheetY, height: SHEET_H, onDismiss, spring: SPRING_CFG });
  const [saving, setSaving] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);

  function toggleGoing() {
    if (saving) return;
    setSaving(true);
    void runBusy(() => onToggleGoing(meetup), () => setSaving(false));
  }

  return (
    <>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onDismiss} />
      <Animated.View style={[styles.sheet, { paddingBottom: navPad }, animStyle]}>
        {/* The whole grab area, not just the 36x4 bar: a 4pt-tall drag target
            is unusable, so the detector wraps a padded row and the bar inside
            it is what you see. */}
        <GestureDetector gesture={drag}>
          <View style={styles.sheetGrab}>
            <View style={styles.sheetHandle} />
          </View>
        </GestureDetector>

        {/* Head: club emblem + title + expiry */}
        <View style={styles.sheetHead}>
          {meetup.club_emblem ? (
            <Image source={{ uri: meetup.club_emblem }} style={styles.meetupSheetEmblem} />
          ) : (
            <View style={styles.meetupSheetEmblemFallback}>
              <IconCalendar size={22} color="#fff" />
            </View>
          )}
          <View style={styles.sheetHeadBody}>
            <Text style={styles.sheetName} numberOfLines={2}>{meetup.title}</Text>
            <Text style={styles.sheetMeta} numberOfLines={1}>{meetup.club_name}</Text>
          </View>
          <View style={styles.meetupExpiryPill}>
            <Text style={styles.meetupExpiryText}>{fmtTimeLeft(meetup.expires_at)}</Text>
          </View>
        </View>

        {/* Details */}
        <View style={styles.meetupDetailBlock}>
          <View style={styles.meetupDetailRow}>
            <IconCalendar size={14} color={colors.t3} />
            <Text style={styles.meetupDetailText}>{fmtDateTime(meetup.event_datetime)}</Text>
          </View>
          {meetup.location_name ? (
            <View style={styles.meetupDetailRow}>
              <IconPin size={14} color={colors.t3} />
              <Text style={styles.meetupDetailText} numberOfLines={1}>{meetup.location_name}</Text>
            </View>
          ) : null}
          <View style={styles.meetupDetailRow}>
            <IconPeople size={14} color={colors.t3} />
            <Text style={styles.meetupDetailText}>Proposed by @{meetup.created_by.username}</Text>
          </View>
          {!!meetup.meeting_point && <Text style={styles.meetupDescription}>Meeting point: {meetup.meeting_point}</Text>}
          {meetup.description ? (
            <Text style={styles.meetupDescription}>{meetup.description}</Text>
          ) : null}
        </View>

        {/* Going first, directions second: the decision comes before the
            journey, and it is the one of the two that leaves something behind
            on the map. */}
        <View style={styles.sheetActionRow}>
          <View style={styles.sheetActionCell}>
            <Button
              label={pinned ? 'Going' : "I'm going"}
              variant={pinned ? 'secondary' : 'primary'}
              size="md"
              fullWidth
              loading={saving}
              icon={pinned ? IconCheck : IconBookmark}
              onPress={toggleGoing}
              accessibilityLabel={
                pinned
                  ? 'Going. Tap to remove this meetup from your map.'
                  : 'I am going. Pins this meetup to your map.'
              }
            />
          </View>
          <View style={styles.sheetActionCell}>
            <Button
              label="Directions"
              variant="secondary"
              size="md"
              fullWidth
              onPress={() => setDirectionsOpen(true)}
              accessibilityLabel={
                `Directions to ${meetup.title}. Travel times by car, on foot, by bike and on transit.`
              }
            />
          </View>
        </View>
      </Animated.View>

      <DirectionsSheet
        visible={directionsOpen}
        target={{
          latitude: meetup.latitude,
          longitude: meetup.longitude,
          title: meetup.title,
          placeName: meetup.location_name ?? undefined,
        }}
        onClose={() => setDirectionsOpen(false)}
      />
    </>
  );
}

function PinnedSheet({ place, sheetY, onDismiss, onUnpin }: {
  place: PinnedPlace;
  sheetY: SharedValue<number>;
  onDismiss: () => void;
  onUnpin: (place: PinnedPlace) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const navPad = useNavContentPadding(16);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.get() }] }));
  const drag = useSheetDrag({ sheetY, height: SHEET_H, onDismiss, spring: SPRING_CFG });
  const tint = pinTint(place, colors);
  const [noteOpen, setNoteOpen] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);

  return (
    <>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onDismiss} />
      <Animated.View style={[styles.sheet, { paddingBottom: navPad }, animStyle]}>
        <GestureDetector gesture={drag}>
          <View style={styles.sheetGrab}>
            <View style={styles.sheetHandle} />
          </View>
        </GestureDetector>

        <View style={styles.sheetHead}>
          <View style={[styles.pinnedSheetGlyph, { borderColor: tint }]}>
            {place.kind === 'meetup'
              ? <IconCalendar size={22} color={tint} />
              : <IconBookmark size={22} color={tint} filled />}
          </View>
          <View style={styles.sheetHeadBody}>
            <Text style={styles.sheetName} numberOfLines={2}>{place.title}</Text>
            <Text style={[styles.pinnedKindLabel, { color: tint }]} numberOfLines={1}>
              {pinKindLabel(place)}
            </Text>
          </View>
        </View>

        <View style={styles.meetupDetailBlock}>
          {place.subtitle ? (
            <View style={styles.meetupDetailRow}>
              <IconPeople size={14} color={colors.t3} />
              <Text style={styles.meetupDetailText} numberOfLines={1}>{place.subtitle}</Text>
            </View>
          ) : null}
          {place.event_datetime ? (
            <View style={styles.meetupDetailRow}>
              <IconCalendar size={14} color={colors.t3} />
              <Text style={styles.meetupDetailText}>{fmtDateTime(place.event_datetime)}</Text>
            </View>
          ) : null}
          {place.place_name ? (
            <View style={styles.meetupDetailRow}>
              <IconPin size={14} color={colors.t3} />
              <Text style={styles.meetupDetailText} numberOfLines={2}>{place.place_name}</Text>
            </View>
          ) : null}
          {place.precision === 'approximate' ? (
            <Text style={styles.meetupDescription}>
              This creator shares their location approximately, so the circle is
              the area rather than an exact spot.
            </Text>
          ) : null}
        </View>

        {/* The note sits between what the place *is* and what you can do with
            it, because that is what it answers: why this one was worth
            keeping. Tapping it opens the editor either way — an empty block
            that only invites writing would be a control that changes meaning
            once used. */}
        <Pressable
          style={({ pressed }) => [
            styles.pinNoteBlock,
            !place.note && styles.pinNoteEmpty,
            pressed && { opacity: 0.7 },
          ]}
          onPress={() => setNoteOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            place.note
              ? `Your note: ${place.note}. Tap to edit or remove it.`
              : `Add a note about ${place.title}`
          }
        >
          <IconPencil size={14} color={place.note ? colors.t3 : colors.teal} />
          <Text
            style={[styles.pinNoteText, !place.note && styles.pinNoteAddText]}
            numberOfLines={4}
          >
            {place.note || 'Add a note'}
          </Text>
        </Pressable>

        <View style={styles.sheetActionRow}>
          <View style={styles.sheetActionCell}>
            <Button
              label="Directions"
              variant="primary"
              size="md"
              fullWidth
              onPress={() => setDirectionsOpen(true)}
              accessibilityLabel={
                `Directions to ${place.title}. Travel times by car, on foot, by bike and on transit.`
              }
            />
          </View>
          <View style={styles.sheetActionCell}>
            <Button
              label="Remove pin"
              variant="secondary"
              size="md"
              fullWidth
              onPress={() => onUnpin(place)}
              accessibilityLabel={`Remove ${place.title} from your map`}
            />
          </View>
        </View>
      </Animated.View>

      <DirectionsSheet
        visible={directionsOpen}
        target={{
          latitude: place.latitude,
          longitude: place.longitude,
          title: place.title,
          placeName: place.place_name,
          approximate: place.precision === 'approximate',
        }}
        onClose={() => setDirectionsOpen(false)}
      />

      <PinNoteEditor
        placeId={place.id}
        visible={noteOpen}
        placeTitle={place.title}
        note={place.note}
        onClose={() => setNoteOpen(false)}
        onSave={(text) => { void setPinnedNote(place.id, text); }}
      />
    </>
  );
}

// ─── User Sheet ───────────────────────────────────────────────────────────────
interface SheetProps {
  user: NearbyUser;
  sheetY: SharedValue<number>;
  onDismiss: () => void;
  onFriendChange: () => void;
}

// The viewer's coordinates and this user's region outline used to be props: a
// music zone could be a city border, so "are you inside it" was a
// point-in-polygon question. A music zone is always a circle now, and a scalar
// distance answers it.
/**
 * What the viewer is to this person, and what that entitles them to see.
 *
 * `identified` is the load-bearing one: below a mutual Hi there is no name and
 * no face on the card, because the map showed a point and the card has to agree
 * with the map or the point was never really anonymous.
 */
function describeRelationship(rel: Relationship, colors: ColorPalette) {
  const isFriend = rel === 'friend';
  const isConnected = rel === 'connected';
  return {
    isFriend,
    isConnected,
    isHiSent: rel === 'hi_sent',
    isStranger: rel === 'stranger',
    identified: isFriend || isConnected,
    ringColor: isFriend ? colors.blue : isConnected ? colors.orange : colors.t3,
    labelColor: isFriend ? colors.blue : isConnected ? colors.orange : colors.t2,
  };
}

type RelationshipInfo = ReturnType<typeof describeRelationship>;

/**
 * Identity row: who, how far, and what they are to you — one line of each, read
 * left to right. The old sheet stacked this centred over 400px, which pushed
 * the actions below the fold on small screens.
 */
function UserSheetHead({ user, rel, info, metaLine }: {
  user: NearbyUser;
  rel: Relationship;
  info: RelationshipInfo;
  metaLine: string;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.sheetHead}>
      {info.identified ? (
        <Avatar
          uri={user.profile_picture}
          name={user.username}
          size="md"
          ringColor={info.ringColor}
          presence={user.presence}
        />
      ) : (
        // The marker, enlarged. A stranger is a point of light here too.
        <View style={styles.strangerAvatar}>
          <View style={styles.strangerAvatarGlow} />
          <View style={styles.strangerAvatarCore} />
        </View>
      )}

      <View style={styles.sheetHeadBody}>
        <Text style={styles.sheetName} numberOfLines={1}>
          {info.identified ? user.username : 'Someone nearby'}
        </Text>
        {metaLine ? (
          <Text style={styles.sheetMeta} numberOfLines={1}>{metaLine}</Text>
        ) : null}
      </View>

      <View style={[styles.relPill, { borderColor: info.ringColor }]}>
        <Text style={[styles.relPillText, { color: info.labelColor }]}>
          {REL_LABEL[rel] ?? 'Nearby'}
        </Text>
      </View>
    </View>
  );
}

/**
 * Presence and motion were badges in the meta row and are now a single quiet
 * line — still spelled out in words, because the trail on the map is decorative
 * and hidden from assistive tech.
 */
function UserSheetStatus({ user }: { user: NearbyUser }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const motion = motionLabel(user.motion_class);

  if (!user.presence && !motion) return null;
  return (
    <View style={styles.statusRow}>
      {user.presence && <PresenceDot presence={user.presence} size={8} withText />}
      {motion && (
        <Text style={styles.statusMotion} accessible accessibilityLabel={motion}>
          {user.motion_class === 'fast' ? 'Moving fast' : 'On the move'}
        </Text>
      )}
    </View>
  );
}

/**
 * Their zone track, on the person it belongs to — the map used to float this
 * over everything as a banner, which is how it ended up playing to people who
 * had never asked for it.
 */
function UserSheetZone({ user, zoneUrl }: { user: NearbyUser; zoneUrl: string }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // Zone Music is audio other people hear, so it is reportable like any other
  // user-generated content (App Review 1.2) — by the people who can hear it.
  const { present, sheets } = useContentActions();

  const distanceM = user.distance ?? (user.distance_km != null ? user.distance_km * 1000 : null);
  // Their music zone, which is always a circle — never the city border their
  // *map* zone might be. A region is a shape, not a distance, and comparing a
  // radius against one was wrong in both directions: someone 3km away can be
  // well inside a city while someone 300m away across the boundary is outside.
  // The music zone having its own radius is what removed that problem.
  const musicRadius = user.music_zone_radius && user.music_zone_radius > 0
    ? user.music_zone_radius
    : 200;
  const zoneLabel = fmtRadius(musicRadius);
  // Unknown position is not "out of range" — a card that refuses to play with
  // no reason it can name is worse than one that plays a track you can hear.
  const insideZone = distanceM == null || distanceM < musicRadius;

  return (
    <View style={styles.zoneSection}>
      <Text style={styles.sectionLabel}>Zone music</Text>
      <ZonePlayer
        // Remounts per track, so switching between two friends' cards
        // cannot leave the previous one loaded.
        key={zoneUrl}
        url={zoneUrl}
        // An Apple track knows its own name and artist; an upload is
        // still named from the URL, which for Apple's CDN would be a
        // hash.
        title={user.zone_track_title || trackTitle(zoneUrl)}
        artwork={user.zone_track_artwork}
        startMs={user.zone_track_start_ms ?? 0}
        endMs={user.zone_track_end_ms ?? null}
        subtitle={
          [
            user.zone_track_artist || `@${user.username}`,
            insideZone
              ? `inside their ${zoneLabel} music zone`
              : `${zoneLabel} music zone`,
          ].join(' · ')
        }
        blockedReason={
          insideZone
            ? null
            : `Out of range — step within ${zoneLabel} of them to listen`
        }
        accessibilityName={`${user.username}'s zone track`}
      />
      <View style={styles.zoneNote}>
        <IconLock size={12} color={colors.t3} />
        <Text style={styles.zoneNoteText}>
          Audible to their friends only. It stays silent until you press play.
        </Text>
        <Pressable
          onPress={() => present({
            target: 'zone_audio',
            targetId: user.id,
            subject: `@${user.username}’s zone music`,
            authorId: user.id,
            authorUsername: user.username,
            authorAvatar: user.profile_picture,
          })}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Report or block ${user.username}’s zone music`}
        >
          <Text style={styles.zoneReportText}>Report</Text>
        </Pressable>
      </View>
      {sheets}
    </View>
  );
}

/**
 * One decision, then a way out of it. The primary action is wide and the
 * dismiss is a square beside it, so the choice a stranger card offers reads as
 * "yes, or nothing".
 */
function UserSheetActions({ info, requestSent, onAddFriend, onHi, onMessage, onProfile, onDismiss }: {
  info: RelationshipInfo;
  requestSent: boolean;
  onAddFriend: () => void;
  onHi: () => void;
  onMessage: () => void;
  onProfile: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <>
      {/* Connections can be promoted to friends right from the map; the
          server rejects friend requests to anyone not connected yet. */}
      {info.isConnected && (
        <View style={styles.addFriendRow}>
          <Button
            label={requestSent ? 'Friend Request Sent ✓' : 'Add Friend'}
            variant={requestSent ? 'secondary' : 'primary'}
            size="md"
            fullWidth
            disabled={requestSent}
            onPress={onAddFriend}
          />
        </View>
      )}

      <View style={styles.actions}>
        <View style={styles.actionPrimary}>
          {info.isStranger && (
            <Button label="Say Hi" variant="primary" size="md" fullWidth onPress={onHi} />
          )}
          {info.isHiSent && (
            <Button label="Hi Sent ✓" variant="secondary" size="md" fullWidth disabled />
          )}
          {info.identified && (
            <Button label="Message" variant="primary" size="md" fullWidth onPress={onMessage} />
          )}
        </View>
        <View style={styles.actionSecondary}>
          <Button label="Profile" variant="ghost" size="md" fullWidth onPress={onProfile} />
        </View>
        <Pressable
          onPress={onDismiss}
          style={styles.actionDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <IconClose size={16} color={colors.t3} />
        </Pressable>
      </View>
    </>
  );
}

function UserSheet({
  user, sheetY, onDismiss, onFriendChange,
}: SheetProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const navPad = useNavContentPadding(16);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.get() }],
  }));
  const drag = useSheetDrag({ sheetY, height: SHEET_H, onDismiss, spring: SPRING_CFG });

  const rel  = user.relationship ?? 'stranger';
  const info = describeRelationship(rel, colors);
  const dist = fmtDistance(user.distance);

  // The sheet stays mounted when tapping straight to another marker, so "sent"
  // has to mean "sent to *this* person". Recording who it was sent to says that
  // outright, instead of a boolean that an effect has to remember to clear —
  // and the old version cleared it a render late, so tapping from someone you
  // had just messaged to someone new showed "Sent" under the new name first.
  const [sentTo, setSentTo] = useState<number | null>(null);
  const requestSent = sentTo === user.id;

  function sendFriendRequest() {
    api.post(`/api/friends/request/${user.id}/`)
      .then(() => setSentTo(user.id))
      .catch((e) => console.log('[Friend Request] error:', e?.response?.status, JSON.stringify(e?.response?.data)));
  }

  function sendHi() {
    api.post('/api/friends/hi/', { receiver_id: user.id })
      .then(() => onFriendChange())
      .catch((e) => console.log('[Hi] error:', e?.response?.status, JSON.stringify(e?.response?.data)));
    onDismiss();
  }

  function goToMessages() {
    onDismiss();
    router.push({ pathname: '/messages/[id]', params: { id: user.id, username: user.username } });
  }

  function goToProfile() {
    onDismiss();
    router.push({ pathname: '/profile/[id]', params: { id: user.id, username: user.username } });
  }

  // Friends and connections get the real number; a stranger gets a band.
  const distLine = info.identified ? dist : distanceBand(user.distance);
  const zoneLine = info.identified && user.zone_audio_url ? 'has a music zone' : null;
  const metaLine = [distLine, zoneLine].filter(Boolean).join(' · ');

  // ── Their zone track ──
  // The server only sends zone_audio_url to viewers allowed to hear it —
  // friends and connections, never a stranger, whatever the owner's Zone
  // audio setting says — so a URL here is already permission to play. This
  // check is redundant with that server gate, kept as a second line of
  // defence rather than trusting the field's mere presence.
  //
  // The track is its own switch. `zone_active` governs whether they are drawn
  // with a zone on the map, and reading it here is what made turning that
  // circle off silently mute a song its owner had not touched.
  const zoneUrl = info.identified ? user.zone_audio_url : undefined;

  return (
    <>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onDismiss} />
      <Animated.View style={[styles.sheet, { paddingBottom: navPad }, animStyle]}>
        <GestureDetector gesture={drag}>
          <View style={styles.sheetGrab}>
            <View style={styles.sheetHandle} />
          </View>
        </GestureDetector>

        <UserSheetHead user={user} rel={rel} info={info} metaLine={metaLine} />

        <UserSheetStatus user={user} />

        {zoneUrl && <UserSheetZone user={user} zoneUrl={zoneUrl} />}

        {user.shared_interests && user.shared_interests.length > 0 && (
          <View style={styles.interestsSection}>
            <Text style={styles.sectionLabel}>
              {info.identified ? 'Shared interests' : 'You both like'}
            </Text>
            <FlatList
              horizontal
              data={user.shared_interests}
              keyExtractor={(tag) => tag}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
              renderItem={({ item: tag }) => (
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{tag}</Text>
                </View>
              )}
            />
          </View>
        )}

        <UserSheetActions
          info={info}
          requestSent={requestSent}
          onAddFriend={sendFriendRequest}
          onHi={sendHi}
          onMessage={goToMessages}
          onProfile={goToProfile}
          onDismiss={onDismiss}
        />

        {/* Says out loud what the card is already doing. Someone deciding
            whether to send a Hi is deciding how much of themselves it costs. */}
        {info.isStranger && (
          <Text style={styles.sheetFootnote}>
            They see the same shared interests — and nothing else about you.
          </Text>
        )}
      </Animated.View>
    </>
  );
}

/** The two panels and the full-screen viewer that can cover the map. */
export function MapSheets({
  sheetUser, selectedUser, sheetMeetup, selectedMeetup, sheetPin, selectedPin, sheetY,
  storyViewer, currentUserId, friendIds, goingToMeetup,
  onCloseSheet, onCloseMeetupSheet, onClosePinSheet, onToggleGoing, onUnpin,
  onFriendChange, onCloseStories, onReact,
}: {
  sheetUser: NearbyUser | null;
  selectedUser: NearbyUser | null;
  sheetMeetup: ClubMeetup | null;
  selectedMeetup: ClubMeetup | null;
  sheetPin: PinnedPlace | null;
  selectedPin: PinnedPlace | null;
  sheetY: SharedValue<number>;
  storyViewer: { stories: Story[] } | null;
  currentUserId: number | null;
  friendIds: Set<number>;
  /** Whether the meetup in the open card is one the viewer said they are
   *  going to. Passed in rather than read here so the sheet and the marker
   *  answer it from the same list. */
  goingToMeetup: boolean;
  onCloseSheet: () => void;
  onCloseMeetupSheet: () => void;
  onClosePinSheet: () => void;
  onToggleGoing: (meetup: ClubMeetup) => Promise<void>;
  onUnpin: (place: PinnedPlace) => void;
  onFriendChange: () => void;
  onCloseStories: () => void;
  onReact: (storyId: number, reaction: ReactionType) => Promise<void>;
}) {
  // Who a reply would go to, or nobody: the author has to be a friend, and
  // replying to yourself is not a thing.
  const author = storyViewer?.stories[0]?.author;
  const authorId = author ? Number(author.id) : null;
  const replyTo =
    author && authorId !== null && authorId !== currentUserId && friendIds.has(authorId)
      ? { id: authorId, username: author.username }
      : null;

  return (
    <>
      {/* User detail sheet — kept mounted after first tap to avoid remount cost. */}
      {sheetUser && (
        <View
          style={[StyleSheet.absoluteFill, { opacity: selectedUser ? 1 : 0 }]}
          pointerEvents={selectedUser ? 'box-none' : 'none'}
        >
          <UserSheet
            user={sheetUser}
            sheetY={sheetY}
            onDismiss={onCloseSheet}
            onFriendChange={onFriendChange}
          />
        </View>
      )}

      {/* Club meetup detail sheet — same pre-mount strategy. */}
      {sheetMeetup && (
        <View
          style={[StyleSheet.absoluteFill, { opacity: selectedMeetup ? 1 : 0 }]}
          pointerEvents={selectedMeetup ? 'box-none' : 'none'}
        >
          <MeetupSheet
            meetup={sheetMeetup}
            pinned={goingToMeetup}
            onToggleGoing={onToggleGoing}
            sheetY={sheetY}
            onDismiss={onCloseMeetupSheet}
          />
        </View>
      )}

      {/* Pinned place card — same pre-mount strategy again. */}
      {sheetPin && (
        <View
          style={[StyleSheet.absoluteFill, { opacity: selectedPin ? 1 : 0 }]}
          pointerEvents={selectedPin ? 'box-none' : 'none'}
        >
          <PinnedSheet
            place={sheetPin}
            sheetY={sheetY}
            onDismiss={onClosePinSheet}
            onUnpin={onUnpin}
          />
        </View>
      )}

      {/* Full-screen story viewer */}
      {storyViewer && (
        <StoryViewer
          stories={storyViewer.stories}
          onClose={onCloseStories}
          onReact={onReact}
          replyTo={replyTo}
          currentUserId={currentUserId}
        />
      )}
    </>
  );
}
