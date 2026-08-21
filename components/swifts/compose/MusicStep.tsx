import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useAudioPlayer } from 'expo-audio';

import { VolumeSlider } from '@/components/swifts/compose/VolumeSlider';
import { IconCheck, IconMusic, IconPause, IconPlay, IconSearch } from '@/components/ui/icons';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import type { SwiftDraft } from '@/services/swiftDraft';
import { keptDurationMs } from '@/services/swiftDraft';
import {
  clampTrackOffset,
  fetchTrackGenres,
  fetchTracks,
  formatTrackDuration,
  type SwiftTrack,
} from '@/services/swiftTracks';

/**
 * Choosing a track.
 *
 * **Everything in this list comes from Aura's own catalogue** — see
 * `services/swiftTracks.ts`. There is no code path here that can reach a
 * streaming service, and none should ever be added: a Swift bakes its audio
 * into a redistributed file, which is a different act from streaming a preview
 * and is not covered by any consumer music API's terms.
 *
 * The preview plays through `expo-audio`, which the app already ships for zone
 * playback. It is a genuine preview of the *track*, not of the mix: the final
 * synchronisation of music to video happens server-side, where both are laid
 * out on one timeline. Previewing the mix locally would need two players kept
 * in step, and two players drift — very visibly, on a fifteen-second loop.
 */

interface Props {
  draft: SwiftDraft;
  onChange: (patch: Partial<SwiftDraft>) => void;
}

