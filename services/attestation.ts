import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { api } from './api';

// Device attestation for quest photo proofs.
//
// EXIF cannot distinguish a camera shot from a gallery pick. Attestation
// proves the *app* is genuine and unmodified on real hardware, and a genuine
// build has no gallery path in the quest flow — so a verified submission must
// have come from the camera.
//
// Everything here degrades safely: if the native module is absent, the device
// cannot attest, or anything throws, we report `unsupported`/nothing rather
// than blocking the user. The server decides whether that is acceptable
// (QUEST_ATTESTATION_MODE = off | audit | enforce).

const IOS_KEY_STORAGE = 'aura:attestation:iosKeyId';

export interface AttestationFields {
  attestation_platform?: string;
  attestation_nonce?: string;
  attestation_token?: string;
  attestation_key_id?: string;
  attestation_assertion?: string;
  attestation_unsupported?: string;
}

// The native module only exists in a dev/production build, never in Expo Go.
// Resolve it lazily so the JS bundle still runs without it.
type AppIntegrityModule = typeof import('@expo/app-integrity');
let moduleCache: AppIntegrityModule | null | undefined;

function getModule(): AppIntegrityModule | null {
  if (moduleCache !== undefined) return moduleCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    moduleCache = require('@expo/app-integrity') as AppIntegrityModule;
  } catch {
    moduleCache = null;
  }
  return moduleCache;
}

/** Google Cloud project number, required to prepare the Play Integrity
 * provider. Set `extra.googleCloudProjectNumber` in app.json. */
function cloudProjectNumber(): string | null {
  const value = (Constants.expoConfig?.extra as any)?.googleCloudProjectNumber;
  return value ? String(value) : null;
}

async function requestChallenge(): Promise<string | null> {
  try {
    const { data } = await api.post<{ nonce: string }>('/api/quests/attestation/challenge/');
    return data?.nonce ?? null;
  } catch {
    // 409 means the server has attestation switched off — nothing to do.
    return null;
  }
}

// ─── Android ──────────────────────────────────────────────────────────────────
let androidProviderReady = false;

async function attestAndroid(mod: AppIntegrityModule): Promise<AttestationFields> {
  const projectNumber = cloudProjectNumber();
  if (!projectNumber) {
    return { attestation_platform: 'android', attestation_unsupported: 'true' };
  }

  if (!androidProviderReady) {
    await mod.prepareIntegrityTokenProviderAsync(projectNumber);
    androidProviderReady = true;
  }

  const nonce = await requestChallenge();
  if (!nonce) return {};

  // The nonce is echoed back verbatim as requestDetails.requestHash, which is
  // how the server ties this verdict to this submission.
  const token = await mod.requestIntegrityCheckAsync(nonce);
  return {
    attestation_platform: 'android',
    attestation_nonce: nonce,
    attestation_token: token,
  };
}

// ─── iOS ──────────────────────────────────────────────────────────────────────

/** App Attest keys are created once per install and live in the Secure
 * Enclave; we only persist the identifier. */
async function iosKeyId(mod: AppIntegrityModule): Promise<string> {
  const stored = await AsyncStorage.getItem(IOS_KEY_STORAGE);
  if (stored) return stored;
  const keyId = await mod.generateKeyAsync();
  await AsyncStorage.setItem(IOS_KEY_STORAGE, keyId);
  return keyId;
}

/** Register the key with the server once. Apple only lets a key be attested
 * once, so a failure here clears it and a fresh key is made next time. */
async function ensureIosKeyRegistered(mod: AppIntegrityModule, keyId: string): Promise<boolean> {
  const nonce = await requestChallenge();
  if (!nonce) return false;
  try {
    const attestation = await mod.attestKeyAsync(keyId, nonce);
    await api.post('/api/quests/attestation/register/', {
      key_id: keyId,
      attestation,
      nonce,
    });
    return true;
  } catch {
    await AsyncStorage.removeItem(IOS_KEY_STORAGE);
    return false;
  }
}

async function attestIos(mod: AppIntegrityModule): Promise<AttestationFields> {
  if (!mod.isSupported) {
    return { attestation_platform: 'ios', attestation_unsupported: 'true' };
  }

  const keyId = await iosKeyId(mod);
  const nonce = await requestChallenge();
  if (!nonce) return {};

  try {
    const assertion = await mod.generateAssertionAsync(keyId, nonce);
    return {
      attestation_platform: 'ios',
      attestation_nonce: nonce,
      attestation_key_id: keyId,
      attestation_assertion: assertion,
    };
  } catch {
    // Most likely the key was never registered with the server. Register it
    // and let the next submission carry an assertion.
    await ensureIosKeyRegistered(mod, keyId);
    return {};
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/** Fields to attach to a quest proof upload. Never throws. */
export async function buildAttestation(): Promise<AttestationFields> {
  const mod = getModule();
  if (!mod) {
    return { attestation_platform: Platform.OS, attestation_unsupported: 'true' };
  }
  try {
    if (Platform.OS === 'android') return await attestAndroid(mod);
    if (Platform.OS === 'ios') return await attestIos(mod);
    return { attestation_platform: Platform.OS, attestation_unsupported: 'true' };
  } catch {
    return { attestation_platform: Platform.OS, attestation_unsupported: 'true' };
  }
}

/** Called after a successful iOS registration failure path, or manually on
 * login, to make sure the device has a registered App Attest key. */
export async function ensureRegistered(): Promise<void> {
  const mod = getModule();
  if (!mod || Platform.OS !== 'ios' || !mod.isSupported) return;
  try {
    const keyId = await iosKeyId(mod);
    await ensureIosKeyRegistered(mod, keyId);
  } catch {
    // Non-fatal: the next submission retries.
  }
}
