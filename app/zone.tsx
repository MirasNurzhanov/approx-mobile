import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/services/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ZoneSettings {
  zone_preset?: string;
  preset?: string;
  radius?: number;
  zone_radius?: number;
  active?: boolean;
  zone_active?: boolean;
  custom_audio_url?: string;
}

interface Preset {
  id: string;
  name: string;
  emoji: string;
}

// ─── Fallback presets (used if API returns empty) ─────────────────────────────
const FALLBACK_PRESETS: Preset[] = [
  { id: 'rain',      emoji: '🌧️', name: 'Rain'      },
  { id: 'cafe',      emoji: '☕',  name: 'Café'      },
  { id: 'forest',    emoji: '🌲', name: 'Forest'    },
  { id: 'ocean',     emoji: '🌊', name: 'Ocean'     },
  { id: 'fireplace', emoji: '🔥', name: 'Fireplace' },
  { id: 'lofi',      emoji: '🎵', name: 'Lo-fi'     },
];

const RADIUS_OPTIONS: { label: string; value: number }[] = [
  { label: '100 m', value: 100  },
  { label: '500 m', value: 500  },
  { label: '1 km',  value: 1000 },
];

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ZoneScreen() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();

  const [presets, setPresets] = useState<Preset[]>(FALLBACK_PRESETS);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [radius, setRadius] = useState<number>(500);
  const [active, setActive] = useState(true);
  const [customAudioName, setCustomAudioName] = useState<string | null>(null);
  const [customAudioUri, setCustomAudioUri] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // ── Fetch zone settings + presets ─────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const [zoneRes, presetsRes] = await Promise.allSettled([
        api.get<ZoneSettings>('/api/users/zone/'),
        api.get<Preset[] | { presets: Preset[] }>('/api/users/zone/presets/'),
      ]);

      if (zoneRes.status === 'fulfilled') {
        const d = zoneRes.value.data;
        setSelectedPreset(d.zone_preset ?? d.preset ?? null);
        setRadius(d.zone_radius ?? d.radius ?? 500);
        setActive(d.zone_active ?? d.active ?? true);
        if (d.custom_audio_url) setCustomAudioName('Current custom audio');
      } else {
        console.log('[Zone] settings fetch error:', zoneRes.reason?.response?.status);
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

  // ── Select preset ─────────────────────────────────────────────────────────
  async function handlePresetSelect(id: string) {
    if (id === selectedPreset) return;
    setSelectedPreset(id);
    setCustomAudioName(null);
    setCustomAudioUri(null);
    try {
      await api.patch('/api/users/zone/', { zone_preset: id });
    } catch (e: any) {
      console.log('[Zone] preset PATCH error:', e?.response?.status, JSON.stringify(e?.response?.data));
    }
  }

  // ── Custom audio upload ───────────────────────────────────────────────────
  async function handleCustomAudio() {
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });
    } catch {
      return;
    }

    if (result.canceled) return;

    const asset = result.assets[0];
    setCustomAudioName(asset.name);
    setCustomAudioUri(asset.uri);
    setSelectedPreset(null);

    setUploading(true);
    const formData = new FormData();
    formData.append('custom_audio', {
      uri:  asset.uri,
      type: asset.mimeType ?? 'audio/mpeg',
      name: asset.name,
    } as any);

    try {
      await api.patch('/api/users/zone/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } catch (e: any) {
      console.log('[Zone] audio upload error:', e?.response?.status, JSON.stringify(e?.response?.data));
      Alert.alert('Upload Failed', e?.response?.data?.detail ?? 'Could not upload audio file.');
      setCustomAudioName(null);
      setCustomAudioUri(null);
    } finally {
      setUploading(false);
    }
  }

  // ── Save (radius + active toggle) ─────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    try {
      await api.patch('/api/users/zone/', {
        zone_radius: radius,
        zone_active: active,
      });
      router.back();
    } catch (e: any) {
      console.log('[Zone] save error:', e?.response?.status, JSON.stringify(e?.response?.data));
      Alert.alert('Save Failed', e?.response?.data?.detail ?? 'Could not save zone settings.');
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color="#00b4a6" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#00b4a6" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Zone Setup</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Zone active toggle ── */}
        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Zone Active</Text>
              <Text style={styles.toggleSub}>
                Broadcast ambient sound to nearby Aura users
              </Text>
            </View>
            <Switch
              value={active}
              onValueChange={setActive}
              trackColor={{ false: '#1e1e1e', true: '#00b4a640' }}
              thumbColor={active ? '#00b4a6' : '#333'}
              ios_backgroundColor="#1e1e1e"
            />
          </View>
        </View>

        {/* ── Sound Presets ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sound Preset</Text>
          <View style={styles.presetGrid}>
            {presets.map((p) => {
              const selected = selectedPreset === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.presetCard, selected && styles.presetCardSelected]}
                  onPress={() => handlePresetSelect(p.id)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.presetEmoji}>{p.emoji}</Text>
                  <Text style={[styles.presetName, selected && styles.presetNameSelected]}>
                    {p.name}
                  </Text>
                  {selected && (
                    <View style={styles.presetCheck}>
                      <Ionicons name="checkmark" size={10} color="#0a0a0a" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Custom audio ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Custom Audio</Text>
          <TouchableOpacity
            style={[
              styles.uploadCard,
              customAudioName != null && styles.uploadCardActive,
            ]}
            onPress={handleCustomAudio}
            disabled={uploading}
            activeOpacity={0.75}
          >
            {uploading ? (
              <ActivityIndicator color="#00b4a6" size="small" />
            ) : (
              <Ionicons
                name={customAudioName ? 'musical-notes' : 'cloud-upload-outline'}
                size={22}
                color={customAudioName ? '#00b4a6' : '#444'}
              />
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.uploadLabel, customAudioName && styles.uploadLabelActive]}>
                {uploading
                  ? 'Uploading…'
                  : customAudioName ?? 'Upload audio file'}
              </Text>
              <Text style={styles.uploadSub}>MP3, AAC, WAV · max 20 MB</Text>
            </View>
            {!uploading && (
              <Ionicons name="chevron-forward" size={16} color="#2e2e2e" />
            )}
          </TouchableOpacity>
        </View>

        {/* ── Zone radius ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Zone Radius</Text>
          <View style={styles.radiusRow}>
            {RADIUS_OPTIONS.map((opt) => {
              const selected = radius === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.radiusBtn, selected && styles.radiusBtnSelected]}
                  onPress={() => setRadius(opt.value)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.radiusLabel, selected && styles.radiusLabelSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.radiusHint}>
            People within this distance will hear your zone
          </Text>
        </View>

        {/* ── Save ── */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnOff]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#0a0a0a" size="small" />
          ) : (
            <Text style={styles.saveBtnText}>Save Zone</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { alignItems: 'center', justifyContent: 'center' },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#141414',
    backgroundColor: '#0a0a0a',
  },
  backBtn: { padding: 4 },
  headerTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700' },

  scroll: { paddingHorizontal: 20, paddingTop: 24 },

  // ── Section ──
  section: { marginBottom: 28 },
  sectionTitle: {
    color: '#444',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  // ── Toggle ──
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 16,
    gap: 12,
  },
  toggleLabel: { color: '#e0e0e0', fontSize: 15, fontWeight: '600' },
  toggleSub: { color: '#444', fontSize: 12, marginTop: 3, lineHeight: 17 },

  // ── Preset grid ──
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  presetCard: {
    width: '30.5%',
    aspectRatio: 1,
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  presetCardSelected: {
    borderColor: '#00b4a6',
    backgroundColor: '#0d1f1e',
    shadowColor: '#00b4a6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  presetEmoji: { fontSize: 28 },
  presetName: { color: '#666', fontSize: 12, fontWeight: '500' },
  presetNameSelected: { color: '#00b4a6' },
  presetCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#00b4a6',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Custom audio ──
  uploadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderStyle: 'dashed',
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 14,
  },
  uploadCardActive: {
    borderColor: '#00b4a650',
    borderStyle: 'solid',
    backgroundColor: '#0d1f1e',
  },
  uploadLabel: { color: '#444', fontSize: 14, fontWeight: '500' },
  uploadLabelActive: { color: '#00b4a6' },
  uploadSub: { color: '#2e2e2e', fontSize: 11, marginTop: 2 },

  // ── Radius selector ──
  radiusRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  radiusBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    alignItems: 'center',
  },
  radiusBtnSelected: {
    borderColor: '#00b4a6',
    backgroundColor: '#0d1f1e',
  },
  radiusLabel: { color: '#555', fontSize: 14, fontWeight: '600' },
  radiusLabelSelected: { color: '#00b4a6' },
  radiusHint: { color: '#2e2e2e', fontSize: 12 },

  // ── Save button ──
  saveBtn: {
    backgroundColor: '#00b4a6',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnOff: { opacity: 0.6 },
  saveBtnText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
});
