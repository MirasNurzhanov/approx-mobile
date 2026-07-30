import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { api } from '@/services/api';
import { clubsApi } from '@/services/clubs';
import { colors, fonts, radius } from '@/constants/theme';

interface Interest {
  id: number;
  name: string;
  icon: string;
}

export default function CreateClubScreen() {
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
    try {
      const res = await api.get<Interest[]>('/api/interests/');
      const data = res.data;
      setInterests(Array.isArray(data) ? data : (data as any).results ?? []);
    } catch {
      Alert.alert('Error', 'Could not load interests.');
    } finally {
      setLoadingInterests(false);
    }
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
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('name', name.trim());
      if (description.trim()) form.append('description', description.trim());
      if (selectedInterest) form.append('interest_id', String(selectedInterest.id));
      if (emblemUri) {
        form.append('emblem', {
          uri: emblemUri,
          name: emblemUri.split('/').pop() ?? 'emblem.jpg',
          type: 'image/jpeg',
        } as any);
      }
      const res = await clubsApi.create(form);
      router.replace({ pathname: '/clubs/[id]', params: { id: res.data.id } } as any);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not create club. Try again.');
    } finally {
      setSubmitting(false);
    }
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
          {/* Emblem */}
          <TouchableOpacity style={styles.emblemWrap} onPress={pickEmblem} activeOpacity={0.8}>
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
          </TouchableOpacity>

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

          {/* Submit */}
          <Pressable
            style={[styles.createBtn, submitting && styles.createBtnOff]}
            onPress={handleCreate}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator color={colors.bg} size="small" />
              : <Text style={styles.createBtnText}>Create Club</Text>
            }
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Interest picker modal */}
      <Modal visible={showInterestPicker} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowInterestPicker(false)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Pick an Interest</Text>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.t3} />
            <TextInput
              style={styles.searchInput}
              value={interestQuery}
              onChangeText={setInterestQuery}
              placeholder="Search interests…"
              placeholderTextColor={colors.t3}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search interests"
            />
            {interestQuery.length > 0 && (
              <Pressable
                onPress={() => setInterestQuery('')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close" size={16} color={colors.t3} />
              </Pressable>
            )}
          </View>

          {loadingInterests ? (
            <ActivityIndicator color={colors.teal} style={{ marginTop: 24 }} />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {visibleInterests.map((interest) => (
                <Pressable
                  key={interest.id}
                  style={[styles.interestRow, selectedInterest?.id === interest.id && styles.interestRowActive]}
                  onPress={() => {
                    setSelectedInterest(interest);
                    setShowInterestPicker(false);
                    setInterestQuery('');
                  }}
                >
                  <Text style={styles.interestIcon}>{interest.icon}</Text>
                  <Text style={[styles.interestName, selectedInterest?.id === interest.id && styles.interestNameActive]}>
                    {interest.name}
                  </Text>
                  {selectedInterest?.id === interest.id && (
                    <Ionicons name="checkmark" size={18} color={colors.teal} />
                  )}
                </Pressable>
              ))}
              {visibleInterests.length === 0 && (
                <Text style={styles.interestEmpty}>Nothing matches “{interestQuery.trim()}”.</Text>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
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

  createBtn: {
    marginTop: 36,
    backgroundColor: colors.teal,
    borderRadius: radius.l,
    paddingVertical: 15,
    alignItems: 'center',
  },
  createBtnOff: { opacity: 0.6 },
  createBtnText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: colors.bg },

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
