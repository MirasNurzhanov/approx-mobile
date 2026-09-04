import { useRouter } from 'expo-router';
import { useEffect, useReducer, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';
import { runBusy } from '@/services/busy';
import { pushProfileUpdate } from '@/services/profileRefresh';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { PROFESSIONS, COUNTRIES, flagEmoji } from '@/constants/onboardingData';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Profile {
  id: number;
  username: string;
  bio?: string;
  profile_picture?: string;
  profession?: string | null;
  nationality?: string | null;
}

// ─── Editable fields ──────────────────────────────────────────────────────────
// Everything the form itself edits, as one unit: these five are the only state
// this screen sets in bulk — once from the initial fetch, once from a
// successful save — while each also changes on its own as the user types or
// picks. One reducer for both stories beats a matching pair of setters at
// every call site.
interface EditableFields {
  username: string;
  bio: string;
  profession: string | null;
  nationality: string | null;
  /** The server's nationality as of the last load/save — drives the lock,
   *  separately from the value itself. */
  origNationality: string | null;
}

const initialFields: EditableFields = {
  username: '',
  bio: '',
  profession: null,
  nationality: null,
  origNationality: null,
};

type FieldsAction =
  /** Bulk-loads all five from a server `Profile`, on initial fetch and again
   *  after a successful save — the only two moments they change as a unit. */
  | { type: 'synced'; data: Profile }
  | { type: 'username'; value: string }
  | { type: 'bio'; value: string }
  | { type: 'profession'; value: string | null }
  | { type: 'nationality'; value: string | null };

function fieldsReducer(state: EditableFields, action: FieldsAction): EditableFields {
  switch (action.type) {
    case 'synced':
      return {
        username: action.data.username,
        bio: action.data.bio ?? '',
        profession: action.data.profession ?? null,
        nationality: action.data.nationality ?? null,
        origNationality: action.data.nationality ?? null,
      };
    case 'username':
      return { ...state, username: action.value };
    case 'bio':
      return { ...state, bio: action.value };
    case 'profession':
      return { ...state, profession: action.value };
    case 'nationality':
      return { ...state, nationality: action.value };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#be185d', '#0284c7'];

function avatarColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + (hash << 5) - hash;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const SCREEN_W  = Dimensions.get('window').width;
const CARD_PAD  = 16;
const CARD_GAP  = 12;
const CARD_W    = (SCREEN_W - CARD_PAD * 2 - CARD_GAP) / 2;

// ─── Pieces ───────────────────────────────────────────────────────────────────

function AvatarPicker({ pictureUrl, initial, bgColor, uploading, onPick }: {
  pictureUrl?: string;
  initial: string;
  bgColor: string;
  uploading: boolean;
  onPick: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.avatarWrap, pressed && { opacity: 0.85 }]}
        onPress={onPick}
        disabled={uploading}
      >
        <View style={[styles.avatarRing, { borderColor: bgColor + '55' }]}>
          <View style={[styles.avatar, { backgroundColor: bgColor }]}>
            {pictureUrl
              ? <Image source={{ uri: pictureUrl }} style={styles.avatarImage} />
              : <Text style={styles.avatarInitial}>{initial}</Text>
            }
            {uploading && (
              <View style={styles.avatarUploadOverlay}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            )}
          </View>
        </View>
        <View style={styles.cameraBadge}>
          <Ionicons name="camera" size={12} color="#fff" />
        </View>
      </Pressable>
      <Text style={styles.avatarHint}>Tap to change photo</Text>
    </>
  );
}

function ProfessionPickerModal({ visible, draft, onDraftChange, onCancel, onDone }: {
  visible: boolean;
  draft: string | null;
  onDraftChange: (key: string | null) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <View style={[styles.modalRoot, { backgroundColor: colors.bg }]}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Pressable
            onPress={onCancel}
            hitSlop={10}
            style={({ pressed }) => pressed && { opacity: 0.2 }}
          >
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Profession</Text>
          <Pressable
            onPress={onDone}
            hitSlop={10}
            style={({ pressed }) => pressed && { opacity: 0.2 }}
          >
            <Text style={styles.modalDone}>Done</Text>
          </Pressable>
        </View>

        <FlatList
          data={PROFESSIONS}
          keyExtractor={(item) => item.key}
          numColumns={2}
          windowSize={5}
          initialNumToRender={8}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.profGrid}
          columnWrapperStyle={{ gap: CARD_GAP }}
          ItemSeparatorComponent={() => <View style={{ height: CARD_GAP }} />}
          renderItem={({ item }) => {
            const sel = draft === item.key;
            return (
              <Pressable
                onPress={() => onDraftChange(sel ? null : item.key)}
                style={({ pressed }) => [
                  styles.profCard,
                  { width: CARD_W },
                  sel && styles.profCardSel,
                  pressed && { opacity: 0.75 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: sel }}
                accessibilityLabel={item.label}
              >
                <Text style={styles.profEmoji}>{item.emoji}</Text>
                <Text style={[styles.profCardLabel, sel && styles.profCardLabelSel]} numberOfLines={2}>
                  {item.label}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

function NationalityPickerModal({ visible, draft, query, countries, onDraftChange, onQueryChange, onCancel, onDone }: {
  visible: boolean;
  draft: string | null;
  query: string;
  countries: typeof COUNTRIES;
  onDraftChange: (code: string | null) => void;
  onQueryChange: (q: string) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <View style={[styles.modalRoot, { backgroundColor: colors.bg }]}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Pressable
            onPress={onCancel}
            hitSlop={10}
            style={({ pressed }) => pressed && { opacity: 0.2 }}
          >
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Nationality</Text>
          <Pressable
            onPress={onDone}
            hitSlop={10}
            style={({ pressed }) => pressed && { opacity: 0.2 }}
          >
            <Text style={styles.modalDone}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.t3} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search countries..."
            placeholderTextColor={colors.t3}
            selectionColor={colors.teal}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => onQueryChange('')}
              hitSlop={10}
              style={({ pressed }) => pressed && { opacity: 0.2 }}
            >
              <Ionicons name="close-circle" size={18} color={colors.t3} />
            </Pressable>
          )}
        </View>

        <FlatList
          data={countries}
          keyExtractor={(item) => item.code}
          windowSize={5}
          initialNumToRender={8}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={({ item }) => {
            const sel = draft === item.code;
            return (
              <Pressable
                onPress={() => onDraftChange(sel ? null : item.code)}
                style={({ pressed }) => [styles.natRow, sel && styles.natRowSel, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityState={{ selected: sel }}
                accessibilityLabel={item.name}
              >
                <Text style={styles.natFlag}>{flagEmoji(item.code)}</Text>
                <Text style={[styles.natName, sel && styles.natNameSel]}>{item.name}</Text>
                {sel && <Ionicons name="checkmark" size={18} color={colors.teal} />}
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.natSep} />}
        />
      </View>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function EditProfileScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { top, bottom } = useSafeAreaInsets();

  const [profile,   setProfile]   = useState<Profile | null>(null);
  const [fields, dispatch] = useReducer(fieldsReducer, initialFields);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [uploading, setUploading] = useState(false);

  // Picker modal state
  const [showProfPicker, setShowProfPicker] = useState(false);
  const [showNatPicker,  setShowNatPicker]  = useState(false);
  const [draftProf, setDraftProf] = useState<string | null>(null);
  const [draftNat,  setDraftNat]  = useState<string | null>(null);
  const [natQuery,  setNatQuery]  = useState('');

  // Track the server-loaded profession to decide what to PATCH. Stays a ref
  // — only `save` ever reads it — while `fields.origNationality` is state,
  // because the lock it drives is read while rendering the field.
  const origProfession = useRef<string | null>(null);

  useEffect(() => {
    api.get<Profile>('/api/users/profile/')
      .then((r) => {
        setProfile(r.data);
        dispatch({ type: 'synced', data: r.data });
        origProfession.current = r.data.profession ?? null;
      })
      .catch((e) => console.log('[EditProfile] fetch error:', e?.response?.status))
      .finally(() => setLoading(false));
  }, []);

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await uploadProfilePicture(result.assets[0].uri);
    }
  }

  async function uploadProfilePicture(uri: string) {
    setUploading(true);
    await runBusy(async () => {
      const filename = uri.split('/').pop() ?? 'photo.jpg';
      const ext = /\.(\w+)$/.exec(filename)?.[1]?.toLowerCase() ?? 'jpeg';
      const type = ext === 'png' ? 'image/png' : 'image/jpeg';
      const form = new FormData();
      form.append('profile_picture', { uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri, name: filename, type } as any);
      const { data } = await api.patch<Profile>('/api/users/profile/', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProfile(data);
      pushProfileUpdate(data);
    }, () => setUploading(false)).catch((e: any) =>
      Alert.alert('Upload failed', e?.response?.data?.detail ?? 'Could not upload photo.'),
    );
  }

  async function save() {
    if (!fields.username.trim() || saving) return;
    setSaving(true);
    await runBusy(async () => {
      const payload: Record<string, any> = {
        username: fields.username.trim(),
        bio: fields.bio.trim(),
      };
      if (fields.profession !== origProfession.current) {
        payload.profession = fields.profession;
      }
      // Nationality can only be set once: only include when original was null and user chose one
      if (fields.origNationality === null && fields.nationality !== null) {
        payload.nationality = fields.nationality;
      }
      const { data } = await api.patch<Profile>('/api/users/profile/', payload);
      dispatch({ type: 'synced', data });
      origProfession.current = data.profession ?? null;
      pushProfileUpdate(data);
      router.back();
    }, () => setSaving(false)).catch((e: any) => {
      const msg = e?.response?.data?.username?.[0] ?? e?.response?.data?.detail ?? 'Could not save changes.';
      Alert.alert('Error', msg);
    });
  }

  // ── Derived display values ─────────────────────────────────────────────────
  const professionLabel    = fields.profession ? PROFESSIONS.find(p => p.key === fields.profession)?.label ?? fields.profession : null;
  const nationalityCountry = fields.nationality ? COUNTRIES.find(c => c.code === fields.nationality) : null;
  const nationalityLocked  = fields.origNationality !== null;
  const filteredCountries  = natQuery.trim()
    ? COUNTRIES.filter(c => c.name.toLowerCase().includes(natQuery.trim().toLowerCase()))
    : COUNTRIES;

  const initial = (fields.username || profile?.username || '?').charAt(0).toUpperCase();
  const bgColor = avatarColor(fields.username || profile?.username || '?');

  return (
    <View style={styles.root}>

      {/* ── Header ── */}
      <ScreenHeader
        title="Edit Profile"
        action={{
          label: 'Save',
          onPress: save,
          disabled: saving || !fields.username.trim(),
          prominent: true,
        }}
      >
        <View style={[styles.header, { paddingTop: top + 6 }]}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.2 }]}
          >
            <Ionicons name="chevron-back" size={26} color={colors.teal} />
          </Pressable>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <Pressable
            onPress={save}
            disabled={saving || !fields.username.trim()}
            hitSlop={12}
            style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.2 }]}
          >
            {saving
              ? <ActivityIndicator color={colors.teal} size="small" />
              : <Text style={[styles.saveText, !fields.username.trim() && { opacity: 0.4 }]}>Save</Text>
            }
          </Pressable>
        </View>
      </ScreenHeader>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 40 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <AvatarPicker
              pictureUrl={profile?.profile_picture}
              initial={initial}
              bgColor={bgColor}
              uploading={uploading}
              onPick={pickImage}
            />

            {/* ── Username ── */}
            <Text style={styles.fieldLabel}>Username</Text>
            <TextInput
              style={styles.fieldInput}
              value={fields.username}
              onChangeText={(value) => dispatch({ type: 'username', value })}
              placeholder="Username"
              placeholderTextColor={colors.t3}
              selectionColor={colors.teal}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
            />

            {/* ── Bio ── */}
            <Text style={styles.fieldLabel}>Bio</Text>
            <TextInput
              style={[styles.fieldInput, styles.fieldTextarea]}
              value={fields.bio}
              onChangeText={(value) => dispatch({ type: 'bio', value })}
              placeholder="Tell people about yourself…"
              placeholderTextColor={colors.t3}
              selectionColor={colors.teal}
              multiline
              maxLength={200}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{fields.bio.length} / 200</Text>

            {/* ── Profession ── */}
            <Text style={styles.fieldLabel}>Profession</Text>
            <Pressable
              style={({ pressed }) => [styles.fieldInput, styles.fieldRow, pressed && { opacity: 0.7 }]}
              onPress={() => { setDraftProf(fields.profession); setShowProfPicker(true); }}
              accessibilityRole="button"
              accessibilityLabel={professionLabel ?? 'Not set — tap to choose'}
            >
              <Text style={[styles.fieldRowValue, !fields.profession && styles.fieldRowPlaceholder]}>
                {professionLabel ?? 'Not set'}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.t3} />
            </Pressable>

            {/* ── Nationality ── */}
            <Text style={styles.fieldLabel}>Nationality</Text>
            {nationalityLocked ? (
              <View style={[styles.fieldInput, styles.fieldRow, styles.fieldRowLocked]}>
                <Text style={styles.fieldRowValue}>
                  {nationalityCountry
                    ? `${flagEmoji(nationalityCountry.code)}  ${nationalityCountry.name}`
                    : fields.nationality}
                </Text>
                <View style={styles.lockedGroup}>
                  <Ionicons name="lock-closed-outline" size={13} color={colors.t3} />
                  <Text style={styles.lockedNote}>Cannot be changed</Text>
                </View>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.fieldInput, styles.fieldRow, pressed && { opacity: 0.7 }]}
                onPress={() => { setDraftNat(fields.nationality); setNatQuery(''); setShowNatPicker(true); }}
                accessibilityRole="button"
                accessibilityLabel={nationalityCountry ? nationalityCountry.name : 'Not set — tap to choose'}
              >
                <Text style={[styles.fieldRowValue, !fields.nationality && styles.fieldRowPlaceholder]}>
                  {nationalityCountry
                    ? `${flagEmoji(nationalityCountry.code)}  ${nationalityCountry.name}`
                    : 'Not set'}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.t3} />
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <ProfessionPickerModal
        visible={showProfPicker}
        draft={draftProf}
        onDraftChange={setDraftProf}
        onCancel={() => setShowProfPicker(false)}
        onDone={() => { dispatch({ type: 'profession', value: draftProf }); setShowProfPicker(false); }}
      />

      <NationalityPickerModal
        visible={showNatPicker}
        draft={draftNat}
        query={natQuery}
        countries={filteredCountries}
        onDraftChange={setDraftNat}
        onQueryChange={setNatQuery}
        onCancel={() => { setShowNatPicker(false); setNatQuery(''); }}
        onDone={() => { dispatch({ type: 'nationality', value: draftNat }); setShowNatPicker(false); setNatQuery(''); }}
      />

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

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
  saveBtn: { padding: 4, minWidth: 42, alignItems: 'flex-end' },
  saveText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: colors.teal,
  },

  scroll: { paddingHorizontal: 20, paddingTop: 28 },

  avatarWrap: { alignSelf: 'center' },
  avatarRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontSize: 32, fontWeight: '700' },
  avatarImage: { width: 80, height: 80, borderRadius: 40 },
  avatarUploadOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.teal,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.t3,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },

  fieldLabel: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.t3,
    marginTop: 16,
    marginBottom: 6,
  },
  fieldInput: {
    fontFamily: fonts.body,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.t1,
    fontSize: 15,
  },
  fieldTextarea: { minHeight: 100, paddingTop: 12 },
  charCount: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.t3,
    alignSelf: 'flex-end',
    marginTop: 6,
  },

  // Tappable field row (profession / editable nationality)
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldRowValue: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t1,
  },
  fieldRowPlaceholder: { color: colors.t3 },

  // Locked nationality row
  fieldRowLocked: { opacity: 0.9 },
  lockedGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  lockedNote: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.t3,
  },

  // ── Picker modals ──────────────────────────────────────────────────────────
  modalRoot: { flex: 1 },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 16,
    color: colors.t1,
  },
  modalCancel: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t2,
  },
  modalDone: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: colors.teal,
  },

  // Profession grid
  profGrid: { padding: CARD_PAD },
  profCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.m,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 100,
  },
  profCardSel: {
    backgroundColor: colors.coralSoft,
    borderColor: colors.coral,
  },
  profEmoji: { fontSize: 28 },
  profCardLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: colors.t2,
    textAlign: 'center',
  },
  profCardLabelSel: {
    color: colors.coral,
    fontWeight: '600',
  },

  // Search bar (nationality modal)
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t1,
  },

  // Country list rows
  natRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 13,
    gap: 14,
  },
  natRowSel: { backgroundColor: colors.coralSoft },
  natFlag: { fontSize: 24 },
  natName: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.t1,
  },
  natNameSel: {
    color: colors.coral,
    fontWeight: '600',
  },
  natSep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 58,
  },
});
