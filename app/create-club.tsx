import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { api } from '@/services/api';
import { runBusy } from '@/services/busy';
import {
  clubsApi,
  fetchMyLocation,
  levelLabel,
  UNPLACED,
  type ClubVisibilityLevel,
  type MyClubLocation,
} from '@/services/clubs';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

interface Interest {
  id: number;
  name: string;
  icon: string;
}

/** Widest first, the way the options read down the screen: city at the top as
 *  the safe default, narrowing as you go. The server sends `available_levels`
 *  narrowest first, so this is deliberately the other order. */
const LEVEL_ORDER: ClubVisibilityLevel[] = ['city', 'region', 'district'];

const LEVEL_HINT: Record<ClubVisibilityLevel, string> = {
  city: 'Anyone in the city can find this club.',
  region: 'Only people in this part of the city can find it.',
  district: 'Only people in this district can find it.',
};

// ─── Sections ─────────────────────────────────────────────────────────────────

function EmblemPicker({ emblemUri, onPick }: { emblemUri: string | null; onPick: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Pressable
      style={({ pressed }) => [styles.emblemWrap, pressed && { opacity: 0.8 }]}
      onPress={onPick}
    >
      {emblemUri ? (
        <Image source={{ uri: emblemUri }} style={styles.emblemImage} />
      ) : (
        <View style={styles.emblemPlaceholder}>
          <Ionicons name="image-outline" size={28} color={colors.t3} />
          <Text style={styles.emblemHint}>Add emblem</Text>
        </View>
      )}
      <View style={styles.emblemBadge}>
        <Ionicons name="camera" size={13} color={colors.bg} />
      </View>
    </Pressable>
  );
}

/**
 * Where this club will live.
 *
 * Resolved by the server from the position it already holds. This never sends a
 * place of its own: it shows what the server found, and reports back only which
 * of the offered levels the creator picked.
 */
