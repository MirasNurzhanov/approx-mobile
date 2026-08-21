import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { runBusy } from '@/services/busy';
import { RadiusSlider } from '@/components/RadiusSlider';
import { ZonePlayer } from '@/components/ZonePlayer';
import { IconClose, IconInfo, IconLock, IconMusic, IconSound, IconUpload } from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { AppleMusicError, clearAppleZoneTrack } from '@/services/appleMusic';
import {
  refreshPrivacy,
  usePrivacySettings,
  type Audience,
} from '@/services/privacy';
import { fmtRadius, fmtTime, trackTitle } from '@/services/zoneAudio';
import { RADIUS_MAX_M, RADIUS_MIN_M } from '@/services/zoneArea';

// The music your zone carries: what plays, who is allowed to hear it, and a way
// to listen to it yourself before anyone else does.
//
// The zone and its music are two different things, and only the music is here.
// The zone is the radar — the circle that puts you on the map — and it is added
// and removed from Settings → Zone on the map, which is the single control for
// it. This screen never turns it off; removing your zone was never meant to be
// a way to change the track.
//
// The *zone's* radius is still not here — that dial lives on Zone Size, next to
// the place picker it shares a decision with. What is here is the music zone:
// its own switch and its own radius. People widen a zone to be found and narrow
// their music so only the next table hears it; one number could not serve both,
// so there are two circles and this screen owns the second one.
//
// There is one switch for it, not two. It used to be a mute called "Sound zone"
// sitting above a second switch that chose whether the music borrowed the map
// zone's radius instead of using its own — and a music zone that silently
// followed the map zone was indistinguishable from not having one. Now the
// switch means what it says: on draws a circle, off removes it from everyone's
// map, and the track and the radius wait untouched underneath for it to come
// back on.
//
// Two things can fill the one audio slot — an Apple Music track or an upload —
// and the last one picked wins. A zone plays one thing.
//
// Everything saves as you touch it — there is no separate Save step to leave
// a choice half-committed.

// ─── Types ────────────────────────────────────────────────────────────────────
interface ZoneState {
  zone_active?: boolean;
  /** Read here, never written: the size of your zone is not something this
   *  screen sets. Listed so the server's echo round-trips intact. */
  zone_radius?: number;
  zone_audio?: string | null;
  zone_audio_url?: string | null;
  /** Never read here, and listed only so the server's echo round-trips intact.
   *  The music zone is always a circle of its own, so nothing on this screen
   *  has to care whether the *map* zone is a radius or a city border. */
  effective_zone_mode?: 'radius' | 'region';

  /** The music zone's on/off, and the only one it has. Off means there is no
   *  music zone: nobody hears the track, nobody is alerted, and no circle is
   *  drawn on anyone's map — the owner's included. The track and the radius
   *  stay exactly as they were. Absent means on: it is the server's default,
   *  and a build that predates the field must not read a missing key as
   *  silence. */
  music_zone_active?: boolean;

  /** How far the music carries, which this screen *does* set. Always the music
   *  zone's own number — it never inherits `zone_radius`. */
  music_zone_radius?: number;
  music_zone_alerts?: boolean;

  zone_apple_id?: string;
  zone_apple_title?: string;
  zone_apple_artist?: string;
  zone_apple_artwork?: string;
  zone_apple_preview_url?: string;

  /** The slice that repeats. A null end means the whole track, which is what
   *  everyone gets until they open the trim editor. Set on /zone-trim, which
   *  is the only screen that can know how long the track is. */
  zone_track_start_ms?: number;
  zone_track_end_ms?: number | null;
}

/** Decorative level meter on the upload tile. Fixed shape: it stands for
 *  "audio goes here", it is not a reading of anything. */
// Bar heights carry an id because several repeat, so the height alone cannot
// identify a bar. Built once at module scope — the waveform is decorative and
// fixed, so these ids are stable for the life of the app.
const WAVE = [7, 13, 22, 15, 28, 20, 34, 24, 16, 27, 11, 20, 31, 18, 9, 15, 24, 13, 7, 17]
  .map((h, i) => ({ id: `wave-${i}`, h }));

// ─── Sections ─────────────────────────────────────────────────────────────────
// One component per band of the screen. The screen owns the zone state and the
// PATCHes; these only render it.

