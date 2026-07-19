import AsyncStorage from '@react-native-async-storage/async-storage';

// Device-local user preferences (not synced to the backend).

const PREFIX = 'aura:pref:';

export type PrefKey = 'zoneAutoplay' | 'backgroundLocation';

const DEFAULTS: Record<PrefKey, boolean> = {
  zoneAutoplay: true,
  backgroundLocation: true,
};

export async function getPref(key: PrefKey): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw === null ? DEFAULTS[key] : raw === '1';
  } catch {
    return DEFAULTS[key];
  }
}

export async function setPref(key: PrefKey, value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, value ? '1' : '0');
  } catch {}
}
