// What the map draws for one person, cluster, story, meetup, pinned place or music
// zone. Presentational: everything arrives as props. Moved out of
// app/(tabs)/map.tsx unchanged.

import { useEffect, useState } from 'react';
import {
    Text,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import { Marker } from 'react-native-maps';
import { STORY_LIKE } from '@/components/storyReactions';
import {
    IconBookmark,
    IconCalendar,
    IconMusic,
    IconPeople,
} from '@/components/ui/icons';
import { iconForInterest } from '@/components/ui/interestIcons';
import {
    CAPTION_GAP,
    CAPTION_H,
    isDrawable,
    offsetByMeters,
    type FanResult,
    type GeoPoint,
} from '@/services/markerLayout';
import { withAlpha } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { motionLabel, presenceLabel, type MotionClass, type Presence } from '@/services/presence';
import { PresenceDot } from '@/components/PresenceDot';
import {
    type PinnedPlace,
} from '@/services/pinnedPlaces';
import { useSmoothedPosition } from '@/services/positionSmoothing';
import { fmtRadius } from '@/services/zoneAudio';
import type { Story } from '@/services/stories';
import type {
    ClubMeetup,
    NearbyUser,
} from '@/services/mapTypes';

import { DOT_HALO, DOT_HALO_ICON } from '@/components/map/mapConstants';
import { makeStyles } from '@/components/map/mapStyles';
import { avatarBgColor, pinTint } from '@/components/map/mapFormat';

// ─── PARKED_MARKERS ───────────────────────────────────────────────────────────
/*
 * Why markers on this map are parked instead of unmounted.
 *
 * `react-native-maps` cannot reliably remove a child from the native map under
 * the New Architecture. Fabric's interop layer loses track of custom children
 * (`MapView → Marker → custom view`), logs `removeViewAt: view already removed
 * from parent!`, and the removal never reaches `MapView.removeFeatureAt` — so
 * the marker stays on the GoogleMap forever, long after React has forgotten it.
 * Upstream: react-native-maps#5736, open, still present in 1.26.x, so upgrading
 * is not the way out. `newArchEnabled: false` would be, at the cost of the rest
 * of the app.
 *
 * The layout is what makes this visible. Pinching folds people into a headcount
 * and opens them out again, and each fold unmounts a handful of markers: zoom
 * out and the faces stay behind under the new badge, zoom back in and the badge
 * stays behind on top of the faces. That second one is the bug as reported —
 * "the number is still on the map" — and `layoutMarkers` was never at fault.
 *
 * So nothing this layout controls is ever unmounted. A marker with no one to
 * draw goes transparent and shrinks to `parkedMarker`, keeping its slot in the
 * child list; badges and leader lines come from fixed pools of slots that grow
 * but never shrink. React then only ever *updates* map children while the
 * camera moves, and update is the path that works.
 *
 * Markers do still unmount when someone leaves `visibleNearby` entirely, which
 * is a poll-rate event rather than a per-frame one. Same latent bug, far rarer;
 * worth pooling too if stale faces ever show up.
 */

/** Avatar URLs that have decoded at least once this session.
 *
 * Module-level on purpose: it has to outlive the markers themselves, because
 * the whole point is surviving an unmount. Grows with the number of distinct
 * people seen on one run of the app — a few hundred strings at worst — and is
 * discarded with the process. */
const loadedAvatars = new Set<string>();



/**
 * Marker draw order.
 *
 * Self sits at the *bottom*. It is the biggest thing on the map — a 54 px halo
 * — and at the default zoom (~2 m per pixel) that covers everyone within about
 * 50 m of you. Drawing it on top meant a stranger standing right next to you
 * was hidden behind your own marker until you zoomed in far enough to pull the
 * two apart. You always know where you are; the map is for everyone else.
 */
const Z_SELF = 1;
//: Above the circles it labels, below every person on the map — a label for a
//: zone must never be the thing covering someone standing in it.
const Z_MUSIC = 2;
const Z_STRANGER = 4;
const Z_FRIEND = 5;
/** Above the people it stands in for: while a pile is collapsed, the badge is
 *  the only thing there is to hit. */
const Z_CLUSTER = 6;
const Z_STORY   = 7;
const Z_MEETUP  = 8;
/** Above the meetup pins it can sit on top of. A pinned place is the one thing
 *  on this map the viewer put there themselves, so when two markers land on the
 *  same spot theirs is the one that should be tappable. */
const Z_PIN     = 9;

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * `tracksViewChanges` for a marker whose bitmap depends on `key`.
 *
 * react-native-maps rasterizes a marker's children and then freezes the result,
 * so anything that changes what the marker should look like has to re-arm
 * tracking or it keeps drawing the picture it froze first.
 *
 * Phrased as "the key I last settled on is not the key I am drawing now", which
 * means a changed key re-arms tracking in the *same* render that changes it.
 * The older shape — a flag flipped back to true inside an effect — repainted
 * every affected marker a second time on every poll, and on a busy map that is
 * a full extra rasterization pass for each of them.
 */
function useMarkerSettle(key: string, settleMs = 400) {
  const [settledKey, setSettledKey] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSettledKey(key), settleMs);
    return () => clearTimeout(t);
  }, [key, settleMs]);

  return {
    settling: settledKey !== key,
    /** For markers that know they have finished drawing before the timer. */
    markSettled: () => setSettledKey(key),
  };
}