/** The track itself, the loop window, and who can hear it. */
function NowPlayingSection({ zone, audioUrl, title, musicRadius, silent, trimmed, audience, onEditLoop }: {
  zone: ZoneState;
  audioUrl: string | null;
  title: string | null;
  musicRadius: number;
  silent: boolean;
  trimmed: boolean;
  audience: Audience;
  onEditLoop: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>PLAYING IN YOUR ZONE</Text>

      {audioUrl ? (
        <ZonePlayer
          // Remounts when the track changes, so switching between an
          // upload and an Apple track can never leave the previous one
          // loaded.
          key={audioUrl}
          url={audioUrl}
          title={title ?? 'Zone audio'}
          artwork={zone.zone_apple_artwork}
          // The player still works with the music zone off — this is your own
          // track on your own screen, and the switch is about other people. The
          // subtitle is the only thing that changes, because "loops for anyone
          // within 200 m" would be describing something that is not happening.
          subtitle={
            silent
              ? 'Your music zone is off — nobody else can hear this'
              : `Loops for anyone within ${fmtRadius(musicRadius)}`
          }
          startMs={zone.zone_track_start_ms ?? 0}
          endMs={zone.zone_track_end_ms ?? null}
          accessibilityName="your zone track"
        />
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            Nothing is playing in your zone yet. Pick a song from Apple Music
            or upload your own track below — anyone who walks into your music
            zone can then choose to play it.
          </Text>
        </View>
      )}

      {/* Which slice repeats. Only offered when there is something to trim,
          and it says what the loop currently *is* rather than "Trim" — the
          current state is the useful half, and it is otherwise invisible
          until you press play and wait for the seam. */}
      {audioUrl && (
        <Pressable
          onPress={onEditLoop}
          style={({ pressed }) => [styles.loopRow, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={
            trimmed
              ? `Loop is ${fmtTime(zone.zone_track_start_ms ?? 0)} to ${fmtTime(zone.zone_track_end_ms ?? 0)}. Edit it.`
              : 'Trim which part of the track loops'
          }
        >
          <Ionicons name="repeat" size={17} color={colors.teal} />
          <Text style={styles.loopText}>
            {trimmed
              ? `Loops ${fmtTime(zone.zone_track_start_ms ?? 0)} – ${fmtTime(zone.zone_track_end_ms ?? 0)}`
              : 'Loops the whole track'}
          </Text>
          <Text style={styles.loopAction}>{trimmed ? 'Edit' : 'Trim'}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.t3} />
        </Pressable>
      )}

      {/* Who can hear it. Not a toggle: a music zone is never audible or
          visible to a stranger, whatever this says — only "hidden from
          everyone" (set in Privacy & safety) changes anything here. */}
      <View style={styles.controlRow}>
        <IconLock size={18} color={colors.t2} />
        <View style={styles.controlText}>
          <Text style={styles.controlLabel}>Audible to connections & friends</Text>
          <Text style={styles.controlHint}>
            {audience === 'nobody'
              ? 'Zone audio is hidden from everyone in Privacy & safety.'
              : 'Strangers never see or hear this zone.'}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Whether there is a music zone at all, and how far it reaches.
 *
 * A zone is a radar and a music zone is a speaker, and they were one number.
 * Widening your zone to be found by more people also handed all of them your
 * track; narrowing it so only the next table hears the music also took you off
 * everyone else's map. Two circles now, and this one is the speaker.
 *
 * One switch, after two false starts. `zone_active` in Settings removes the map
 * circle and deliberately leaves the music playing, so it was never this. Then
 * there were two here: a mute called "Sound zone", and "a separate zone for
 * music" that chose whether the music borrowed `zone_radius` instead of using
 * its own — which meant a music zone could be on and yet have no circle of its
 * own to show for it. Off now means gone: no circle on your map, none on
 * anyone else's, nothing audible. The track and the radius stay put, so
 * switching back on restores exactly what was there.
 */
function MusicZoneSection({ musicActive, musicRadius, hasTrack, musicAlerts, saving, onToggleActive, onRadiusChange, onRadiusCommit, onToggleAlerts }: {
  musicActive: boolean;
  musicRadius: number;
  /** Whether anything is loaded. An empty zone is drawn for nobody, here or on
   *  the map, so the copy must not promise a circle that is not there. */
  hasTrack: boolean;
  musicAlerts: boolean;
  saving: boolean;
  onToggleActive: (v: boolean) => void;
  onRadiusChange: (next: number) => void;
  onRadiusCommit: (next: number) => void;
  onToggleAlerts: (v: boolean) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>THE MUSIC ZONE</Text>

      <View style={styles.controlRow}>
        <IconSound size={18} color={colors.t2} />
        <View style={styles.controlText}>
          <Text style={styles.controlLabel}>Music zone</Text>
          <Text style={styles.controlHint}>
            {musicActive
              ? hasTrack
                ? `On — friends within ${fmtRadius(musicRadius)} see it on the map and can play your track.`
                : `On, and waiting for a track. Nothing is drawn on anyone's map until you pick one below.`
              : 'Off — the circle is gone from the map and nobody hears your track. Your zone and the track stay as they are.'}
          </Text>
        </View>
        <Switch
          value={musicActive}
          onValueChange={onToggleActive}
          trackColor={{ false: colors.surface2, true: colors.teal }}
          thumbColor={colors.t1}
          ios_backgroundColor={colors.surface2}
        />
      </View>

      {/* The dial is hidden rather than disabled while the zone is off. A
          greyed-out dial still reads as a setting you are being denied; a
          missing one reads as a question that does not apply yet, which is
          what "how big is the circle that is not there" is. */}
      {musicActive && (
        <View style={styles.dialCard}>
          <View style={styles.readoutRow}>
            <Text style={styles.readoutLabel}>Reaches</Text>
            <Text style={styles.readout}>{fmtRadius(musicRadius)}</Text>
          </View>
          <RadiusSlider
            value={musicRadius}
            min={RADIUS_MIN_M}
            max={RADIUS_MAX_M}
            onChange={onRadiusChange}
            onCommit={onRadiusCommit}
            format={fmtRadius}
            label="Music zone radius"
            disabled={saving}
          />
        </View>
      )}

      {/* Outside the gate on purpose: this switch is both directions at once,
          and being told about a friend's music is still worth having when you
          have no music zone of your own. */}
      <View style={styles.controlRow}>
        <Ionicons name="notifications-outline" size={18} color={colors.t2} />
        <View style={styles.controlText}>
          <Text style={styles.controlLabel}>Tell me about music zones</Text>
          <Text style={styles.controlHint}>
            {musicAlerts
              ? 'When a friend walks into your music zone — and when you walk into theirs.'
              : 'Off. Zones still work; nobody is told about them.'}
          </Text>
        </View>
        <Switch
          value={musicAlerts}
          onValueChange={onToggleAlerts}
          trackColor={{ false: colors.surface2, true: colors.teal }}
          thumbColor={colors.t1}
          ios_backgroundColor={colors.surface2}
        />
      </View>
    </View>
  );
}

function AppleMusicSection({ zone, isApple, appleTitle, onBrowse, onRemove }: {
  zone: ZoneState;
  isApple: boolean;
  appleTitle: string | null;
  onBrowse: () => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>FROM APPLE MUSIC</Text>

      {isApple ? (
        <View style={styles.fileCard}>
          {zone.zone_apple_artwork ? (
            <Image source={{ uri: zone.zone_apple_artwork }} style={styles.appleArt} />
          ) : (
            <View style={styles.fileIcon}>
              <IconMusic size={20} color={colors.teal} />
            </View>
          )}
          <View style={styles.fileText}>
            <Text style={styles.fileName} numberOfLines={1}>{appleTitle}</Text>
            <Text style={styles.fileHint} numberOfLines={1}>
              {zone.zone_apple_artist
                ? `${zone.zone_apple_artist} · 30-second preview`
                : '30-second preview'}
            </Text>
          </View>
          <Pressable
            onPress={onBrowse}
            hitSlop={8}
            style={({ pressed }) => [styles.fileAction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Pick a different Apple Music track"
          >
            <Text style={styles.fileActionText}>Change</Text>
          </Pressable>
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            style={({ pressed }) => [styles.fileRemove, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Remove this Apple Music track"
          >
            <IconClose size={16} color={colors.t3} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={onBrowse}
          style={({ pressed }) => [styles.appleTile, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Search Apple Music"
          accessibilityHint="Opens the catalogue to pick a song for your zone"
        >
          <View style={styles.appleRing}>
            <IconMusic size={22} color={colors.teal} />
          </View>
          <View style={styles.appleTileText}>
            <Text style={styles.uploadTitle}>Search the catalogue</Text>
            <Text style={styles.appleTileHint}>
              Pick any song on Apple Music. Zones play the 30-second preview —
              full tracks need each listener&rsquo;s own subscription.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.t3} />
        </Pressable>
      )}
    </View>
  );
}

function UploadSection({ isUpload, uploading, uploadPct, title, onPick, onRemove }: {
  isUpload: boolean;
  uploading: boolean;
  uploadPct: number | null;
  title: string | null;
  onPick: () => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>YOUR TRACK</Text>

      {isUpload && !uploading ? (
        <View style={styles.fileCard}>
          <View style={styles.fileIcon}>
            <Ionicons name="musical-notes" size={20} color={colors.teal} />
          </View>
          <View style={styles.fileText}>
            <Text style={styles.fileName} numberOfLines={1}>{title}</Text>
            <Text style={styles.fileHint}>Your upload · loops in your zone</Text>
          </View>
          <Pressable
            onPress={onPick}
            hitSlop={8}
            style={({ pressed }) => [styles.fileAction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Replace your zone track"
          >
            <Text style={styles.fileActionText}>Replace</Text>
          </Pressable>
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            style={({ pressed }) => [styles.fileRemove, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Remove your zone track"
          >
            <IconClose size={16} color={colors.t3} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={onPick}
          disabled={uploading}
          style={({ pressed }) => [styles.uploadTile, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Upload a track for your zone"
          accessibilityHint="Opens your files. MP3, M4A or WAV."
        >
          <View style={styles.uploadRing}>
            {uploading ? (
              <ActivityIndicator color={colors.teal} />
            ) : (
              <IconUpload size={26} color={colors.teal} />
            )}
          </View>

          <Text style={styles.uploadTitle}>
            {uploading ? 'Uploading your track…' : 'Upload your own track'}
          </Text>
          <Text style={styles.uploadHint}>
            {uploading
              ? 'Keep this screen open until it finishes'
              : 'MP3, M4A or WAV — it loops while people are inside your zone'}
          </Text>

          {/* Decorative while idle; while uploading the same bars fill left
              to right, so the tile becomes its own progress meter. */}
          <View style={styles.wave}>
            {WAVE.map(({ id, h }, i) => {
              const reached = uploading && (i / WAVE.length) * 100 <= (uploadPct ?? 0);
              return (
                <View
                  key={id}
                  style={[
                    styles.waveBar,
                    { height: h },
                    uploading && (reached ? styles.waveBarOn : styles.waveBarOff),
                  ]}
                />
              );
            })}
          </View>

          {uploading ? (
            <Text style={styles.uploadPct}>{uploadPct}%</Text>
          ) : (
            <View style={styles.uploadCta}>
              <Text style={styles.uploadCtaText}>Choose a file</Text>
            </View>
          )}
        </Pressable>
      )}

      <Text style={styles.footnote}>
        A zone plays one thing at a time, so whichever of the two you pick
        last — a song or your own file — replaces the other. Changes save
        as you make them.
      </Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ZoneScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();

  const [zone, setZone] = useState<ZoneState>({ zone_active: true, zone_radius: 500 });
  /** Name of the file this session uploaded — nicer than the URL it became. */
  const [uploadName, setUploadName] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  const { settings } = usePrivacySettings();
  const audience: Audience = settings?.visibility_zone_audio ?? 'friends';

  useEffect(() => {
    async function init() {
      const zoneRes = await api.get<ZoneState>('/api/users/zone/').catch(() => null);
      if (zoneRes) setZone(zoneRes.data);
      // The friends-only switch mirrors the privacy store, which may not have
      // been fetched yet this session.
      refreshPrivacy().catch(() => {});
    }

    init().finally(() => setLoading(false));
  }, []);

  // The Apple Music picker saves through its own endpoint and pops straight
  // back here, so the state this screen is holding is a track out of date the
  // moment it returns. The first focus is skipped — the load above is already
  // in flight for it, and two GETs on mount is one too many.
  const firstFocus = useRef(true);
  // Kept despite react-doctor/react-compiler-no-manual-memoization: a hedge
  // against `useFocusEffect` re-subscribing every render if this hook ever
  // bails compilation, not a fix for anything broken today.
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) {
      firstFocus.current = false;
      return;
    }
    api.get<ZoneState>('/api/users/zone/')
      .then((r) => setZone(r.data))
      .catch(() => {});
  }, []));

  const audioUrl = zone.zone_audio_url ?? null;
  const active = zone.zone_active ?? false;
  const appleTitle = zone.zone_apple_title || null;
  const isApple = Boolean(zone.zone_apple_preview_url);
  const title = audioUrl
    ? (appleTitle ?? uploadName ?? trackTitle(audioUrl))
    : null;

  /** Absent means on — see `music_zone_active` on ZoneState. */
  const musicActive = zone.music_zone_active ?? true;
  /** The zone is off *and* there is something it would otherwise be playing. A
   *  switch with an empty slot under it is not worth mentioning anywhere:
   *  nobody could hear you either way. */
  const silent = !musicActive && Boolean(audioUrl);
  const musicRadius = zone.music_zone_radius ?? 200;
  const musicAlerts = zone.music_zone_alerts ?? true;
  /** True once a window has been chosen — a null end is the whole track. */
  const trimmed = zone.zone_track_end_ms != null;

  /**
   * Optimistic PATCH. The response is authoritative — the server clears an
   * Apple track when a file arrives and vice versa, so the state that lands
   * here is the one it echoes back, not the one we sent.
   */
  async function patchZone(body: Record<string, unknown>, optimistic?: Partial<ZoneState>) {
    const previous = zone;
    if (optimistic) setZone({ ...zone, ...optimistic });
    setSaving(true);
    await runBusy(async () => {
      const r = await api.patch<ZoneState>('/api/users/zone/', body);
      setZone(r.data);
    }, () => setSaving(false)).catch((e: any) => {
      setZone(previous);
      Alert.alert('Could not save', e?.response?.data?.detail ?? 'Please try again.');
    });
  }

  function setMusicActive(on: boolean) {
    // The radius travels with the switch. Turning the zone on for the first
    // time would otherwise save `active: true` against whatever the server's
    // default happens to be, and the dial below would render a number nobody
    // chose.
    patchZone(
      on ? { music_zone_active: true, music_zone_radius: musicRadius }
         : { music_zone_active: false },
      { music_zone_active: on },
    );
  }

  function commitMusicRadius(next: number) {
    patchZone({ music_zone_radius: next }, { music_zone_radius: next });
  }

  function setMusicAlerts(on: boolean) {
    patchZone({ music_zone_alerts: on }, { music_zone_alerts: on });
  }

  async function pickAudio() {
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    } catch { return; }
    if (result.canceled) return;

    const asset = result.assets[0];
    const form = new FormData();
    form.append('zone_audio', {
      uri: asset.uri,
      type: asset.mimeType ?? 'audio/mpeg',
      name: asset.name,
    } as any);

    setUploadPct(0);
    try {
      const r = await api.patch<ZoneState>('/api/users/zone/', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // A track is megabytes over a phone connection — a spinner that sits
        // there for twenty seconds is indistinguishable from a hang.
        onUploadProgress: (e) => {
          if (!e.total) return;
          setUploadPct(Math.min(99, Math.round((e.loaded / e.total) * 100)));
        },
      });
      setZone(r.data);
      setUploadName(asset.name.replace(/\.[a-z0-9]{2,4}$/i, ''));
    } catch (e: any) {
      Alert.alert('Upload failed', e?.response?.data?.detail ?? 'Could not upload that file.');
    }
    // Reached on both paths: the `catch` alerts and stops there.
    setUploadPct(null);
  }

  function removeAudio() {
    Alert.alert(
      'Remove your track?',
      'Your zone goes quiet until you upload another one or pick a song.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setUploadName(null);
            patchZone({ zone_audio: null });
          },
        },
      ],
    );
  }

  function removeAppleTrack() {
    Alert.alert(
      'Remove this track?',
      'Your zone goes quiet until you pick another song or upload a file.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            await runBusy(
              async () => setZone(await clearAppleZoneTrack<ZoneState>()),
              () => setSaving(false),
            ).catch((e: unknown) =>
              Alert.alert(
                'Could not remove it',
                e instanceof AppleMusicError ? e.message : 'Please try again.',
              ),
            );
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  const uploading = uploadPct !== null;
  // Two things can fill the one slot now, so "an upload" needs the Apple test
  // too — without it a chosen song would be drawn as a file the user never
  // uploaded.
  const isUpload = Boolean(zone.zone_audio) && !isApple;

  return (
    <View style={styles.root}>
      {/* Header */}
      <ScreenHeader title="Zone Music">
        <View style={[styles.header, { paddingTop: top + 6 }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.t1} />
          </Pressable>
          <Text style={styles.headerTitle}>Zone Music</Text>
          <View style={styles.headerSpacer}>
            {saving ? <ActivityIndicator color={colors.t3} size="small" /> : null}
          </View>
        </View>
      </ScreenHeader>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Adding and removing the zone on the map lives in Settings → Zone on
            the map, and only there. This screen is the music, and the music
            zone is its own circle with its own switch.

            The note says so, because the two are easy to conflate: the map
            switch being off does not silence anything, and people who have
            turned it off need telling that their music zone is still out there.
            Suppressed when the music zone is off, where it would be flatly
            wrong — that switch says what it did on its own row. */}
        {!active && audioUrl && musicActive && (
          <View style={styles.offNote}>
            <IconInfo size={16} color={colors.t2} />
            <Text style={styles.offNoteText}>
              Your zone isn’t shown on the map, but your music zone is: this
              plays for anyone within {fmtRadius(musicRadius)}. The switch below
              is the one that removes it.
            </Text>
          </View>
        )}

        <NowPlayingSection
          zone={zone}
          audioUrl={audioUrl}
          title={title}
          musicRadius={musicRadius}
          silent={silent}
          trimmed={trimmed}
          audience={audience}
          onEditLoop={() => router.push('/zone-trim')}
        />

        <MusicZoneSection
          musicActive={musicActive}
          musicRadius={musicRadius}
          hasTrack={Boolean(audioUrl)}
          musicAlerts={musicAlerts}
          saving={saving}
          onToggleActive={setMusicActive}
          onRadiusChange={(next) => setZone((z) => ({ ...z, music_zone_radius: next }))}
          onRadiusCommit={commitMusicRadius}
          onToggleAlerts={setMusicAlerts}
        />

        <AppleMusicSection
          zone={zone}
          isApple={isApple}
          appleTitle={appleTitle}
          onBrowse={() => router.push('/zone-apple-music')}
          onRemove={removeAppleTrack}
        />

        <UploadSection
          isUpload={isUpload}
          uploading={uploading}
          uploadPct={uploadPct}
          title={title}
          onPick={pickAudio}
          onRemove={removeAudio}
        />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 17,
    color: colors.t1,
  },
  headerSpacer: { width: 32, alignItems: 'flex-end' },

  scroll: { paddingHorizontal: 20, paddingTop: 20 },

  // ── Zone is off ──
  offNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    marginBottom: 24,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  offNoteText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.t2,
  },

  // ── Music inside it ──
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.t2,
  },

  controlLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 14,
    color: colors.t1,
  },

  // ── Loop row ──
  loopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  loopText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: colors.t1,
  },
  loopAction: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.teal,
  },

  // One shape for every switch on this screen — who can hear it, whether the
  // music has its own zone, and whether anyone is told about it.
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  controlText: { flex: 1, gap: 3 },
  controlHint: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.t3,
  },

  // ── Music zone dial ──
  dialCard: {
    marginTop: 14,
    padding: 16,
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
  readoutRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  readoutLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.t3,
  },
  readout: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '700',
    color: colors.t1,
  },

  // ── Apple Music ──
  appleTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.tealLine,
  },
  appleRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleTileText: { flex: 1, gap: 4 },
  appleTileHint: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.t3,
  },
  appleArt: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.surface2,
  },

  // ── Sections ──
  section: { marginBottom: 28 },
  sectionLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  footnote: {
    marginTop: 12,
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.t3,
  },

  // ── Upload tile ──
  uploadTile: {
    alignItems: 'center',
    paddingVertical: 26,
    paddingHorizontal: 20,
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.tealLine,
    borderStyle: 'dashed',
  },
  uploadRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  uploadTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 16,
    color: colors.t1,
  },
  uploadHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.t3,
    textAlign: 'center',
  },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 36,
    marginTop: 4,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.tealLine,
  },
  waveBarOn:  { backgroundColor: colors.teal },
  waveBarOff: { backgroundColor: colors.surface2 },
  uploadPct: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.teal,
  },
  uploadCta: {
    marginTop: 4,
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderRadius: radius.m,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
  },
  uploadCtaText: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.teal,
  },

  // ── Current upload ──
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileText: { flex: 1, gap: 3 },
  fileName: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 14,
    color: colors.t1,
  },
  fileHint: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.t3,
  },
  fileAction: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radius.s,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fileActionText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.t2,
  },
  fileRemove: { padding: 4 },

  pressed: { opacity: 0.6 },
});