function VisibilitySection({ place, loadingPlace, levelOptions, level, onSelectLevel, onRetry }: {
  place: MyClubLocation;
  loadingPlace: boolean;
  levelOptions: ClubVisibilityLevel[];
  level: ClubVisibilityLevel | null;
  onSelectLevel: (level: ClubVisibilityLevel) => void;
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  if (loadingPlace) {
    return (
      <View style={styles.placeCard}>
        <ActivityIndicator color={colors.teal} size="small" />
        <Text style={styles.placeHint}>Working out where you are…</Text>
      </View>
    );
  }

  if (!place.resolved || levelOptions.length === 0) {
    return (
      <View style={styles.placeCard}>
        <Ionicons name="location-outline" size={18} color={colors.t3} />
        <Text style={styles.placeHint}>
          {place.detail ||
            'Aura could not work out which area you are in, so a club cannot be created here yet.'}
        </Text>
        <Pressable
          style={styles.retryBtn}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Check my location again"
        >
          <Text style={styles.retryBtnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <View style={styles.placeCard}>
        <Text style={styles.placeCaption}>Current location</Text>
        {(['city', 'region', 'district'] as ClubVisibilityLevel[]).map((tier) =>
          place[tier] ? (
            <Text key={tier} style={styles.placeLine}>
              <Text style={styles.placeTier}>
                {tier[0].toUpperCase() + tier.slice(1)}:{' '}
              </Text>
              {place[tier]!.name}
            </Text>
          ) : null,
        )}
      </View>

      {levelOptions.map((option) => {
        const selected = level === option;
        return (
          <Pressable
            key={option}
            style={[styles.levelRow, selected && styles.levelRowActive]}
            onPress={() => onSelectLevel(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={levelLabel(option, place)}
            accessibilityHint={LEVEL_HINT[option]}
          >
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={selected ? colors.teal : colors.t3}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.levelName, selected && styles.levelNameActive]}>
                {levelLabel(option, place)}
              </Text>
              <Text style={styles.levelHint}>{LEVEL_HINT[option]}</Text>
            </View>
          </Pressable>
        );
      })}

      {/* Said once, plainly: this is not editable later, and it is the
          thing people get wrong about a scoped club. */}
      <Text style={styles.levelFootnote}>
        People outside the area you pick will not see this club. A club
        never reaches beyond its city.
      </Text>
    </>
  );
}

function InterestPickerModal({ visible, loading, interests, query, selectedId, onQueryChange, onSelect, onDismiss }: {
  visible: boolean;
  loading: boolean;
  interests: Interest[];
  query: string;
  selectedId: number | null;
  onQueryChange: (q: string) => void;
  onSelect: (interest: Interest) => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.modalBackdrop} onPress={onDismiss} />
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <Text style={styles.modalTitle}>Pick an Interest</Text>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.t3} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search interests…"
            placeholderTextColor={colors.t3}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search interests"
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => onQueryChange('')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close" size={16} color={colors.t3} />
            </Pressable>
          )}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.teal} style={{ marginTop: 24 }} />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {interests.map((interest) => (
              <Pressable
                key={interest.id}
                style={[styles.interestRow, selectedId === interest.id && styles.interestRowActive]}
                onPress={() => onSelect(interest)}
              >
                <Text style={styles.interestIcon}>{interest.icon}</Text>
                <Text style={[styles.interestName, selectedId === interest.id && styles.interestNameActive]}>
                  {interest.name}
                </Text>
                {selectedId === interest.id && (
                  <Ionicons name="checkmark" size={18} color={colors.teal} />
                )}
              </Pressable>
            ))}
            {interests.length === 0 && (
              <Text style={styles.interestEmpty}>Nothing matches “{query.trim()}”.</Text>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

export default function CreateClubScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { top } = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emblemUri, setEmblemUri] = useState<string | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selectedInterest, setSelectedInterest] = useState<Interest | null>(null);
  const [showInterestPicker, setShowInterestPicker] = useState(false);
  const [loadingInterests, setLoadingInterests] = useState(false);
  const [interestQuery, setInterestQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // ── Where this club will live ──────────────────────────────────────────────
  // Resolved by the server from the position it already holds. The screen never
  // sends a place of its own: it shows what the server found, and sends back
  // only which of the offered levels the creator picked.
  const [place, setPlace] = useState<MyClubLocation>(UNPLACED);
  const [loadingPlace, setLoadingPlace] = useState(true);
  const [level, setLevel] = useState<ClubVisibilityLevel | null>(null);

  const levelOptions = useMemo(
    () => LEVEL_ORDER.filter((l) => place.available_levels.includes(l)),
    [place.available_levels],
  );

  async function loadPlace(refresh = false) {
    // The first load is allowed to go upstream: in a city nobody has opened
    // this screen in before, that lookup is what puts the boundaries in the
    // shared cache — and everyone who follows reads them for free.
    const next = await fetchMyLocation(refresh);
    setPlace(next);
    // Default to the widest option, which is the least surprising thing to
    // create by accident. Anything narrower is a deliberate choice.
    setLevel((current) =>
      current && next.available_levels.includes(current)
        ? current
        : (next.available_levels.includes('city') ? 'city' : next.available_levels[0] ?? null),
    );
    // A lookup that fails still has to end the spinner: without that, a dropped
    // connection here left "Finding where you are…" on screen for good, with no
    // Retry to press because Retry lives past the spinner. `fetchMyLocation`
    // answers with UNPLACED instead of rejecting, so a plain trailing statement
    // gives that guarantee — and unlike a `finally`, React Compiler can compile
    // it rather than giving up on this whole screen.
    setLoadingPlace(false);
  }

  useEffect(() => {
    loadPlace(true);
  }, []);

  /** Retry path: the flag only has to be re-armed once it has been cleared,
   *  which is never the case on mount — it starts true. */
  function reloadPlace() {
    setLoadingPlace(true);
    loadPlace(true);
  }

  // The catalog is hundreds of interests long. Same filter as the two interest
  // screens, so searching means the same thing everywhere it appears.
  const normalizedQuery = interestQuery.trim().toLowerCase();
  const visibleInterests = normalizedQuery
    ? interests.filter((i) => i.name.toLowerCase().includes(normalizedQuery))
    : interests;

  async function openInterestPicker() {
    setShowInterestPicker(true);
    if (interests.length > 0) return;
    setLoadingInterests(true);
    await runBusy(async () => {
      const res = await api.get<Interest[]>('/api/interests/');
      const data = res.data;
      setInterests(Array.isArray(data) ? data : (data as any).results ?? []);
    }, () => setLoadingInterests(false))
      .catch(() => Alert.alert('Error', 'Could not load interests.'));
  }

  async function pickEmblem() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to upload an emblem.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setEmblemUri(result.assets[0].uri);
    }
  }

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your club a name.');
      return;
    }
    if (!level) {
      Alert.alert(
        'Where is this club?',
        place.detail || 'Aura needs to know where you are before you can create a club.',
      );
      return;
    }
    setSubmitting(true);
    // Safe to clear the flag on the success path too: `success` swaps the
    // button out for the banner, so there is nothing left to double-tap while
    // the 1200ms hand-off to the club screen plays.
    await runBusy(async () => {
      const form = new FormData();
      form.append('name', name.trim());
      if (description.trim()) form.append('description', description.trim());
      if (selectedInterest) form.append('interest_id', String(selectedInterest.id));
      form.append('visibility_level', level);
      // The place this screen actually showed. The server ignores it for
      // scoping — it resolves the creator's position itself — and uses it only
      // to notice that they have moved since the options were drawn.
      const shown = place[level]?.id;
      if (shown) form.append('visibility_place_id', String(shown));
      if (emblemUri) {
        form.append('emblem', {
          uri: emblemUri,
          name: emblemUri.split('/').pop() ?? 'emblem.jpg',
          type: 'image/jpeg',
        } as any);
      }
      const res = await clubsApi.create(form);
      setSuccess(true);
      setTimeout(() => {
        router.replace({
          pathname: '/clubs/[id]',
          params: { id: res.data.id, fromCreate: '1' },
        } as any);
      }, 1200);
    }, () => setSubmitting(false)).catch((e: any) => {
      if (e?.response?.status === 409) {
        // Moved between opening the picker and pressing create. Re-resolve so
        // the options describe where they are now, and let them look again.
        Alert.alert('You have moved', e.response.data?.detail ?? 'Check the area and try again.');
        reloadPlace();
      } else {
        Alert.alert('Error', e?.response?.data?.detail ?? 'Could not create club. Try again.');
      }
    });
  }

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </Pressable>
        <Text style={styles.headerTitle}>Create Club</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <EmblemPicker emblemUri={emblemUri} onPick={pickEmblem} />

          {/* Name */}
          <Text style={styles.label}>Club Name <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Morning Runners"
            placeholderTextColor={colors.t3}
            maxLength={60}
          />

          {/* Description */}
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="What's this club about?"
            placeholderTextColor={colors.t3}
            multiline
            numberOfLines={4}
            maxLength={400}
            textAlignVertical="top"
          />

          {/* Interest */}
          <Text style={styles.label}>Interest</Text>
          <Pressable style={styles.selector} onPress={openInterestPicker}>
            {selectedInterest ? (
              <Text style={styles.selectorValue}>
                {selectedInterest.icon}  {selectedInterest.name}
              </Text>
            ) : (
              <Text style={styles.selectorPlaceholder}>Select an interest…</Text>
            )}
            <Ionicons name="chevron-down" size={16} color={colors.t3} />
          </Pressable>

          {/* Visibility */}
          <Text style={styles.label}>Group visibility <Text style={styles.required}>*</Text></Text>

          <VisibilitySection
            place={place}
            loadingPlace={loadingPlace}
            levelOptions={levelOptions}
            level={level}
            onSelectLevel={setLevel}
            onRetry={reloadPlace}
          />

          {/* Submit / success */}
          {success ? (
            <View style={styles.successBanner}>
              <Text style={styles.successText}>Club created! 🎉</Text>
            </View>
          ) : (
            <Pressable
              style={[styles.createBtn, (submitting || !level) && styles.createBtnOff]}
              onPress={handleCreate}
              disabled={submitting || !level}
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting || !level }}
            >
              {submitting
                ? <ActivityIndicator color={colors.bg} size="small" />
                : <Text style={styles.createBtnText}>Create Club</Text>
              }
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <InterestPickerModal
        visible={showInterestPicker}
        loading={loadingInterests}
        interests={visibleInterests}
        query={interestQuery}
        selectedId={selectedInterest?.id ?? null}
        onQueryChange={setInterestQuery}
        onSelect={(interest) => {
          setSelectedInterest(interest);
          setShowInterestPicker(false);
          setInterestQuery('');
        }}
        onDismiss={() => setShowInterestPicker(false)}
      />
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 40, alignItems: 'flex-start' },
  headerTitle: { fontFamily: fonts.display, fontSize: 18, fontWeight: '600', color: colors.t1 },

  scroll: { padding: 20, paddingBottom: 60 },

  emblemWrap: { alignSelf: 'center', marginBottom: 28 },
  emblemImage: { width: 96, height: 96, borderRadius: 48 },
  emblemPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emblemHint: { fontFamily: fonts.body, fontSize: 11, color: colors.t3 },
  emblemBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },

  label: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.t2,
    marginBottom: 8,
    marginTop: 20,
  },
  required: { color: colors.red },

  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t1,
  },
  textArea: { height: 100, paddingTop: 13 },

  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  selectorValue: { fontFamily: fonts.body, fontSize: 15, color: colors.t1 },
  selectorPlaceholder: { fontFamily: fonts.body, fontSize: 15, color: colors.t3 },

  // Visibility
  placeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 6,
    marginBottom: 12,
  },
  placeCaption: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: colors.t3,
    textTransform: 'uppercase',
  },
  placeLine: { fontFamily: fonts.body, fontSize: 14, color: colors.t1 },
  placeTier: { color: colors.t3 },
  placeHint: { fontFamily: fonts.body, fontSize: 13, color: colors.t2, lineHeight: 19 },
  retryBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.m,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
  },
  retryBtnText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.teal },

  levelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    // 44pt minimum touch target, which the two lines of text clear on their
    // own; the padding is what keeps a one-line row from falling short.
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: 8,
  },
  levelRowActive: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  levelName: { fontFamily: fonts.body, fontSize: 15, color: colors.t1 },
  levelNameActive: { fontWeight: '700', color: colors.teal },
  levelHint: { fontFamily: fonts.body, fontSize: 12, color: colors.t2, marginTop: 2 },
  levelFootnote: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.t2,
    lineHeight: 17,
    marginTop: 4,
  },

  createBtn: {
    marginTop: 36,
    backgroundColor: colors.teal,
    borderRadius: radius.l,
    paddingVertical: 15,
    alignItems: 'center',
  },
  createBtnOff: { opacity: 0.6 },
  createBtnText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: colors.bg },

  successBanner: {
    marginTop: 36,
    backgroundColor: colors.tealTint,
    borderWidth: 1,
    borderColor: colors.tealLine,
    borderRadius: radius.l,
    paddingVertical: 15,
    alignItems: 'center',
  },
  successText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: colors.teal },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  modalTitle: { fontFamily: fonts.display, fontSize: 18, fontWeight: '600', color: colors.t1, marginBottom: 12 },
  interestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 44,
    paddingHorizontal: 14,
    marginBottom: 12,
    backgroundColor: colors.bg,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t1,
    paddingVertical: 0,
  },

  interestRowActive: { opacity: 1 },
  interestIcon: { fontSize: 20 },
  interestEmpty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t3,
    textAlign: 'center',
    paddingVertical: 24,
  },
  interestName: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.t2 },
  interestNameActive: { color: colors.t1, fontWeight: '600' },
});
