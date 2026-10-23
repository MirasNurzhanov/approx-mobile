// Everything drawn over the map rather than on it: the top bar, the locate
// button, the permission gate, notices and toasts. Moved out of
// app/(tabs)/map.tsx unchanged.

import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassBackdrop, GlassSurface } from '@/components/ui/GlassSurface';
import {
    IconBookmark,
    IconChevron,
    IconGhost,
    IconHi,
    IconList,
    IconLocate,
    IconLocateFixed,
    IconLocateOff,
    IconMusic,
    IconPeople,
    IconPin,
    IconSearch,
} from '@/components/ui/icons';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import type { ZoneRetryState } from '@/hooks/useMapData';
// `PermissionState` explicitly, not the DOM global of the same name — that one
// is 'granted' | 'denied' | 'prompt', so leaving it unimported makes the
// `=== 'blocked'` checks below silently type-error instead of resolving here.
import { type PermissionState } from '@/services/permissions';
import { type LocateState } from '@/hooks/useMapLocation';
import { MAINLAND_CHINA_NOTICE } from '@/services/gcj02';

import { makeStyles, type MapStyles } from '@/components/map/mapStyles';

// ─── Locate control ───────────────────────────────────────────────────────────
// `LocateState` itself lives with the camera it describes, in
// hooks/useMapLocation — this is only what the button draws for each state.

/** Written as what tapping does, since that is what changes on activation. */
const LOCATE_LABEL: Record<LocateState, string> = {
  off:         'Center on my location',
  following:   'Following your location, tap to stop',
  locating:    'Finding your location',
  unavailable: 'Location unavailable, tap to find out why',
};

const LOCATE_HINT: Record<LocateState, string | undefined> = {
  off:         'Moves the map to where you are and keeps it there as you move',
  following:   undefined,
  locating:    undefined,
  unavailable: 'Approx does not have permission to use your location',
};

