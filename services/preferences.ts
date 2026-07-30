import AsyncStorage from '@react-native-async-storage/async-storage';

// Device-local user preferences (not synced to the backend).

const PREFIX = 'aura:pref:';

// `zoneAutoplay` used to live here. Zone audio never starts on its own now —
// it is played from the button on a friend's card — so the preference had
// nothing to govern. Values already written under the old key stay on disk,
// unread, until the app is reinstalled.
export type PrefKey = 'backgroundLocation';

const DEFAULTS: Record<PrefKey, boolean> = {
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
