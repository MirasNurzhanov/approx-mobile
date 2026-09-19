import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrimSlider } from '@/components/TrimSlider';
import { IconClose, IconMusic, IconSearch } from '@/components/ui/icons';
import { GlassIconButton } from '@/components/ui/GlassSurface';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  searchTracks,
  toTrackChoice,
  trackGenres,
  type SwiftTrack,
} from '@/services/swiftComposer';
import type { SwiftTrackChoice } from '@/services/swiftDraft';

/**
 * Choosing a track, and choosing which part of it.
 *
 * ## Approx's catalogue only
 *
 * This searches `/api/swifts/tracks/`, which is Approx's own table — never a
 * music provider's API. That is structural rather than incidental, and
 * `swifts/music/base.py` argues it: a picker that called a partner on every
 * keystroke would be slow, would spend a rate limit on people scrolling, and
 * would go dark whenever that partner did — during composition, which is the
 * worst possible moment. Providers *sync into* the catalogue; the picker reads
 * the catalogue.
 *
 * It also means every track here has had its licence read by a person. A row
 * is inactive until somebody publishes it, and the endpoint only serves active
 * ones, so there is no path by which unvetted audio reaches a creator.
 *
 * ## Why there is a start offset
 *
 * Somebody attaching a three-minute song to an eight-second Swift is almost
 * never choosing its first eight seconds — they mean the chorus. The slider at
 * the bottom is that choice, and `useMusicBed` maps video position zero onto
 * it.
 *
 * The slider is `TrimSlider` with its end handle pinned: what a creator picks
 * here is a *start*, and the length is decided by the video rather than by
 * them. Reusing the component keeps the drag behaviour identical to the trim
 * they have already used one step earlier.
 */

interface Props {
  visible: boolean;
  /** What is already attached, so reopening starts where it left off. */
  selected: SwiftTrackChoice | null;
  startMs: number;
  /** The Swift's own length, which bounds where a start can usefully be. */
  swiftDurationMs: number;
  onCancel: () => void;
  onConfirm: (track: SwiftTrackChoice, startMs: number) => void;
  onRemove: () => void;
}

/** How long to wait after a keystroke before searching. */
const DEBOUNCE_MS = 250;

function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function MusicPickerSheet(props: Props) {
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onCancel}
    >
      {/* Mounted only while open: every opening re-reads the catalogue and
          starts from `selected`, rather than showing a stale list from
          whenever the composer was first rendered. */}
      {props.visible && <PickerBody {...props} />}
    </Modal>
  );
}