export function LocateButton({
  state,
  bottom,
  right,
  onPress,
}: {
  state: LocateState;
  bottom: number;
  /** Set by the screen, because where it lands depends on which nav is on —
   *  see `useNavAlignedRight`. */
  right: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const following = state === 'following';

  // The icon carries the state as a shape — a filled centre when tracking, a
  // slash when unavailable — so following is still legible without the teal.
  const Icon = following ? IconLocateFixed : state === 'unavailable' ? IconLocateOff : IconLocate;
  const tint = following ? colors.teal : state === 'unavailable' ? colors.t3 : colors.t2;

  return (
    <Pressable
      onPress={onPress}
      disabled={state === 'locating'}
      hitSlop={8}
      style={({ pressed }) => [
        styles.locateBtn,
        following && styles.locateBtnActive,
        { bottom, right },
        pressed && { opacity: 0.75 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={LOCATE_LABEL[state]}
      accessibilityHint={LOCATE_HINT[state]}
      // `selected` is what makes a screen reader say "on"/"off" for the two
      // live states. Unavailable is deliberately not `disabled`: it is still
      // the thing you tap to find out why, and disabled controls are skipped.
      accessibilityState={{ selected: following, busy: state === 'locating' }}
    >
      <GlassBackdrop />
      {following && <View style={[StyleSheet.absoluteFill, styles.locateTint]} />}
      {state === 'locating' ? (
        <ActivityIndicator size="small" color={colors.t2} />
      ) : (
        <Icon size={22} color={tint} />
      )}
    </Pressable>
  );
}

// ─── Top Bar ─────────────────────────────────────────────────────────────────
export function TopBar({
  nearby,
  pinCount,
  onPinned,
  onZoneMusic,
  onSearch,
  onList,
}: {
  /** How many places this viewer has pinned. The bookmark button is drawn only
   *  when there is at least one: an empty list behind a permanent button is a
   *  fourth control on a bar that already has three, bought with nothing. */
  pinCount: number;
  onPinned: () => void;
  nearby: number;
  onZoneMusic: () => void;
  onSearch: () => void;
  onList: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { top } = useSafeAreaInsets();
  return (
    <View style={[styles.topBar, { paddingTop: top + 6 }]}>
      <Text style={styles.topLogoText} accessibilityRole="header">APPROX</Text>

      {/* The count is the only part of the map a screen reader can reach, so
          it carries the plural and the unit rather than a bare number. */}
      <GlassSurface
        style={styles.nearbyBadge}
        accessible
        accessibilityLabel={`${nearby} ${nearby === 1 ? 'person' : 'people'} nearby`}
      >
        <IconPeople size={16} color={colors.t2} />
        <Text style={styles.nearbyBadgeText} importantForAccessibility="no">
          {nearby} nearby
        </Text>
      </GlassSurface>

      <View style={styles.topSpacer} />

      {pinCount > 0 && (
        <Pressable
          onPress={onPinned}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Pinned places, ${pinCount} saved`}
          accessibilityHint="Opens the places you saved from Swifts and meetups"
        >
          <GlassBackdrop />
          <IconBookmark size={20} color={colors.t2} filled />
        </Pressable>
      )}

      {/* Markers on a map cannot be focused or read. This is the same data as
          a linear list — the non-visual equivalent of the map itself. */}
      <Pressable
        onPress={onList}
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="People nearby, list view"
        accessibilityHint="Opens a readable list of everyone shown on the map"
      >
        <GlassBackdrop />
        <IconList size={20} color={colors.t2} />
      </Pressable>

      <Pressable
        onPress={onSearch}
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Search people and places"
      >
        <GlassBackdrop />
        <IconSearch size={20} color={colors.t2} />
      </Pressable>

      {/* A shield used to sit here, labelled "privacy and safety", and it
          opened Zone Music. The icon promised one screen and the tap gave
          another; the note is what is actually behind it. */}
      <Pressable
        onPress={onZoneMusic}
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Zone music"
        accessibilityHint="Choose what plays in your zone and how far it carries"
      >
        <GlassBackdrop />
        <IconMusic size={20} color={colors.t2} />
      </Pressable>
    </View>
  );
}

// The floating zone banner used to live here. It announced "you are in @x's
// zone" over the map and, with autoplay on, had already started their track by
// the time you read it. Both halves are gone: a zone is now something you open
// from the person it belongs to (see UserSheet), and it makes no sound until
// you press play.

// ─── Screen chrome ────────────────────────────────────────────────────────────
/*
 * The things drawn over the map rather than on it: the dead end that replaces
 * it, the notices strung under the top bar, the sheets, and the two toasts.
 *
 * Kept in three pieces rather than one because the tree order between them is
 * load-bearing — every one of these is absolutely positioned, so what is
 * written later sits on top. The toasts are last on purpose; folding them in
 * with the notices would put them under the sheets.
 */

/** No permission, and an explicit dead end with a way out — rather than a
 *  spinner that never resolves or a sentence with no action attached. */
export function MapPermissionGate({ permState, styles, onAllow, onList }: {
  permState: PermissionState;
  styles: MapStyles;
  onAllow: () => void;
  onList: () => void;
}) {
  const blocked = permState === 'blocked';
  return (
    <View style={styles.center} accessible accessibilityRole="alert">
      <Text style={styles.emptyTitle}>The map needs location access</Text>
      <Text style={styles.errorText}>
        {blocked
          ? 'Location is turned off for Approx in system settings. The map can’t show anyone nearby until it’s back on.'
          : 'Approx shows people with shared interests near you right now. Without location there’s nothing to show.'}
      </Text>
      <Pressable
        onPress={onAllow}
        style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={blocked ? 'Open system settings' : 'Allow location access'}
      >
        <Text style={styles.emptyBtnText}>{blocked ? 'Open Settings' : 'Allow location'}</Text>
      </Pressable>
      <Pressable
        onPress={onList}
        style={({ pressed }) => [styles.emptyLink, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel="Open the nearby people list instead"
      >
        <Text style={styles.emptyLinkText}>See nearby people as a list</Text>
      </Pressable>
    </View>
  );
}

/** The strip under the top bar, where the map explains itself. */
/** What the zone-boundary notice needs: the circle discovery fell back to,
 *  the place it should have covered, and where Retry stands. */
export interface ZoneFallbackNotice {
  radius: number;
  placeName: string;
  retry: ZoneRetryState;
}

function zoneFallbackSub(notice: ZoneFallbackNotice): string {
  const place = notice.placeName ? `${notice.placeName}’s area` : 'your city’s area';
  if (notice.retry === 'failed') return `Still couldn’t load ${place}. Try again in a little while.`;
  if (notice.retry === 'too_soon') return `Couldn’t load ${place} yet. Give it a few seconds.`;
  return `Couldn’t load ${place}, so you’re seeing less than your zone covers.`;
}

export function MapNotices({
  styles, colors, topInset, overlayTop, noticeTop, zoneNoticeTop,
  pending, ghostNotice, offsetNotice, zoneFallback, onOpenPrivacy, onRetryZone,
}: {
  styles: MapStyles;
  colors: ColorPalette;
  topInset: number;
  overlayTop: number;
  noticeTop: number;
  zoneNoticeTop: number;
  pending: boolean;
  ghostNotice: boolean;
  offsetNotice: boolean;
  /** Null unless discovery is on the fallback circle. */
  zoneFallback: ZoneFallbackNotice | null;
  onOpenPrivacy: () => void;
  onRetryZone: () => void;
}) {
  return (
    <>
      {/* Sharing is on, the first position has not landed, and the map is
          therefore empty for a reason that has nothing to do with who is
          around. Stated, because an unexplained empty map reads as a broken
          one — and because the honest answer is "not yet", not "nobody". */}
      {pending ? (
        <View
          style={[styles.pendingChip, { top: topInset + 52 }]}
          accessible
          accessibilityRole="alert"
        >
          <ActivityIndicator size="small" color={colors.t2} />
          <Text style={styles.pendingChipText}>Getting your location…</Text>
        </View>
      ) : null}

      {/* Ghost Mode, which is the reason this map is empty in *both*
          directions — and the one the screen would otherwise leave the user to
          work out for themselves. The muted self marker says it too, but only
          to somebody already looking at their own dot and already knowing what
          muted means.

          A route, not a write. Ghost Mode is a setting on the privacy screen,
          and keeping the write there rather than here means one screen owns it
          and the map cannot flip somebody's visibility as a side effect of
          drawing itself. */}
      {ghostNotice ? (
        <Pressable
          onPress={onOpenPrivacy}
          style={({ pressed }) => [
            styles.pausedNotice,
            { top: overlayTop },
            pressed && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Ghost Mode is on. Nobody can see you and you cannot see anyone. Opens privacy settings, where you can turn it off."
        >
          <IconGhost size={18} color={colors.t2} />
          <View style={styles.pausedNoticeText}>
            <Text style={styles.pausedNoticeTitle}>Ghost Mode is on</Text>
            <Text style={styles.pausedNoticeSub}>
              Nobody can see you, and you can’t see anyone. Tap to turn it off.
            </Text>
          </View>
          <IconChevron size={18} color={colors.t3} />
        </Pressable>
      ) : null}

      {/* The one place the map admits it is drawing on a shifted basemap.
          Stated rather than silently corrected: everything here — your dot,
          everyone else's, the zone outline — is in true GPS coordinates and
          agrees with itself, but the tiles underneath are offset. */}
      {offsetNotice ? (
        <View
          style={[styles.offsetNotice, { top: noticeTop }]}
          accessible
          accessibilityRole="alert"
        >
          <Text style={styles.offsetNoticeText}>{MAINLAND_CHINA_NOTICE}</Text>
        </View>
      ) : null}

      {/* A city or district zone whose boundary has not loaded, so discovery
          is answering from the circle. Said out loud: a quiet map here reads
          as nobody being around, when the truth is that we are looking at a
          fraction of the area the person chose. Retry fetches the boundary;
          the notice goes once it lands. */}
      {zoneFallback ? (
        <View
          style={[styles.pausedNotice, { top: zoneNoticeTop }]}
          accessible
          accessibilityRole="alert"
        >
          <View style={styles.pausedNoticeText}>
            <Text style={styles.pausedNoticeTitle}>
              Showing {zoneFallback.radius} m around you
            </Text>
            <Text style={styles.pausedNoticeSub}>{zoneFallbackSub(zoneFallback)}</Text>
          </View>
          {zoneFallback.retry === 'retrying' ? (
            <ActivityIndicator size="small" color={colors.t2} />
          ) : (
            <Pressable
              onPress={onRetryZone}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Retry loading your zone's area"
            >
              <Text style={[styles.pausedNoticeTitle, { color: colors.orange }]}>Retry</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </>
  );
}

/** Momentary confirmations, drawn above everything so a sheet cannot bury one. */
export function MapToasts({ styles, colors, top, hiToast, locationToast, locationless }: {
  styles: MapStyles;
  colors: ColorPalette;
  top: number;
  hiToast: boolean;
  locationToast: boolean;
  /** Whether the story being written will carry a pin. */
  locationless: boolean;
}) {
  return (
    <>
      {/* Hi sent toast */}
      {hiToast && (
        <View style={[styles.hiToast, { top }]} pointerEvents="none">
          <IconHi size={16} color={colors.teal} />
          <Text style={styles.hiToastText}>Hi sent</Text>
        </View>
      )}

      {/* Story location toast */}
      {locationToast && (
        <View style={[styles.hiToast, { top }]} pointerEvents="none">
          <IconPin size={16} color={colors.teal} />
          <Text style={styles.hiToastText}>
            {locationless
              ? 'Story will be shared with friends, without a map location'
              : 'Story will be posted at your current location'}
          </Text>
        </View>
      )}
    </>
  );
}