/**
 * A matched stranger.
 *
 * They stay anonymous — no photo, no name, nothing to screenshot — but not
 * unexplained. A stranger is only on this map because you share an interest
 * with them (see `visibleNearby`), and until now that reason was invisible:
 * the map showed a lit dot with no way to tell why it was there, or what the
 * two of you had in common, short of tapping it.
 *
 * So the dot carries the interest itself. That is the one thing about them
 * which is safe to show, because it is not really about them — it is the
 * overlap, and you already know your own half of it.
 */
/**
 * The word under a marker, with an optional coloured suffix.
 *
 * Shared by the dot and the avatar because they render the same thing for
 * different reasons — "+2 more shared interests" on one, "· zone" on the other
 * — and the caption has to keep the same height in both or a mixed map reads
 * as two different kinds of pin.
 */
function MarkerCaption({ text, tag, tagColor }: {
  text?: string;
  tag?: string;
  tagColor: string;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  if (!text) return null;
  return (
    <View style={styles.markerCaption}>
      <Text style={styles.markerCaptionText} numberOfLines={1}>
        {text}
        {tag ? <Text style={[styles.markerCaptionTag, { color: tagColor }]}>{tag}</Text> : null}
      </Text>
    </View>
  );
}

/**
 * The picture inside an avatar marker's ring, or the coloured initial that
 * stands in for it.
 *
 * `uri` arrives already blanked when a load has failed, so the fallback here is
 * the single "no picture to show" path — a missing uri and a broken one look
 * the same to the person reading the map.
 */
function AvatarFace({ uri, username, inner, onLoaded, onFailed }: {
  uri?: string;
  username: string;
  inner: number;
  onLoaded: (uri: string) => void;
  onFailed: (uri: string) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const round = { width: inner, height: inner, borderRadius: inner / 2 };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={round}
        onLoad={() => onLoaded(uri)}
        onError={() => onFailed(uri)}
      />
    );
  }

  return (
    <View style={[styles.avatarMarkerFallback, round, { backgroundColor: avatarBgColor(username) }]}>
      <Text style={styles.avatarMarkerInitial}>
        {username ? username.charAt(0).toUpperCase() : '?'}
      </Text>
    </View>
  );
}

/** What a stranger's dot announces to a screen reader. */
function dotAccessibilityLabel(primary?: string, extra = 0): string {
  if (!primary) return 'Someone nearby with a shared interest';
  const more = extra > 0 ? `, and ${extra} more shared` : '';
  return `Someone nearby who also likes ${primary}${more}`;
}

/**
 * The lit disc itself: bloom, core and presence pip.
 *
 * Split from `DotMarker` so that component is only about where the marker sits
 * and when it re-rasterizes, while this one is only about what it looks like.
 */