function PickerBody({
  selected, startMs, swiftDurationMs, onCancel, onConfirm, onRemove,
}: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState<string>('');
  const [genres, setGenres] = useState<string[]>([]);
  const [tracks, setTracks] = useState<SwiftTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [choice, setChoice] = useState<SwiftTrackChoice | null>(selected);
  const [start, setStart] = useState(startMs);

  // Bumped on every search so a slow response for an old query cannot
  // overwrite a fast one for the current query — the classic out-of-order
  // autocomplete bug, and a debounce makes it more likely rather than less.
  const generation = useRef(0);

  useEffect(() => {
    trackGenres().then(setGenres).catch(() => setGenres([]));
  }, []);

  const load = useCallback(async (q: string, g: string) => {
    const mine = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const page = await searchTracks({ q, genre: g, limit: 50 });
      if (mine !== generation.current) return;
      setTracks(page.results ?? []);
    } catch {
      if (mine !== generation.current) return;
      setFailed(true);
      setTracks([]);
    }
    if (mine === generation.current) setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { load(query, genre); }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, genre, load]);

  function pick(track: SwiftTrack) {
    const next = toTrackChoice(track);
    setChoice(next);
    // A different track means the old offset points at nothing meaningful —
    // second 47 of one song is not second 47 of another.
    setStart(next.id === selected?.id ? startMs : 0);
  }

  // How far into the track a start can sit and still have the Swift's whole
  // length to play over. Clamped to at least zero: a track shorter than the
  // Swift has no runway at all, and the bed wraps instead — see `useMusicBed`.
  const maxStart = choice
    ? Math.max(0, choice.durationMs - Math.max(1000, swiftDurationMs))
    : 0;

  return (
    // `accessibilityViewIsModal` keeps a screen reader inside the sheet.
    // Without it VoiceOver reads straight past a presented Modal into the
    // composer behind it — see `services/__tests__/modalAccessibility.test.ts`,
    // which asserts this for every Modal in the app.
    <View
      style={[styles.root, { paddingTop: insets.top + 8 }]}
      accessibilityViewIsModal
    >
      <View style={styles.header}>
        <GlassIconButton
          onPress={onCancel}
          hitSlop={12}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <IconClose size={20} color={colors.t2} />
        </GlassIconButton>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
          Add music
        </Text>
        <Pressable
          onPress={() => choice && onConfirm(choice, start)}
          disabled={!choice}
          hitSlop={12}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Use this track"
        >
          <Text style={[styles.headerAction, !choice && styles.headerActionOff]}>
            Done
          </Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <IconSearch size={18} color={colors.t3} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search tracks"
          placeholderTextColor={colors.t3}
          autoCorrect={false}
          accessibilityLabel="Search tracks"
        />
      </View>

      {genres.length > 0 && (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={['', ...genres]}
          keyExtractor={(g) => g || 'all'}
          contentContainerStyle={styles.genreRow}
          renderItem={({ item }) => {
            const active = genre === item;
            return (
              <Pressable
                onPress={() => setGenre(item)}
                style={[styles.genreChip, active && styles.genreChipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.genreText, active && styles.genreTextOn]}>
                  {item || 'All'}
                </Text>
              </Pressable>
            );
          }}
        />
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} />
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.center}>
              <IconMusic size={28} color={colors.t3} />
              <Text style={styles.emptyText}>
                {failed
                  ? 'Could not load the catalogue. Pull to try again.'
                  : query
                    ? 'No tracks match that.'
                    : 'No tracks published yet.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const active = choice?.id === item.id;
            return (
              <Pressable
                onPress={() => pick(item)}
                style={[styles.track, active && styles.trackOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${item.title} by ${item.artist}`}
              >
                {item.artwork_url ? (
                  <Image source={{ uri: item.artwork_url }} style={styles.art} />
                ) : (
                  <View style={[styles.art, styles.artEmpty]}>
                    <IconMusic size={18} color={colors.t3} />
                  </View>
                )}
                <View style={styles.trackText}>
                  <Text style={styles.trackTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.trackArtist} numberOfLines={1}>
                    {item.artist || 'Unknown artist'}
                  </Text>
                </View>
                <Text style={styles.trackLength}>{formatMs(item.duration_ms)}</Text>
              </Pressable>
            );
          }}
        />
      )}

      {/* The start offset, only once there is a track to offset into. */}
      {choice && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.footerHead}>
            <Text style={styles.footerLabel} numberOfLines={1}>
              Start at {formatMs(start)}
            </Text>
            {selected && (
              <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button">
                <Text style={styles.remove}>Remove track</Text>
              </Pressable>
            )}
          </View>
          {maxStart > 0 ? (
            <TrimSlider
              duration={choice.durationMs}
              startMs={start}
              // The end handle is pinned to the Swift's own length: this
              // control chooses *where* the bed starts, not how long it runs,
              // because the video already decides that.
              endMs={Math.min(choice.durationMs, start + Math.max(1000, swiftDurationMs))}
              minLengthMs={Math.max(1000, Math.min(swiftDurationMs, choice.durationMs))}
              positionMs={start}
              format={formatMs}
              onChange={(nextStart) => setStart(Math.min(maxStart, Math.max(0, nextStart)))}
              onCommit={(nextStart) => setStart(Math.min(maxStart, Math.max(0, nextStart)))}
            />
          ) : (
            <Text style={styles.footerHint}>
              This track is shorter than your Swift, so it loops from the start.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  headerBtn: { minWidth: 56, paddingVertical: 4 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  headerAction: {
    textAlign: 'right',
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.teal,
  },
  headerActionOff: { color: colors.t3 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
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

  genreRow: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  genreChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
  },
  genreChipOn: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  genreText: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    color: colors.t2,
    textTransform: 'capitalize',
  },
  genreTextOn: { color: colors.teal, fontWeight: '600' },

  center: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40 },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    color: colors.t3,
    textAlign: 'center',
  },

  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  trackOn: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  art: { width: 44, height: 44, borderRadius: 6, backgroundColor: colors.surface2 },
  artEmpty: { alignItems: 'center', justifyContent: 'center' },
  trackText: { flex: 1, gap: 2 },
  trackTitle: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  trackArtist: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    color: colors.t3,
  },
  trackLength: {
    fontFamily: fonts.body,
    fontSize: typography.micro,
    color: colors.t3,
    fontVariant: ['tabular-nums'],
  },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.t1,
  },
  footerHint: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    color: colors.t3,
  },
  remove: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    color: colors.red,
  },
});
