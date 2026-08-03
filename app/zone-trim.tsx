import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { TrimSlider } from '@/components/TrimSlider';
import { ZonePlayer } from '@/components/ZonePlayer';
import { fonts, radius, type } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { fmtTime, loadZonePresets, trackTitle, type ZonePreset } from '@/services/zoneAudio';

// Which part of the track goes round and round.
//
// A zone repeats one slice of audio indefinitely, and the slice that matters is
// rarely the first one. On an upload — a whole song — the interesting fifteen
// seconds are somewhere in the middle. Even Apple's 30-second preview is longer
// than most people want looping past them on a street.
//
// The duration is the reason this is a screen and not a row on the zone page:
// it lives inside the audio file and nowhere else. The server never decodes the
// track, so nothing knows how long it is until something loads it. The player
// here does that, reports back, and the handles appear once it has.
//
// Editing while it plays is the point. The loop turns over under the playhead
// as you drag, so you hear the seam you are choosing rather than guessing at it.

const MIN_LOOP_MS = 3000;

interface ZoneState {
  zone_audio_url?: string | null;
  zone_apple_title?: string;
  zone_apple_artist?: string;
  zone_apple_artwork?: string;
  zone_track_start_ms?: number;
  zone_track_end_ms?: number | null;
}

export default function ZoneTrimScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();

  const [zone, setZone] = useState<ZoneState | null>(null);
  const [presets, setPresets] = useState<ZonePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /** The track's real length, once the player has loaded enough to know. */
  const [duration, setDuration] = useState<number | null>(null);
  const [position, setPosition] = useState<number | null>(null);

  const [start, setStart] = useState(0);
  const [end, setEnd] = useState<number | null>(null);
  /** What was stored when this screen opened, so Save can be offered only when
   *  something actually changed. */
  const [saved, setSaved] = useState<{ start: number; end: number | null }>({ start: 0, end: null });

  useEffect(() => {
    Promise.allSettled([
      api.get<ZoneState>('/api/users/zone/'),
      loadZonePresets(),
    ]).then(([zoneRes, presetList]) => {
      if (zoneRes.status === 'fulfilled') {
        const z = zoneRes.value.data;
        setZone(z);
        setStart(z.zone_track_start_ms ?? 0);
        setEnd(z.zone_track_end_ms ?? null);
        setSaved({ start: z.zone_track_start_ms ?? 0, end: z.zone_track_end_ms ?? null });
      }
      if (presetList.status === 'fulfilled') setPresets(presetList.value);
      setLoading(false);
    });
  }, []);

  // Until the file reports its length there is no scale to draw handles on, so
  // the end defaults to "the whole thing" the moment one arrives.
  const onDuration = useCallback((ms: number) => {
    setDuration((current) => current ?? ms);
    setEnd((current) => current ?? ms);
  }, []);

  const effectiveEnd = end ?? duration ?? 0;
  const dirty = start !== saved.start || (end ?? null) !== saved.end;

  async function save() {
    setSaving(true);
    try {
      const r = await api.patch<ZoneState>('/api/users/zone/', {
        zone_track_start_ms: Math.round(start),
        // A window covering the whole track is stored as "no window" — that is
        // what an untrimmed track *is*, and it keeps the two states from
        // drifting apart when a file is later replaced by a longer one.
        zone_track_end_ms:
          duration != null && effectiveEnd >= duration - 200 && start <= 200
            ? null
            : Math.round(effectiveEnd),
      });
      setZone(r.data);
      setSaved({
        start: r.data.zone_track_start_ms ?? 0,
        end: r.data.zone_track_end_ms ?? null,
      });
      router.back();
    } catch (e: any) {
      Alert.alert(
        'Could not save the loop',
        e?.response?.data?.zone_track_end_ms?.[0] ??
        e?.response?.data?.detail ??
        'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setStart(0);
    setEnd(duration);
  }

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  const url = zone?.zone_audio_url ?? null;
  const title = zone?.zone_apple_title || (url ? trackTitle(url, presets) : 'Zone audio');
  const loopLength = Math.max(0, effectiveEnd - start);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </Pressable>
        <Text style={styles.headerTitle}>Trim the loop</Text>
        <View style={styles.headerSpacer}>
          {saving ? <ActivityIndicator color={colors.t3} size="small" /> : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {!url ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Your zone has no track yet. Pick one on Zone Music and you can choose
              which part of it repeats.
            </Text>
          </View>
        ) : (
          <>
            {/* The player is also the instrument: it reports the duration the
                handles are drawn against, and the position the playhead uses. */}
            <ZonePlayer
              key={url}
              url={url}
              title={title}
              artwork={zone?.zone_apple_artwork}
              subtitle={zone?.zone_apple_artist || 'Press play and drag the handles'}
              startMs={start}
              endMs={duration != null ? effectiveEnd : null}
              onDuration={onDuration}
              onPosition={setPosition}
              accessibilityName="your zone track"
            />

            <View style={styles.card}>
              <View style={styles.readoutRow}>
                <View>
                  <Text style={styles.readoutLabel}>Loops</Text>
                  <Text style={styles.readout}>
                    {fmtTime(start)} – {fmtTime(effectiveEnd)}
                  </Text>
                </View>
                <View style={styles.lengthTag}>
                  <Text style={styles.lengthTagText}>{fmtTime(loopLength)} long</Text>
                </View>
              </View>

              {duration != null ? (
                <TrimSlider
                  duration={duration}
                  startMs={start}
                  endMs={effectiveEnd}
                  onChange={(s, e) => { setStart(s); setEnd(e); }}
                  onCommit={(s, e) => { setStart(s); setEnd(e); }}
                  positionMs={position}
                  minLengthMs={MIN_LOOP_MS}
                  format={fmtTime}
                  disabled={saving}
                />
              ) : (
                <View style={styles.awaiting}>
                  <Ionicons name="play-circle-outline" size={18} color={colors.t3} />
                  <Text style={styles.awaitingText}>
                    Press play once — the handles appear as soon as the track reports
                    how long it is.
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={reset}
                disabled={saving || duration == null}
                style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Loop the whole track"
              >
                <Text style={styles.ghostBtnText}>Whole track</Text>
              </Pressable>

              <Pressable
                onPress={save}
                disabled={saving || !dirty || duration == null}
                style={({ pressed }) => [
                  styles.saveBtn,
                  (!dirty || duration == null) && styles.saveBtnIdle,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Save this loop"
                accessibilityState={{ disabled: saving || !dirty || duration == null }}
              >
                <Text
                  style={[
                    styles.saveBtnText,
                    (!dirty || duration == null) && styles.saveBtnTextIdle,
                  ]}
                >
                  {dirty ? 'Save loop' : 'Saved'}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.footnote}>
              Everyone who steps into your zone hears this slice, repeating. Changing
              the track resets the loop to the whole thing — a window chosen for one
              song means nothing in the next.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: '600',
    color: colors.t1,
  },
  headerSpacer: { width: 40, alignItems: 'flex-end' },

  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 16 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 19,
    color: colors.t2,
  },

  card: {
    padding: 16,
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
  readoutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  readoutLabel: {
    fontFamily: fonts.body,
    fontSize: type.micro,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.t3,
  },
  readout: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '700',
    color: colors.t1,
    marginTop: 2,
  },
  lengthTag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.s,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
  },
  lengthTagText: {
    fontFamily: fonts.body,
    fontSize: type.caption,
    fontWeight: '600',
    color: colors.teal,
  },

  awaiting: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  awaitingText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 17,
    color: colors.t3,
  },

  actions: { flexDirection: 'row', gap: 10 },
  ghostBtn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.m,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghostBtnText: {
    fontFamily: fonts.body,
    fontSize: type.small,
    fontWeight: '600',
    color: colors.t2,
  },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radius.m,
    backgroundColor: colors.teal,
  },
  saveBtnIdle: { backgroundColor: colors.surface2 },
  saveBtnText: {
    fontFamily: fonts.body,
    fontSize: type.small,
    fontWeight: '700',
    color: colors.bg,
  },
  saveBtnTextIdle: { color: colors.t3 },

  footnote: {
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 17,
    color: colors.t3,
  },
  pressed: { opacity: 0.6 },
});
