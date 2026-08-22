import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Ionicons } from '@expo/vector-icons';

import { IconClose, IconMusic, IconSearch } from '@/components/ui/icons';
import { fonts, radius, type } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  AppleMusicError,
  searchAppleMusic,
  setAppleZoneTrack,
  songLength,
  type AppleMusicFault,
  type AppleSong,
} from '@/services/appleMusic';

// Choosing what your zone plays, from Apple Music's catalogue.
//
// A search field and a list, and the list is the whole screen: there is one
// decision here and no reason to make anyone scroll past anything to reach it.
// Picking is a single tap — the track saves and the screen closes, because
// "pick, then confirm, then go back" is three taps for one intention.
//
// Every result is a 30-second preview. That is stated once, at the top, rather
// than on each row: it is a property of the feature, not of any one song, and
// repeating it forty times down a list is noise.

const SEARCH_DEBOUNCE_MS = 350;

/** Below this the box is not yet a search term, and nothing is shown for it. */
const MIN_QUERY_LEN = 2;

/** Module-level so the "nothing to show" case is the same array every render. */
const NO_RESULTS: AppleSong[] = [];

/** A headline per fault, so the panel names the thing that is wrong before the
 *  server's longer explanation underneath it. */
const FAULT_TITLE: Record<AppleMusicFault, string> = {
  not_configured: 'Apple Music is not set up on the server',
  bad_key: 'The Apple Music key cannot be read',
  rejected: 'Apple rejected this server',
  unavailable: 'Apple Music is unavailable',
};

