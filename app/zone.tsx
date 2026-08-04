import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { RadiusSlider } from '@/components/RadiusSlider';
import { ZonePlayer } from '@/components/ZonePlayer';
import { IconClose, IconInfo, IconLock, IconMusic, IconUpload } from '@/components/ui/icons';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { AppleMusicError, clearAppleZoneTrack } from '@/services/appleMusic';
import {
  refreshPrivacy,
  updatePrivacy,
  usePrivacySettings,
  type Audience,
} from '@/services/privacy';
import { fmtRadius, fmtTime, loadZonePresets, trackTitle, type ZonePreset } from '@/services/zoneAudio';
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
// the place picker it shares a decision with. What is here is how far the music
// carries, which turns out to be a different question with a different answer:
// people widen a zone to be found and narrow their music so only the next table
// hears it. One number could not serve both, so there are two, and the second
// one stays invisible until someone switches it on.
//
// Three things can fill the one audio slot — an Apple Music track, an upload, a
// preset — and the last one picked wins. A zone plays one thing.
//
// Everything saves as you touch it. The old screen collected a preset, a file
// and a switch and then asked you to press Save, which meant the preset (which
// saved immediately) and the switch (which did not) disagreed about what was
// live.

// ─── Types ────────────────────────────────────────────────────────────────────
type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface ZoneState {
  zone_preset?: string;
  zone_active?: boolean;
  /** Read here, never written: the size of your zone is not something this
   *  screen sets. Listed so the server's echo round-trips intact. */
  zone_radius?: number;
  zone_audio?: string | null;
  zone_audio_url?: string | null;
  /** Read only, and only to phrase the copy: a zone that covers a whole city
   *  has no radius to quote, so "within 500 m" would be a lie there. */
  effective_zone_mode?: 'radius' | 'region';

  /** The music zone — how far the sound carries, which this screen *does* set.
   *  While `music_zone_separate` is false it follows `zone_radius`.
   *  `music_radius_m` is the server resolving that fallback; listed so it
   *  round-trips, but the copy below derives it rather than waiting for it. */
  music_zone_separate?: boolean;
  music_zone_radius?: number;
  music_zone_alerts?: boolean;
  music_radius_m?: number;

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

// ─── Preset icon mapping ──────────────────────────────────────────────────────
const PRESET_ICONS: Record<string, IoniconsName> = {
  rain:      'rainy-outline',
  cafe:      'cafe-outline',
  forest:    'leaf-outline',
  ocean:     'water-outline',
  fireplace: 'flame-outline',
  lofi:      'musical-notes-outline',
};

/** Decorative level meter on the upload tile. Fixed shape: it stands for
 *  "audio goes here", it is not a reading of anything. */
const WAVE = [7, 13, 22, 15, 28, 20, 34, 24, 16, 27, 11, 20, 31, 18, 9, 15, 24, 13, 7, 17];

// ─── Card width for 2-column grid ────────────────────────────────────────────
const SCREEN_W = Dimensions.get('window').width;
const CARD_W = (SCREEN_W - 40 - 10) / 2; // 20px side padding each side, 10px gap

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ZoneScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();

  const [presets, setPresets] = useState<ZonePreset[]>([]);
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
      const [zoneRes, presetList] = await Promise.allSettled([
        api.get<ZoneState>('/api/users/zone/'),
        loadZonePresets(),
      ]);

      if (zoneRes.status === 'fulfilled') setZone(zoneRes.value.data);
      if (presetList.status === 'fulfilled') setPresets(presetList.value);
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
  const preset = zone.zone_preset || null;
  const active = zone.zone_active ?? false;
  const appleTitle = zone.zone_apple_title || null;
  const isApple = Boolean(zone.zone_apple_preview_url);
  const title = audioUrl
    ? (appleTitle ?? uploadName ?? trackTitle(audioUrl, presets))
    : null;

  const musicSeparate = zone.music_zone_separate ?? false;
  const musicRadius = zone.music_zone_radius ?? 200;
  /** What earshot is right now — the separate dial, or the zone it inherits.
   *  Derived rather than read from the server's `music_radius_m`, which is the
   *  same formula one round trip behind while a switch is still saving. */
  const earshot = musicSeparate ? musicRadius : (zone.zone_radius ?? 500);
  const musicAlerts = zone.music_zone_alerts ?? true;
  /** True when earshot is a shape rather than a distance — a region zone that
   *  the music is still following. Nothing here can quote a radius for it. */
  const inheritsRegion = !musicSeparate && zone.effective_zone_mode === 'region';
  /** True once a window has been chosen — a null end is the whole track. */
  const trimmed = zone.zone_track_end_ms != null;

  /**
   * Optimistic PATCH. The response is authoritative — the server clears a
   * preset when a file arrives and vice versa, so the state that lands here is
   * the one it echoes back, not the one we sent.
   */
  async function patchZone(body: Record<string, unknown>, optimistic?: Partial<ZoneState>) {
    const previous = zone;
    if (optimistic) setZone({ ...zone, ...optimistic });
    setSaving(true);
    try {
      const r = await api.patch<ZoneState>('/api/users/zone/', body);
      setZone(r.data);
    } catch (e: any) {
      setZone(previous);
      Alert.alert('Could not save', e?.response?.data?.detail ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function setMusicSeparate(separate: boolean) {
    // The radius travels with the switch. Turning it on for the first time
    // would otherwise save `separate: true` against whatever the server's
    // default happens to be, and the dial below would render a number nobody
    // chose.
    patchZone(
      separate ? { music_zone_separate: true, music_zone_radius: musicRadius }
               : { music_zone_separate: false },
      { music_zone_separate: separate },
    );
  }

  function commitMusicRadius(next: number) {
    patchZone({ music_zone_radius: next }, { music_zone_radius: next });
  }

  function setMusicAlerts(on: boolean) {
    patchZone({ music_zone_alerts: on }, { music_zone_alerts: on });
  }

  function selectPreset(id: string) {
    // Tapping the selected preset again clears it — the grid has no "None"
    // tile any more, because the thing you actually want is "stop playing
    // this", and that is the tile you are already looking at.
    const next = preset === id ? '' : id;
    setUploadName(null);
    patchZone({ zone_preset: next }, { zone_preset: next });
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
    } finally {
      setUploadPct(null);
    }
  }

  function removeAudio() {
    Alert.alert(
      'Remove your track?',
      'Your zone goes quiet until you upload another one or pick a preset.',
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
      'Your zone goes quiet until you pick another song, a preset, or upload a file.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              setZone(await clearAppleZoneTrack<ZoneState>());
            } catch (e: unknown) {
              Alert.alert(
                'Could not remove it',
                e instanceof AppleMusicError ? e.message : 'Please try again.',
              );
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  }

  async function setFriendsOnly(friendsOnly: boolean) {
    try {
      await updatePrivacy({ visibility_zone_audio: friendsOnly ? 'friends' : 'everyone' });
    } catch {
      Alert.alert('Could not update', 'Your previous setting is still in effect.');
    }
  }

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  const uploading = uploadPct !== null;
  // Three things can fill the one slot now, so "not a preset" is no longer the
  // same as "an upload" — without the Apple test a chosen song would be drawn
  // as a file the user never uploaded.
  const isUpload = Boolean(zone.zone_audio) && !preset && !isApple;

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </Pressable>
        <Text style={styles.headerTitle}>Zone Music</Text>
        <View style={styles.headerSpacer}>
          {saving ? <ActivityIndicator color={colors.t3} size="small" /> : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Adding and removing the zone lives in Settings → Zone on the map,
            and only there. This screen is the music.

            There is deliberately no "your zone is off, so nobody can hear this"
            note any more, because it is no longer true: the map switch removes
            the circle drawn around you and leaves the sound alone. What silences
            a track is clearing it, right here. When earshot is inherited rather
            than separate the zone's radius is still the distance it carries —
            that is a number, not an on/off — so the line below says which
            distance is in force instead. */}
        {!active && !musicSeparate && audioUrl && (
          <View style={styles.offNote}>
            <IconInfo size={16} color={colors.t2} />
            <Text style={styles.offNoteText}>
              Your zone isn’t shown on the map, but this still plays for anyone
              within {fmtRadius(earshot)}. Give the music its own range below to
              set that separately.
            </Text>
          </View>
        )}

        {/* ── The music the zone carries ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PLAYING IN YOUR ZONE</Text>

          {audioUrl ? (
            <ZonePlayer
              // Remounts when the track changes, so switching presets can never
              // leave the previous one loaded.
              key={audioUrl}
              url={audioUrl}
              title={title ?? 'Zone audio'}
              artwork={zone.zone_apple_artwork}
              subtitle={
                inheritsRegion
                  ? 'Loops for anyone inside your zone'
                  : `Loops for anyone within ${fmtRadius(earshot)}`
              }
              startMs={zone.zone_track_start_ms ?? 0}
              endMs={zone.zone_track_end_ms ?? null}
              accessibilityName="your zone track"
            />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                Nothing is playing in your zone yet. Pick a song from Apple Music,
                upload your own track, or choose a preset below — anyone who walks
                into earshot can then choose to play it.
              </Text>
            </View>
          )}

          {/* Which slice repeats. Only offered when there is something to trim,
              and it says what the loop currently *is* rather than "Trim" — the
              current state is the useful half, and it is otherwise invisible
              until you press play and wait for the seam. */}
          {audioUrl && (
            <Pressable
              onPress={() => router.push('/zone-trim')}
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

          {/* Who can hear it. This is the same setting as Privacy → Zone audio,
              phrased as the question people actually ask about their zone. */}
          <View style={styles.controlRow}>
            <IconLock size={18} color={colors.t2} />
            <View style={styles.controlText}>
              <Text style={styles.controlLabel}>Audible to friends only</Text>
              <Text style={styles.controlHint}>
                {audience === 'nobody'
                  ? 'Zone audio is hidden from everyone in Privacy & safety.'
                  : audience === 'friends'
                    ? 'Strangers still see your zone on the map, they just hear nothing.'
                    : 'Anyone who walks into your zone can play it.'}
              </Text>
            </View>
            <Switch
              value={audience !== 'everyone'}
              onValueChange={setFriendsOnly}
              disabled={audience === 'nobody'}
              trackColor={{ false: colors.surface2, true: colors.teal }}
              thumbColor={colors.t1}
              ios_backgroundColor={colors.surface2}
            />
          </View>
        </View>

        {/* ── How far the sound carries ──
            A zone is a radar and a music zone is a speaker, and they were one
            number. Widening your zone to be found by more people also handed
            all of them your track; narrowing it so only the next table hears
            the music also took you off everyone else's map. Two dials now, and
            the second one only exists once you ask for it — while the switch is
            off earshot is still the zone, exactly as it always was. */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>HOW FAR IT CARRIES</Text>

          <View style={styles.controlRow}>
            <IconMusic size={18} color={colors.t2} />
            <View style={styles.controlText}>
              <Text style={styles.controlLabel}>A separate zone for music</Text>
              <Text style={styles.controlHint}>
                {musicSeparate
                  ? `People hear you within ${fmtRadius(earshot)}, whatever size your zone is.`
                  : inheritsRegion
                    ? 'Off — the music reaches everyone inside the place your zone covers.'
                    : `Off — the music reaches as far as your zone does (${fmtRadius(earshot)}).`}
              </Text>
            </View>
            <Switch
              value={musicSeparate}
              onValueChange={setMusicSeparate}
              trackColor={{ false: colors.surface2, true: colors.teal }}
              thumbColor={colors.t1}
              ios_backgroundColor={colors.surface2}
            />
          </View>

          {musicSeparate && (
            <View style={styles.dialCard}>
              <View style={styles.readoutRow}>
                <Text style={styles.readoutLabel}>Earshot</Text>
                <Text style={styles.readout}>{fmtRadius(musicRadius)}</Text>
              </View>
              <RadiusSlider
                value={musicRadius}
                min={RADIUS_MIN_M}
                max={RADIUS_MAX_M}
                onChange={(next) => setZone((z) => ({ ...z, music_zone_radius: next }))}
                onCommit={commitMusicRadius}
                format={fmtRadius}
                label="Music zone radius"
                disabled={saving}
              />
            </View>
          )}

          <View style={styles.controlRow}>
            <Ionicons name="notifications-outline" size={18} color={colors.t2} />
            <View style={styles.controlText}>
              <Text style={styles.controlLabel}>Tell me about music zones</Text>
              <Text style={styles.controlHint}>
                {musicAlerts
                  ? 'When a friend walks into earshot of your track — and when you walk into theirs.'
                  : 'Off. Zones still work; nobody is told about them.'}
              </Text>
            </View>
            <Switch
              value={musicAlerts}
              onValueChange={setMusicAlerts}
              trackColor={{ false: colors.surface2, true: colors.teal }}
              thumbColor={colors.t1}
              ios_backgroundColor={colors.surface2}
            />
          </View>
        </View>

        {/* ── Apple Music ── */}
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
                onPress={() => router.push('/zone-apple-music')}
                hitSlop={8}
                style={({ pressed }) => [styles.fileAction, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Pick a different Apple Music track"
              >
                <Text style={styles.fileActionText}>Change</Text>
              </Pressable>
              <Pressable
                onPress={removeAppleTrack}
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
              onPress={() => router.push('/zone-apple-music')}
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

        {/* ── Your own track ── */}
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
                onPress={pickAudio}
                hitSlop={8}
                style={({ pressed }) => [styles.fileAction, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Replace your zone track"
              >
                <Text style={styles.fileActionText}>Replace</Text>
              </Pressable>
              <Pressable
                onPress={removeAudio}
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
              onPress={pickAudio}
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
                {WAVE.map((h, i) => {
                  const reached = uploading && (i / WAVE.length) * 100 <= (uploadPct ?? 0);
                  return (
                    <View
                      key={i}
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
        </View>

        {/* ── Presets ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>OR PICK A PRESET</Text>
          <View style={styles.presetGrid}>
            {presets.map((p) => {
              const selected = preset === p.id;
              const icon: IoniconsName = PRESET_ICONS[p.id] ?? 'musical-notes-outline';
              return (
                <Pressable
                  key={p.id}
                  style={({ pressed }) => [
                    styles.presetCard,
                    selected && styles.presetCardSelected,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => selectPreset(p.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityHint={selected ? 'Tap again to clear it' : undefined}
                >
                  <Ionicons name={icon} size={26} color={selected ? colors.teal : colors.t3} />
                  <Text style={[styles.presetName, selected && styles.presetNameSelected]}>
                    {p.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.footnote}>
            A zone plays one thing at a time, so whichever of these three you pick
            last — a song, your own file, or a preset — replaces the other two.
            Changes save as you make them.
          </Text>
        </View>
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

  // ── Earshot dial ──
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

  // ── Preset grid ──
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  presetCard: {
    width: CARD_W,
    paddingVertical: 20,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  presetCardSelected: {
    backgroundColor: colors.tealTint,
    borderColor: colors.tealLine,
  },
  presetName: {
    fontFamily: fonts.body,
    fontWeight: '500',
    fontSize: 13,
    color: colors.t3,
  },
  presetNameSelected: { color: colors.teal },

  pressed: { opacity: 0.6 },
});