function DotGlyph({ color, haloH, presence, InterestIcon }: {
  color: string;
  haloH: number;
  presence?: Presence;
  InterestIcon: ReturnType<typeof iconForInterest> | null;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.dotWrap, { width: haloH, height: haloH }]}>
      {/* Two discs, not one: a wide faint bloom and a tighter brighter one,
          which is what makes the dot read as lit from within rather than as
          a flat circle sitting on the map. */}
      <View style={[styles.dotBloom, { width: haloH, height: haloH, borderRadius: haloH / 2, backgroundColor: color }]} />
      {InterestIcon ? (
        <View style={[styles.dotIconCore, { borderColor: color, boxShadow: `0 0 5px ${withAlpha(color, 0.9)}` }]}>
          {InterestIcon({ size: 13, color })}
        </View>
      ) : (
        <>
          <View style={[styles.dotGlow, { backgroundColor: color }]} />
          <View style={[styles.userDot, { backgroundColor: color, boxShadow: `0 0 5px ${withAlpha(color, 0.9)}` }]} />
        </>
      )}
      {/* Absent presence renders nothing — PresenceDot returns null — so a
          hidden state never becomes a visible "offline". */}
      <View style={[styles.dotPresence, InterestIcon && styles.dotPresenceIcon]}>
        <PresenceDot presence={presence} size={8} haloColor={colors.bg} />
      </View>
    </View>
  );
}

function DotMarker({
  coordinate, color, presence, zIndex, sharedInterests, showCaption = true, parked, onPress,
}: {
  coordinate: { latitude: number; longitude: number };
  color: string;
  presence?: Presence;
  zIndex?: number;
  /** Interests you both have. First one is shown; the rest become a count. */
  sharedInterests?: string[];
  /** False when this dot shares its spot with others — the glyph stays, the
   *  word under it goes. See `FanResult.crowded`. */
  showCaption?: boolean;
  /** This person is inside a headcount badge right now. Drawn as nothing rather
   *  than unmounted — see `PARKED_MARKERS`. */
  parked?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // Re-arm tracking briefly when the color changes (friend data arrives after
  // the first nearby fetch), then freeze the rasterized marker again.
  // Presence is in the same bucket: it changes the rasterized bitmap, so it has
  // to re-arm too, but only when it actually flips — not on every poll.
  const online = presence?.is_online;
  const primary = sharedInterests?.[0];
  const extra = Math.max((sharedInterests?.length ?? 0) - 1, 0);
  const InterestIcon = primary ? iconForInterest(primary) : null;
  /** The word under the dot. Suppressed in a pile — see `showCaption`. */
  const captionText = showCaption ? primary : undefined;

  // `primary` belongs in the key with the rest: the marker freezes its own
  // bitmap once settled, so an interest that arrives on a later poll — the
  // first one can land before the interest data does — would otherwise never be
  // drawn at all. `parked` for the same reason: the dot has to redraw as the
  // empty spacer on the way in, and as itself on the way back out.
  const { settling } = useMarkerSettle(
    `${color}|${online}|${primary}|${extra}|${captionText}|${parked}`,
  );

  // The glyph needs a bigger core to sit in than a bare point does, and the
  // caption makes the marker taller than its halo — so the anchor moves off
  // centre to keep the *dot* over the coordinate rather than the whole box.
  const haloH = primary ? DOT_HALO_ICON : DOT_HALO;
  const totalH = captionText ? haloH + CAPTION_GAP + CAPTION_H : haloH;

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: (haloH / 2) / totalH }}
      tracksViewChanges={settling}
      opacity={parked ? 0 : 1}
      zIndex={zIndex}
      accessibilityLabel={parked ? undefined : dotAccessibilityLabel(primary, extra)}
      onPress={parked ? undefined : onPress}
    >
      {parked ? <View style={styles.parkedMarker} /> : (
      /* Android clips marker children to their parent box when it rasterizes,
         so the halo and the caption both have to live inside this column. */
      <View style={styles.dotColumn}>
        <DotGlyph
          color={color}
          haloH={haloH}
          presence={presence}
          InterestIcon={InterestIcon}
        />
        <MarkerCaption
          text={captionText}
          tag={extra > 0 ? ` +${extra}` : undefined}
          tagColor={color}
        />
      </View>
      )}
    </Marker>
  );
}

interface AvatarMarkerProps {
  coordinate: { latitude: number; longitude: number };
  uri?: string;
  username: string;
  ringColor: string;
  size?: number;
  zIndex?: number;
  presence?: Presence;
  motion?: MotionClass;
  /** Shown under the ring. Someone whose face you are allowed to see is someone
   *  whose name you are allowed to see, so the marker says both. */
  caption?: string;
  /** Appended to the caption in the ring colour — "· zone" when they are
   *  broadcasting, which is the one thing worth walking towards. */
  captionTag?: string;
  /** This person is inside a headcount badge right now. Drawn as nothing rather
   *  than unmounted — see `PARKED_MARKERS`. */
  parked?: boolean;
  onPress?: () => void;
}