export default function ZoneAppleMusicScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [rawResults, setResults] = useState<AppleSong[]>([]);
  const [rawSearching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once the server says it cannot search at all. The screen then stops
   *  being a search box and becomes an explanation — of the actual fault,
   *  which is why the whole error is kept and not just a boolean. */
  const [fault, setFault] = useState<AppleMusicError | null>(null);
  /** The id currently being saved, so only that row shows a spinner. */
  const [picking, setPicking] = useState<string | null>(null);
  /** True once a search has come back, so "no results" can be told apart from
   *  "nothing has been searched yet". */
  const [rawSearched, setSearched] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // A term too short to search has nothing to show for it, so that is worked
  // out here rather than blanked by the effect afterwards. The effect version
  // left the previous song list on screen for a frame after the field was
  // cleared — long enough to see, and to tap the wrong row.
  const term = query.trim();
  const tooShort = term.length < MIN_QUERY_LEN;
  const results = tooShort ? NO_RESULTS : rawResults;
  const searching = tooShort ? false : rawSearching;
  const searched = tooShort ? false : rawSearched;

  // Typing is the search. A button would mean the keyboard covers the results
  // until it is dismissed, and every keystroke cancels the request before it.
  useEffect(() => {
    if (tooShort) {
      abortRef.current?.abort();
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSearching(true);
      setError(null);
      searchAppleMusic(term, controller.signal)
        .then((songs) => {
          if (controller.signal.aborted) return;
          setResults(songs);
          setSearched(true);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          setError(e instanceof AppleMusicError ? e.message : 'Search failed.');
          if (e instanceof AppleMusicError && e.fatal) setFault(e);
          setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, tooShort]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const pick = async (song: AppleSong) => {
    setPicking(song.id);
    setError(null);
    try {
      await setAppleZoneTrack(song);
      Keyboard.dismiss();
      // Straight back to the zone screen, which re-reads the zone on focus and
      // will be showing the new track by the time the animation lands.
      router.back();
    } catch (e: unknown) {
      setError(e instanceof AppleMusicError ? e.message : 'Could not set that track.');
      setPicking(null);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Music">
        <View style={[styles.header, { paddingTop: top + 6 }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.t1} />
          </Pressable>
          <Text style={styles.headerTitle}>Music</Text>
          <View style={styles.headerSpacer} />
        </View>
      </ScreenHeader>

      {!fault ? (
        <>
          <View style={styles.searchWrap}>
            <View style={styles.searchField}>
              <IconSearch size={17} color={colors.t3} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Songs, artists, albums"
                placeholderTextColor={colors.t3}
                style={styles.searchInput}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Search for music"
              />
              {query.length > 0 && (
                <Pressable
                  onPress={() => setQuery('')}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <IconClose size={16} color={colors.t3} />
                </Pressable>
              )}
            </View>
            <Text style={styles.previewNote}>
              Zones play a 30-second preview — full tracks need each
              listener&rsquo;s own subscription.
            </Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <FlatList
            data={results}
            keyExtractor={(song) => song.id}
            windowSize={5}
            initialNumToRender={8}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[styles.list, { paddingBottom: bottom + 32 }]}
            renderItem={({ item }) => (
              <SongRow
                song={item}
                busy={picking === item.id}
                disabled={picking !== null && picking !== item.id}
                onPress={() => pick(item)}
              />
            )}
            ListEmptyComponent={
              searching ? (
                <View style={styles.center}>
                  <ActivityIndicator color={colors.teal} />
                </View>
              ) : (
                <View style={styles.center}>
                  <IconMusic size={30} color={colors.t3} />
                  <Text style={styles.emptyText}>
                    {searched
                      ? `Nothing in the catalogue matches “${query.trim()}”.`
                      : 'Search for a song to play in your zone.'}
                  </Text>
                </View>
              )
            }
            showsVerticalScrollIndicator={false}
          />
        </>
      ) : (
        /* The server's own words, not a guess. This panel used to say "no
           credentials" for every failure, including the case where all three
           were present and one of them was wrong — which is the single most
           misleading thing it could have said. */
        <View style={[styles.center, styles.unavailable]}>
          <IconMusic size={34} color={colors.t3} />
          <Text style={styles.unavailableTitle}>{FAULT_TITLE[fault.code]}</Text>
          <Text style={styles.faultDetail}>{fault.message}</Text>
          <Text style={styles.emptyText}>
            Your own uploads still work in the meantime.
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────
function SongRow({
  song, busy, disabled, onPress,
}: {
  song: AppleSong;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const length = songLength(song.duration_ms);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.row, (pressed || busy) && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${song.title} by ${song.artist}`}
      accessibilityHint="Plays this in your zone"
      accessibilityState={{ disabled: disabled || busy, busy }}
    >
      {song.artwork ? (
        <Image source={{ uri: song.artwork }} style={styles.art} />
      ) : (
        <View style={[styles.art, styles.artFallback]}>
          <IconMusic size={18} color={colors.t3} />
        </View>
      )}

      <View style={styles.rowText}>
        <Text style={styles.songTitle} numberOfLines={1}>{song.title}</Text>
        <Text style={styles.songMeta} numberOfLines={1}>
          {[song.artist, song.album].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {busy ? (
        <ActivityIndicator color={colors.teal} size="small" />
      ) : (
        <Text style={styles.songLength}>{length}</Text>
      )}
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

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
  headerSpacer: { width: 40 },

  searchWrap: { paddingHorizontal: 20, paddingTop: 16, gap: 8 },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.t1,
    padding: 0,
  },
  previewNote: {
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 17,
    color: colors.t3,
  },

  error: {
    paddingHorizontal: 20,
    paddingTop: 12,
    fontFamily: fonts.body,
    fontSize: type.caption,
    color: colors.orange,
  },

  list: { paddingHorizontal: 20, paddingTop: 14 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  rowPressed: { opacity: 0.6 },
  art: {
    width: 48,
    height: 48,
    borderRadius: radius.s,
    backgroundColor: colors.surface2,
  },
  artFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowText: { flex: 1, gap: 3 },
  songTitle: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: type.small,
    color: colors.t1,
  },
  songMeta: { fontFamily: fonts.body, fontSize: type.caption, color: colors.t3 },
  songLength: { fontFamily: fonts.body, fontSize: type.caption, color: colors.t3 },

  center: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 19,
    color: colors.t3,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  unavailable: { flex: 1, paddingTop: 0 },
  // The server's exact message. Monospaced-adjacent treatment on purpose: it
  // names variables, and a variable name inside a paragraph of prose is easy
  // to skim past.
  faultDetail: {
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 19,
    color: colors.t2,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  unavailableTitle: {
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: '600',
    color: colors.t1,
  },
});
