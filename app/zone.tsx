import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
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
import { ZonePlayer } from '@/components/ZonePlayer';
import { IconClose, IconInfo, IconLock, IconUpload } from '@/components/ui/icons';
import { colors, fonts, radius } from '@/constants/theme';
import {
  refreshPrivacy,
  updatePrivacy,
  usePrivacySettings,
  type Audience,
} from '@/services/privacy';
import { loadZonePresets, trackTitle, type ZonePreset } from '@/services/zoneAudio';

// The music your zone carries: what plays, who is allowed to hear it, and a way
// to listen to it yourself before anyone else does.
//
// The zone and its music are two different things, and only the music is here.
// The zone is the radar — the circle that puts you on the map — and it is added
// and removed from Settings → Zone on the map, which is the single control for
// it. This screen never turns it off; removing your zone was never meant to be
// a way to change the track.
//
// Radius is deliberately absent too. It is not a property of the music, and it
// is not a free dial either — sizing your own zone is planned as a subscription
// perk, so the server's default stands for everyone until then.
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

  const audioUrl = zone.zone_audio_url ?? null;
  const preset = zone.zone_preset || null;
  const active = zone.zone_active ?? false;
  const title = audioUrl ? (uploadName ?? trackTitle(audioUrl, presets)) : null;

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
  const isUpload = Boolean(audioUrl) && !preset;

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
            and only there. It was a card at the top of this screen for a while,
            which meant two controls for one piece of state on two screens one
            tap apart. This screen is the music now; the line below is the one
            thing it still has to say about the zone, because a track nobody
            can hear needs a reason. */}
        {!active && (
          <View style={styles.offNote}>
            <IconInfo size={16} color={colors.t2} />
            <Text style={styles.offNoteText}>
              Your zone is off, so nobody can hear this. Turn it back on in
              Settings → Zone on the map.
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
              subtitle={
                active
                  ? 'Loops for anyone who steps into your zone'
                  : 'Preview only — your zone is off'
              }
              accessibilityName="your zone track"
            />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                Nothing is playing in your zone yet. Upload a track or pick a preset
                below, and anyone who walks in can choose to play it.
              </Text>
            </View>
          )}

          {/* Who can hear it. This is the same setting as Privacy → Zone audio,
              phrased as the question people actually ask about their zone. */}
          <View style={styles.audienceRow}>
            <IconLock size={18} color={colors.t2} />
            <View style={styles.audienceText}>
              <Text style={styles.controlLabel}>Audible to friends only</Text>
              <Text style={styles.audienceHint}>
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
            A preset replaces your upload, and an upload replaces the preset — a
            zone plays one thing at a time. Changes save as you make them.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
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

  audienceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  audienceText: { flex: 1, gap: 3 },
  audienceHint: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.t3,
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