/** Caption geometry, needed up front: the anchor has to be computed from the
 *  full marker height so the ring — not the whole box — sits on the point. */

function AvatarMarker({
  coordinate,
  uri,
  username,
  ringColor,
  size = 40,
  zIndex,
  presence,
  motion,
  caption,
  captionTag,
  parked,
  onPress,
}: AvatarMarkerProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // Markers rasterize their children: keep tracking until the remote image is
  // drawn, and re-arm briefly when the ring color changes (friend data arrives
  // after the first nearby fetch).
  // Seeded from `loadedAvatars`, which is why avatars stopped blinking.
  //
  // Being folded into a headcount badge no longer unmounts this marker — it
  // parks, see `PARKED_MARKERS` — so `imageReady` survives a pinch outright.
  // `loadedAvatars` still earns its keep for the mounts that remain: someone
  // walking back into `visibleNearby` comes back already wearing their face
  // instead of flashing a blank ring while a cached picture decodes again.
  // Tagged with the uri it describes rather than reset by an effect when the
  // uri changes. The effect version was a render late, so a marker whose
  // picture changed showed the previous person's face inside the new ring for
  // a frame before blanking.
  const [load, setLoad] = useState<{ uri?: string; ready: boolean; failed: boolean }>(
    () => ({ uri, ready: !uri || loadedAvatars.has(uri), failed: false }),
  );
  const loadIsCurrent = load.uri === uri;
  const imageReady  = loadIsCurrent ? load.ready  : !uri || loadedAvatars.has(uri);
  const imageFailed = loadIsCurrent ? load.failed : false;

  // Safety valve. `tracksViewChanges` below is `!imageReady` — true, and the
  // marker re-rasterizing every frame, for as long as this stays false. A uri
  // whose fetch neither loads nor errors (a stalled CDN, a host that hangs
  // rather than 404s) would otherwise leave that running forever, which is
  // the exact "re-rasterizing until it runs out of memory" crash the fan
  // logic elsewhere in this file already has scars from — see the badgeKey
  // comment in services/markerLayout.ts. Giving up after a few seconds trades
  // a permanently-blank avatar for an app that stays open.
  useEffect(() => {
    if (imageReady) return;
    const timer = setTimeout(() => setLoad({ uri, ready: true, failed: true }), 8000);
    return () => clearTimeout(timer);
  }, [uri, imageReady]);

  const online = presence?.is_online;

  // Presence changes the bitmap too, so it re-arms tracking — but keyed on the
  // boolean, not the object, so a poll that returns an equal presence does not
  // re-rasterize every avatar on the map. Parking is a bitmap change as well:
  // the ring has to redraw as the empty spacer, and back again.
  const { settling: ringSettling } = useMarkerSettle(`${ringColor}|${online}|${parked}`);

  // The trail is decorative and hidden from assistive tech, so the state it
  // conveys is spelled out here instead — motion must never be carried by the
  // effect alone.
  const label = [username, captionTag, presenceLabel(presence), motionLabel(motion)]
    .filter(Boolean)
    .join(', ');

  const inner = size - 6;

  // With a caption the marker is taller than the ring, and anchoring by the
  // box's centre would float the ring above the point it belongs to. Anchor on
  // the ring's centre instead, expressed as a fraction of the full height.
  const totalH = caption ? size + CAPTION_GAP + CAPTION_H : size;
  const anchorY = (size / 2) / totalH;

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: anchorY }}
      tracksViewChanges={!imageReady || ringSettling}
      opacity={parked ? 0 : 1}
      zIndex={zIndex}
      accessibilityLabel={parked ? undefined : label}
      onPress={parked ? undefined : onPress}
    >
      {parked ? <View style={styles.parkedMarker} /> : (
      /* Column wrapper: Android clips marker children to the parent box when
         it rasterizes, so the caption has to live inside it. */
      <View style={styles.avatarMarkerWrap}>
        <View style={[styles.avatarMarkerRing, { width: size, height: size, borderRadius: size / 2, borderColor: ringColor }]}>
          <AvatarFace
            uri={imageFailed ? undefined : uri}
            username={username}
            inner={inner}
            onLoaded={(loadedUri) => {
              loadedAvatars.add(loadedUri);
              setTimeout(() => setLoad({ uri: loadedUri, ready: true, failed: false }), 250);
            }}
            onFailed={(failedUri) => setLoad({ uri: failedUri, ready: true, failed: true })}
          />
          <View style={styles.markerPresence}>
            <PresenceDot presence={presence} size={10} haloColor={colors.bg} />
          </View>
        </View>

        <MarkerCaption
          text={caption}
          tag={captionTag ? ` · ${captionTag}` : undefined}
          tagColor={ringColor}
        />
      </View>
      )}
    </Marker>
  );
}

