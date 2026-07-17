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
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { colors, fonts, radius } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface ZoneSettings {
  zone_preset?: string;
  preset?: string;
  active?: boolean;
  zone_active?: boolean;
  custom_audio_url?: string;
}

interface Preset {
  id: string;
  name: string;
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

const FALLBACK_PRESETS: Preset[] = [
  { id: 'rain',      name: 'Rain'      },
  { id: 'cafe',      name: 'Café'      },
  { id: 'forest',    name: 'Forest'    },
  { id: 'ocean',     name: 'Ocean'     },
  { id: 'fireplace', name: 'Fireplace' },
  { id: 'lofi',      name: 'Lo-fi'     },
];

// ─── Card width for 2-column grid ────────────────────────────────────────────
const SCREEN_W = Dimensions.get('window').width;
const CARD_W = (SCREEN_W - 40 - 10) / 2; // 20px side padding each side, 10px gap

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ZoneScreen() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();

  const [presets, setPresets] = useState<Preset[]>(FALLBACK_PRESETS);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [customAudioName, setCustomAudioName] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    async function init() {
      const [zoneRes, presetsRes] = await Promise.allSettled([
        api.get<ZoneSettings>('/api/users/zone/'),
        api.get<Preset[] | { presets: Preset[] }>('/api/users/zone/presets/'),
      ]);

      if (zoneRes.status === 'fulfilled') {
        const d = zoneRes.value.data;
        setSelectedPreset(d.zone_preset ?? d.preset ?? null);
        setActive(d.zone_active ?? d.active ?? true);
        if (d.custom_audio_url) setCustomAudioName('Current custom audio');
      }

      if (presetsRes.status === 'fulfilled') {
        const raw = presetsRes.value.data;
        const list: Preset[] = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as any).presets)
            ? (raw as any).presets
            : [];
        if (list.length > 0) setPresets(list);
      }
    }

    init().finally(() => setLoading(false));
  }, []);

  async function selectPreset(id: string | null) {
    const prev = selectedPreset;
    setSelectedPreset(id);
    try {
      await api.patch('/api/users/zone/', { zone_preset: id ?? '' });
    } catch {
      setSelectedPreset(prev);
    }
  }

  async function handleCustomAudio() {
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    } catch { return; }
    if (result.canceled) return;

    const asset = result.assets[0];
    setCustomAudioName(asset.name);
    setUploading(true);

    const formData = new FormData();
    formData.append('zone_audio', { uri: asset.uri, type: asset.mimeType ?? 'audio/mpeg', name: asset.name } as any);

    try {
      await api.patch('/api/users/zone/', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    } catch (e: any) {
      Alert.alert('Upload Failed', e?.response?.data?.detail ?? 'Could not upload audio file.');
      setCustomAudioName(null);
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch('/api/users/zone/', { zone_radius: 500, zone_active: active });
      router.back();
    } catch (e: any) {
      Alert.alert('Save Failed', e?.response?.data?.detail ?? 'Could not save zone settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  // All options: presets + None at end
  const allOptions = [...presets, null]; // null = None

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </Pressable>
        <Text style={styles.headerTitle}>Zone Setup</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Zone active toggle */}
        <Card style={styles.toggleCard}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleLabel}>Zone Active</Text>
              <Text style={styles.toggleSub}>People nearby will hear your audio</Text>
            </View>
            <Switch
              value={active}
              onValueChange={setActive}
              trackColor={{ false: colors.surface2, true: colors.teal }}
              thumbColor={colors.t1}
              ios_backgroundColor={colors.surface2}
            />
          </View>
        </Card>

        {/* Sound presets */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PRESET SOUNDS</Text>
          <View style={styles.presetGrid}>
            {allOptions.map((p, i) => {
              const isNone = p === null;
              const id = isNone ? null : p!.id;
              const name = isNone ? 'None' : p!.name;
              const icon: IoniconsName = isNone
                ? 'ban-outline'
                : (PRESET_ICONS[p!.id] ?? 'musical-notes-outline');
              const selected = selectedPreset === id;

              return (
                <Pressable
                  key={isNone ? '__none__' : p!.id}
                  style={({ pressed }) => [
                    styles.presetCard,
                    selected ? styles.presetCardSelected : null,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => selectPreset(id)}
                >
                  <Ionicons
                    name={icon}
                    size={26}
                    color={selected ? colors.teal : colors.t3}
                  />
                  <Text style={[styles.presetName, selected && styles.presetNameSelected]}>
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Custom audio */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CUSTOM AUDIO</Text>
          <Pressable
            style={({ pressed }) => [
              styles.uploadCard,
              customAudioName ? styles.uploadCardActive : null,
              pressed && styles.pressed,
            ]}
            onPress={handleCustomAudio}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator color={colors.teal} size="small" />
            ) : (
              <Ionicons
                name={customAudioName ? 'musical-notes' : 'cloud-upload-outline'}
                size={22}
                color={customAudioName ? colors.teal : colors.t3}
              />
            )}
            <View style={styles.uploadText}>
              <Text style={[styles.uploadLabel, customAudioName && styles.uploadLabelActive]}>
                {uploading ? 'Uploading…' : customAudioName ?? 'Upload audio'}
              </Text>
              <Text style={styles.uploadHint}>MP3, M4A, WAV</Text>
            </View>
          </Pressable>
        </View>

        {/* Save */}
        <Button
          label="Save"
          variant="primary"
          size="lg"
          fullWidth
          loading={saving}
          onPress={handleSave}
        />
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
  headerSpacer: { width: 32 },

  scroll: { paddingHorizontal: 20, paddingTop: 24 },

  // Toggle card
  toggleCard: { marginBottom: 28 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  toggleText: { flex: 1, gap: 4 },
  toggleLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: colors.t1,
  },
  toggleSub: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
    lineHeight: 18,
  },

  // Section
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

  // Preset grid
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
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

  // Upload card
  uploadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 20,
    paddingHorizontal: 18,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  uploadCardActive: {
    borderStyle: 'solid',
    backgroundColor: colors.tealTint,
    borderColor: colors.tealLine,
  },
  uploadText: { flex: 1, gap: 4 },
  uploadLabel: {
    fontFamily: fonts.body,
    fontWeight: '500',
    fontSize: 14,
    color: colors.t2,
  },
  uploadLabelActive: { color: colors.teal },
  uploadHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.t3,
  },

  pressed: { opacity: 0.6 },
});