export function MusicStep({ draft, onChange }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState<string | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [tracks, setTracks] = useState<SwiftTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [previewing, setPreviewing] = useState<number | null>(null);

  const player = useAudioPlayer();

  const load = useCallback(async (q: string, g: string | null) => {
    setLoading(true);
    setFailed(false);
    try {
      const page = await fetchTracks({ q, genre: g ?? undefined });
      setTracks(page.results);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrackGenres().then(setGenres).catch(() => setGenres([]));
  }, []);

  // Debounced, so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => load(query, genre), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, genre, load]);

  // Stop the preview when this step goes away — audio that outlives the screen
  // it belongs to is the single most jarring thing a picker can do.
  useEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // The player may already be released; nothing to recover.
      }
    };
  }, [player]);

  function togglePreview(track: SwiftTrack) {
    if (previewing === track.id) {
      player.pause();
      setPreviewing(null);
      return;
    }
    try {
      player.replace({ uri: track.audio_url });
      player.seekTo(draft.trackOffsetMs / 1000);
      player.play();
      setPreviewing(track.id);
    } catch {
      setPreviewing(null);
    }
  }

  function select(track: SwiftTrack) {
    const swiftMs = keptDurationMs(draft);
    onChange({
      track,
      trackOffsetMs: clampTrackOffset(draft.trackOffsetMs, track.duration_ms, swiftMs),
      // Picking a track with the original still at full volume produces a
      // muddle. Duck it once, on selection, and leave it adjustable.
      originalVolume: draft.originalVolume === 100 ? 25 : draft.originalVolume,
    });
  }

  function clear() {
    player.pause();
    setPreviewing(null);
    onChange({ track: null, trackOffsetMs: 0 });
  }

  const selected = draft.track;

  return (
    <View style={styles.root}>
      <View style={styles.searchRow}>
        <IconSearch size={18} color={colors.t3} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search Aura's music"
          placeholderTextColor={colors.t3}
          accessibilityLabel="Search music"
          returnKeyType="search"
        />
      </View>

      {genres.length > 0 && (
        <FlatList
          horizontal
          data={[null, ...genres]}
          keyExtractor={(g) => g ?? 'all'}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          renderItem={({ item }) => {
            const active = genre === item;
            return (
              <Pressable
                onPress={() => setGenre(item)}
                style={[styles.chip, active && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {item ?? 'All'}
                </Text>
              </Pressable>
            );
          }}
        />
      )}

      {selected && (
        <View style={styles.selected}>
          <View style={styles.selectedHead}>
            <IconMusic size={16} color={colors.teal} />
            <Text style={styles.selectedTitle} numberOfLines={1}>
              {selected.title} — {selected.artist}
            </Text>
            <Pressable onPress={clear} hitSlop={10} accessibilityRole="button">
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
          {selected.attribution ? (
            <Text style={styles.attribution}>{selected.attribution}</Text>
          ) : null}
          <VolumeSlider
            label="Music level"
            value={draft.musicVolume}
            onChange={(v) => onChange({ musicVolume: v })}
          />
          <VolumeSlider
            label="Original sound"
            value={draft.originalVolume}
            onChange={(v) => onChange({ originalVolume: v })}
          />
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} />
        </View>
      ) : failed ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn&apos;t load music</Text>
          <Pressable onPress={() => load(query, genre)} hitSlop={10}>
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : tracks.length === 0 ? (
        <View style={styles.center}>
          <IconMusic size={28} color={colors.t3} />
          <Text style={styles.emptyTitle}>
            {query ? 'No tracks match that' : 'No music yet'}
          </Text>
          <Text style={styles.emptyBody}>
            {query
              ? 'Try a different search.'
              : 'Aura’s catalogue is still being put together. You can publish with your original sound.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isSelected = selected?.id === item.id;
            const isPlaying = previewing === item.id;
            return (
              <View style={[styles.row, isSelected && styles.rowSelected]}>
                <Pressable
                  onPress={() => togglePreview(item)}
                  hitSlop={8}
                  style={styles.art}
                  accessibilityRole="button"
                  accessibilityLabel={isPlaying ? `Stop ${item.title}` : `Preview ${item.title}`}
                >
                  {item.artwork_url ? (
                    <Image source={{ uri: item.artwork_url }} style={styles.artImage} contentFit="cover" />
                  ) : (
                    <View style={styles.artFallback}>
                      <IconMusic size={18} color={colors.t3} />
                    </View>
                  )}
                  <View style={styles.artScrim}>
                    {isPlaying
                      ? <IconPause size={16} color="#FFFFFF" />
                      : <IconPlay size={16} color="#FFFFFF" />}
                  </View>
                </Pressable>

                <Pressable
                  style={styles.rowText}
                  onPress={() => select(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${item.title} by ${item.artist}`}
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {item.artist} · {formatTrackDuration(item.duration_ms)}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => select(item)}
                  hitSlop={10}
                  style={[styles.use, isSelected && styles.useOn]}
                  accessibilityRole="button"
                  accessibilityLabel={isSelected ? 'Selected' : `Use ${item.title}`}
                >
                  {isSelected
                    ? <IconCheck size={16} color={colors.bg} />
                    : <Text style={styles.useLabel} maxFontSizeMultiplier={MAX_SCALE_FIXED}>Use</Text>}
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  search: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: typography.body,
    color: colors.t1,
  },

  chips: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  chipLabel: { fontFamily: fonts.body, fontSize: typography.small, color: colors.t2 },
  chipLabelActive: { color: colors.teal, fontWeight: '600' },

  selected: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    gap: 10,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.tealLine,
    backgroundColor: colors.tealTint,
  },
  selectedHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectedTitle: {
    flex: 1,
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.t1,
  },
  remove: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    color: colors.red,
  },
  attribution: {
    fontFamily: fonts.body,
    fontSize: typography.micro,
    color: colors.t3,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    lineHeight: 19,
    color: colors.t3,
    textAlign: 'center',
  },
  retry: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.teal,
  },

  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: radius.m,
  },
  rowSelected: { backgroundColor: colors.surface2 },
  art: { width: 48, height: 48, borderRadius: radius.s, overflow: 'hidden' },
  artImage: { width: '100%', height: '100%' },
  artFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  artScrim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.t1,
  },
  rowMeta: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3 },
  use: {
    minWidth: 46,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  useOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  useLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    color: colors.t1,
  },
});