/**
 * The owner's own marker.
 *
 * Everyone else on this map is either a bare dot or an avatar in a coloured
 * ring, so "me" cannot just be one more of those in a different colour — at a
 * glance it reads as another person standing where you are. It gets the halo
 * idiom every map uses for self instead: a soft disc under a ringed core,
 * which nothing else on this map has, in the same purple as the owner's own
 * zone circle.
 */
export function SelfMarker({ coordinate, uri, username, hidden = false }: {
  coordinate: { latitude: number; longitude: number };
  uri?: string;
  username: string;
  /** True while sharing is Paused — nobody else has this marker on their map. */
  hidden?: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  // Where the dot is drawn: the smoothed position when there is one, and the
  // laid-out coordinate until the first fix has been through the smoother.
  // Falling back rather than waiting matters on the very first frame, when a
  // cached position can put the marker on screen before any fix has landed.
  const smoothed = useSmoothedPosition();
  const drawnAt = smoothed ?? coordinate;
  // Same shape as AvatarMarker: the load state carries the uri it belongs to,
  // so changing your own picture is not a reset an effect has to perform.
  // Seeded from `loadedAvatars`, same as AvatarMarker — without it, a remount
  // (e.g. the map view remounting after a screen pushed on top of it, such as
  // Zone Size, is popped) forgets the picture was already decoded and blanks
  // the ring until it loads again, which read as the avatar vanishing.
  const [load, setLoad] = useState<{ uri?: string; ready: boolean; failed: boolean }>(
    () => ({ uri, ready: !uri || loadedAvatars.has(uri), failed: false }),
  );
  const loadIsCurrent = load.uri === uri;
  const imageReady  = loadIsCurrent ? load.ready  : !uri || loadedAvatars.has(uri);
  const imageFailed = loadIsCurrent ? load.failed : false;

  // Safety valve, same as AvatarMarker: a uri that never resolves (loads or
  // errors) would otherwise leave `tracksViewChanges` true — and this marker
  // re-rasterizing every frame — forever, which is the exact "runs out of
  // memory" crash shape services/markerLayout.ts already documents scars
  // from. This is the owner's own marker, on screen every time the map is
  // open, so it is the one most exposed to a hung fetch running indefinitely.
  useEffect(() => {
    if (imageReady) return;
    const timer = setTimeout(() => setLoad({ uri, ready: true, failed: true }), 8000);
    return () => clearTimeout(timer);
  }, [uri, imageReady]);

  // Pausing mutes the halo and the core, and react-native-maps caches this
  // marker as a bitmap — so the change has to re-arm tracking or the old frame
  // stays on screen and the halo never changes colour.
  //
  // This used to be done by flipping the `key` between 'self-hidden' and
  // 'self-visible'. That does not re-rasterize anything; it unmounts the marker
  // and mounts a new one, and per `PARKED_MARKERS` an unmounted marker is never
  // removed from the native map. Checking in left the paused avatar sitting
  // there next to the live one — two of you, one greyed out. Same fix as every
  // other marker here: keep one Marker mounted and let `tracksViewChanges`
  // redraw it.
  const { settling } = useMarkerSettle(`${hidden}`);

  return (
    <Marker
      coordinate={drawnAt}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={Z_SELF}
      // Unchanged by the smoothing, and worth saying why: this is what the
      // marker *looks like*, not where it is. Moving a Marker's coordinate
      // does not re-rasterize its view, so a position arriving fifteen times a
      // second costs a native coordinate update and nothing else. Flipping
      // this to true for the movement would redraw the avatar every frame —
      // the memory shape services/markerLayout.ts has scars from.
      tracksViewChanges={!imageReady || settling}
    >
      <View style={[styles.selfHalo, hidden && styles.selfHaloHidden]}>
        <View style={[styles.selfCore, hidden && styles.selfCoreHidden]}>
          {uri && !imageFailed ? (
            <Image
              source={{ uri }}
              style={styles.selfAvatar}
              onLoad={() => {
                loadedAvatars.add(uri);
                setTimeout(() => setLoad({ uri, ready: true, failed: false }), 250);
              }}
              onError={(e) => {
                console.log('[Map] self avatar Image failed to load:', uri, e?.error);
                setLoad({ uri, ready: true, failed: true });
              }}
            />
          ) : (
            <View style={[styles.selfAvatar, styles.selfInitialWrap]}>
              <Text style={styles.selfInitial}>
                {username ? username.charAt(0).toUpperCase() : '·'}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Marker>
  );
}

/**
 * What a pile becomes when it cannot be fanned apart — a headcount.
 *
 * Deliberately faceless. A pile at this zoom is usually strangers, and a stack of
 * little avatars would hand out the photos the map withholds until a Hi is
 * mutual. A number gives the one thing worth knowing from this far out — how many
 * people are over there — and tapping goes in for the detail.
 */
/**
 * The label that makes a music zone legible as one.
 *
 * A second ring around a person is otherwise just another ring — the map is
 * full of circles, and "this one is how far the sound carries" is not
 * something a stroke colour can say. So the ring is drawn faintly and a small
 * note-and-distance chip sits on its edge, which is where the two facts people
 * actually want live: that it is music, and where it stops.
 *
 * Pinned due north of the centre so it lands on the ring itself rather than
 * floating near it, and so two zones on top of each other stack their labels
 * in a readable column instead of overlapping at the same point.
 */
export function MusicZoneBadge({ center, radius, mine, label, color, parked }: {
  center: GeoPoint;
  radius: number;
  mine?: boolean;
  /** What the chip says: a friend's @name, or your own reach. */
  label: string;
  /** The ring's colour, repeated here so the chip and the circle it labels are
   *  visibly one thing when several overlap. */
  color: string;
  /** Slot currently standing in for no music zone — see `PARKED_MARKERS`. The
   *  ring beside it is a Circle and removes itself cleanly; this chip is a
   *  Marker with a custom child, which is exactly the thing Fabric strands on
   *  the native map. Switching a music zone off has to take the label with the
   *  circle, so the slot parks rather than unmounting. */
  parked?: boolean;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // Same reason as ClusterMarker: let it draw, then freeze the raster — and
  // re-arm on every input that changes what the chip says, or a zone resized or
  // recoloured mid-session keeps drawing the label it first froze. Parking is
  // in the key for the same reason it is in ClusterMarker's: a slot that goes
  // quiet has to redraw as the empty spacer or it keeps drawing the last chip.
  const { settling } = useMarkerSettle(`${radius}|${label}|${color}|${parked}`);

  return (
    <Marker
      coordinate={offsetByMeters(center, radius, 0)}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={settling}
      opacity={parked ? 0 : 1}
      zIndex={Z_MUSIC}
      accessibilityLabel={
        parked
          ? undefined
          : mine
            ? `Your music carries ${fmtRadius(radius)}`
            // The name goes first: a screen reader arriving at this chip is
            // answering "whose zone is this", same as the colour does visually.
            : `${label}'s music zone, ${fmtRadius(radius)} across`
      }
    >
      {parked ? (
        <View style={styles.parkedMarker} />
      ) : (
        <View style={[styles.musicBadge, { borderColor: withAlpha(color, 0.55) }]}>
          <IconMusic size={10} color={color} />
          <Text style={[styles.musicBadgeText, { color }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Marker>
  );
}

export function ClusterMarker({ coordinate, count, parked, onPress }: {
  coordinate: { latitude: number; longitude: number };
  count: number;
  /** Slot currently standing in for no pile — see `PARKED_MARKERS`. */
  parked?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // Same reason as DotMarker: freeze the raster, but not before it has drawn.
  //
  // Re-arming is the point. Without it the badge froze its first bitmap for
  // good: a pile that gained or lost someone kept drawing its old number,
  // because the timer had already fired and nothing ever re-armed tracking.
  // Parking is in the key too — a slot that goes quiet has to redraw as the
  // empty spacer, or it keeps a headcount's worth of tap target sitting on the
  // map.
  const { settling } = useMarkerSettle(`${count}|${parked}`);

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={settling}
      opacity={parked ? 0 : 1}
      zIndex={Z_CLUSTER}
      onPress={parked ? undefined : onPress}
      accessibilityLabel={
        parked ? undefined : `${count} ${count === 1 ? 'person' : 'people'} here. Zoom in to see them.`
      }
    >
      {parked ? (
        <View style={styles.parkedMarker} />
      ) : (
        <View style={styles.clusterWrap}>
          <View style={styles.clusterBloom} />
          <View style={styles.clusterBadge}>
            <IconPeople size={12} color={colors.teal} />
            <Text style={styles.clusterCount}>{count}</Text>
          </View>
        </View>
      )}
    </Marker>
  );
}

function StoryBubble({ story, count, onAvatarLoad }: { story: Story; count: number; onAvatarLoad?: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const avatarBg = avatarBgColor(story.author.username);

  const likeCount = story.reactions?.like ?? 0;

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={styles.storyCard}>
        {/* The badge is a sibling of the clipped avatar, not a child of it.
            Inside `storyAvatarWrap` — which is a circle with overflow hidden —
            a badge in the corner is cut in half by the curve. */}
        <View style={styles.storyAvatarStack}>
          <View style={styles.storyAvatarWrap}>
            {story.author.profile_picture ? (
              <Image
                source={{ uri: story.author.profile_picture }}
                style={styles.storyCardAvatarImg}
                onLoad={onAvatarLoad}
              />
            ) : (
              <View style={[styles.storyCardAvatar, { backgroundColor: avatarBg }]}>
                <Text style={styles.storyCardAvatarText}>{story.author.username.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </View>
          {count > 1 && (
            <View style={styles.storyCountBadge}>
              <Text style={styles.storyCountText}>{count}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.storyCardTail} />
      {likeCount > 0 && (
        <View style={styles.storyReactionPill}>
          {/* Through `STORY_LIKE` rather than naming an icon here, so the
              badge and the viewer's own button cannot end up showing two
              different symbols for the same act. Solid: at 11px an outline
              heart closes up into a blob. */}
          <STORY_LIKE.Icon size={11} color={colors.t2} filled />
          <Text style={styles.storyReactionText}>{likeCount}</Text>
        </View>
      )}
    </View>
  );
}

export function StoryMarker({ stories, onPress }: { stories: Story[]; onPress: () => void }) {
  const first = stories[0];
  // With `tracksViewChanges` permanently false the marker is snapshotted on
  // first render — before the avatar arrives — and stays blank forever. Track
  // until the image load fires (or a fallback timeout for letter avatars and
  // failed loads), and re-track for a beat whenever the bubble's content
  // changes so new stories and reaction counts actually repaint.
  const signature = `${first.id}:${stories.length}:${first.author.profile_picture ?? ''}:${JSON.stringify(first.reactions ?? {})}`;
  const { settling: tracks, markSettled } = useMarkerSettle(signature, 3000);

  // One frame after load isn't enough on Android — give the draw a moment
  // before freezing the snapshot.
  const settle = () => { setTimeout(markSettled, 300); };

  return (
    <Marker
      coordinate={{ latitude: first.latitude, longitude: first.longitude }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracks}
      zIndex={Z_STORY}
      onPress={onPress}
    >
      <StoryBubble story={first} count={stories.length} onAvatarLoad={settle} />
    </Marker>
  );
}

// ─── Meetup Marker ────────────────────────────────────────────────────────────
export function MeetupMarker({ meetup, pinned, onPress }: {
  meetup: ClubMeetup;
  /** The viewer said they are going. Drawn as a corner on the pin rather than
   *  a second marker at the same coordinate — see `PinnedLayer`, which leaves
   *  a pinned meetup to this marker for as long as the event is still on the
   *  map at all. */
  pinned?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // The corner is part of the frozen bitmap, so pinning has to re-arm tracking
  // or the marker keeps drawing the picture it took before the press.
  const { settling } = useMarkerSettle(`${meetup.id}|${pinned}`);
  return (
    <Marker
      coordinate={{ latitude: meetup.latitude, longitude: meetup.longitude }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={settling}
      zIndex={Z_MEETUP}
      onPress={onPress}
      accessibilityLabel={
        pinned ? `${meetup.title}. You are going.` : meetup.title
      }
    >
      <View style={styles.meetupMarkerWrap}>
        <View style={styles.meetupMarkerBubble}>
          {meetup.club_emblem ? (
            <Image source={{ uri: meetup.club_emblem }} style={styles.meetupMarkerImg} />
          ) : (
            <IconCalendar size={18} color="#fff" />
          )}
          {pinned ? (
            <View style={styles.goingCorner}>
              <IconBookmark size={10} color={colors.purple} filled />
            </View>
          ) : null}
        </View>
        <View style={styles.meetupMarkerTail} />
      </View>
    </Marker>
  );
}

export function PinnedMarker({ place, parkedAt, parked, onPress }: {
  place: PinnedPlace | null;
  /** Where an empty slot sits: the viewer's own position, the same as every
   *  other parked slot on this map. Somewhere real and on screen, rather than
   *  the null island a `{ 0, 0 }` fallback would strand it at. */
  parkedAt: GeoPoint;
  /** Nothing to draw in this slot. Parked rather than unmounted — see
   *  PARKED_MARKERS. Unpinning is rare, but it is exactly the case Fabric
   *  strands: a custom view inside a Marker, removed while the map is alive,
   *  which would leave the pin on screen after the user deleted it. */
  parked: boolean;
  onPress: (place: PinnedPlace) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { settling } = useMarkerSettle(`${place?.id ?? 'none'}|${parked}`);
  const tint = place ? pinTint(place, colors) : colors.teal;

  // A parked slot still needs somewhere to be: the position it held went with
  // the pin, so it sits on the viewer under a transparent, untappable, 1pt
  // view.
  const coordinate = place
    ? { latitude: place.latitude, longitude: place.longitude }
    : parkedAt;

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={settling}
      zIndex={Z_PIN}
      opacity={parked ? 0 : 1}
      onPress={parked || !place ? undefined : () => onPress(place)}
      accessibilityLabel={parked || !place ? undefined : `Pinned: ${place.title}`}
    >
      {parked || !place ? (
        <View style={styles.parkedMarker} />
      ) : (
        <View style={styles.pinnedMarkerWrap}>
          <View style={[styles.pinnedMarkerBubble, { borderColor: tint }]}>
            {place.kind === 'meetup'
              ? <IconCalendar size={16} color={tint} />
              : <IconBookmark size={16} color={tint} filled />}
          </View>
          <View style={[styles.pinnedMarkerTail, { borderColor: tint }]} />
        </View>
      )}
    </Marker>
  );
}

/**
 * One person on the map, as either a face or a lit point.
 *
 * Anyone you have a name for gets a face and a name plate — blue ring for a
 * friend, orange for a connection. Strangers stay a lit point: no photo, no
 * name, nothing to screenshot, until the Hi is mutual and they cross into the
 * row above.
 */
export function PersonMarker({ user, layout, isFriend, isConnected, color, onPress }: {
  user: NearbyUser;
  /** Absent means this person was folded into a headcount badge. */
  layout: FanResult | undefined;
  isFriend: boolean;
  isConnected: boolean;
  color: string;
  onPress: () => void;
}) {
  // Absent from `placed` means this person was folded into a headcount
  // badge. Drawing them as well would put two of them on the map — so
  // the marker parks: transparent, untappable, still mounted. The
  // unmount it replaces is the one that left a face behind under the
  // badge on every pinch. See PARKED_MARKERS.
  const truePos = { latitude: user.latitude, longitude: user.longitude };
  const parked = !layout || !isDrawable(layout.position);
  // Nowhere legal to stand at all: the one case still worth skipping,
  // since a Marker needs a coordinate the native map can survive.
  if (parked && !isDrawable(truePos)) return null;
  const position = parked ? truePos : layout!.position;

  return isFriend || isConnected ? (
    <AvatarMarker
      coordinate={position}
      parked={parked}
      uri={user.profile_picture}
      username={user.username}
      ringColor={color}
      presence={user.presence}
      motion={user.motion_class}
      // Dropped when this marker shares its spot: the fan separates
      // rings, and a name chip is wider than the ring it hangs under.
      caption={layout?.crowded ? undefined : user.username}
      // Friends and connections both have zone access. The tag
      // marks a track you can play, so it follows the track rather
      // than the map-zone switch.
      captionTag={!layout?.crowded && user.zone_audio_url ? 'zone' : undefined}
      zIndex={Z_FRIEND}
      onPress={onPress}
    />
  ) : (
    <DotMarker
      coordinate={position}
      parked={parked}
      color={color}
      presence={user.presence}
      sharedInterests={user.shared_interests}
      // The interest *name* is this marker's caption and the widest
      // thing it draws — four of them stacked down a street is what
      // made the map unreadable. The glyph inside the dot still says
      // which interest it is, so only the word goes.
      showCaption={!layout?.crowded}
      zIndex={Z_STRANGER}
      onPress={onPress}
    />
  );
}
