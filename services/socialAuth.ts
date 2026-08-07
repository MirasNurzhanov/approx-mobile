/**
 * Sign in with Google and Sign in with Apple.
 *
 * The shape of both flows is the same: the provider's SDK authenticates the
 * person on the device and hands back an **identity token** — a JWT the
 * provider signed. That token goes to `/api/users/social/`, which re-verifies
 * the signature against Google's or Apple's published keys and answers with
 * ordinary Aura tokens. Nothing here decides who anybody is; the phone only
 * carries the provider's word to a server that can check it.
 *
 * Neither library works in Expo Go — both are native code — so both are gated
 * behind `isAvailable` checks rather than assumed. The buttons hide instead of
 * throwing, because a dead button is a support ticket and a missing one is not.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type * as GoogleSigninModule from '@react-native-google-signin/google-signin';

import { BASE_URL, resumeSession } from './api';

export type SocialProvider = 'google' | 'apple';

export interface SocialSignInResult {
  /** True when this sign-in created the account rather than found it. */
  created: boolean;
  /** The account still owes us a date of birth — see app/social-birthday.tsx. */
  needsDateOfBirth: boolean;
}

/** The user backed out of the provider's sheet. Not an error to report. */
export class SocialSignInCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
    this.name = 'SocialSignInCancelled';
  }
}

/** Anything the user should be told about, already phrased for them. */
export class SocialSignInError extends Error {
  code: string;
  constructor(message: string, code = 'unknown') {
    super(message);
    this.name = 'SocialSignInError';
    this.code = code;
  }
}

// ── Configuration ────────────────────────────────────────────────────────────

interface GoogleAuthConfig {
  webClientId?: string;
  iosClientId?: string;
}

const googleConfig: GoogleAuthConfig =
  (Constants.expoConfig?.extra?.googleAuth as GoogleAuthConfig | undefined) ?? {};

const isExpoGo = Constants.appOwnership === 'expo';

/**
 * Google needs the **web** client id even on a phone: it is what makes Google
 * mint an `idToken` at all, and without one `signIn()` succeeds and returns
 * `idToken: null`, which looks like a server bug and is not. So a blank id
 * means the button does not exist rather than fails on tap.
 */
export const isGoogleAvailable = !!googleConfig.webClientId;

/**
 * The Google SDK, loaded on first use rather than at import.
 *
 * It has to be lazy. `TurboModuleRegistry.getEnforcing` runs at that module's
 * top level, and its `statusCodes` are read off the native module in the same
 * breath — so merely *importing* it throws when the native side is not in the
 * binary. This module is reached from services/signOut, which the AuthProvider
 * imports, which is the root layout: a static import would turn "running a dev
 * build made before this feature" from a missing button into an app that dies
 * on launch with no screen to explain itself.
 */
let google: typeof GoogleSigninModule | null = null;

function loadGoogle() {
  if (isExpoGo) return null;
  if (google) return google;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  google = require('@react-native-google-signin/google-signin') as typeof GoogleSigninModule;
  return google;
}

let googleConfigured = false;

function configureGoogle() {
  const mod = loadGoogle();
  if (!mod) return;
  const { GoogleSignin } = mod;
  if (googleConfigured) return;
  GoogleSignin.configure({
    webClientId: googleConfig.webClientId,
    // Optional: only used when iOS is not reading a GoogleService-Info.plist.
    ...(googleConfig.iosClientId ? { iosClientId: googleConfig.iosClientId } : {}),
    scopes: ['profile', 'email'],
    // We never call a Google API as the user — the identity token is the whole
    // point — so there is nothing for a refresh token to be used for, and
    // asking for one is a consent screen nobody needs to read.
    offlineAccess: false,
  });
  googleConfigured = true;
}

/** Apple is iOS-only in this app.
 *
 * Sign in with Apple on Android is a web redirect flow needing a Services ID
 * and a hosted callback, which is a different piece of infrastructure rather
 * than a flag. Apple only *requires* the button where other third-party
 * sign-ins are offered on Apple platforms, so iOS is also the only place it is
 * obligatory. `isAvailableAsync` is still consulted because the device may be
 * on an iOS too old for it.
 */
export async function isAppleAvailable() {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

// ── The exchange ─────────────────────────────────────────────────────────────

/**
 * Trade a provider identity token for an Aura session, and store it.
 *
 * Mirrors services/auth.ts loginRequest, including the `resumeSession()` — a
 * previous sign-out latches the api client shut, and a social sign-in has to
 * un-latch it for exactly the same reason a password one does.
 */
async function exchange(
  provider: SocialProvider,
  idToken: string,
  fullName: string,
): Promise<SocialSignInResult> {
  let data;
  try {
    ({ data } = await axios.post(`${BASE_URL}/api/users/social/`, {
      provider,
      id_token: idToken,
      full_name: fullName,
    }));
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data) {
      const body = err.response.data as { detail?: string; code?: string };
      throw new SocialSignInError(
        body.detail || 'That sign-in could not be completed.',
        body.code || 'server_rejected',
      );
    }
    throw new SocialSignInError(
      'Could not reach Aura. Check your connection and try again.',
      'network',
    );
  }

  // TEMP DIAGNOSTIC — remove once the skip-onboarding bug is found.
  console.log('[SocialAuth] /api/users/social/ raw response:', JSON.stringify(data));

  await AsyncStorage.setItem('access_token', data.tokens.access);
  await AsyncStorage.setItem('refresh_token', data.tokens.refresh);
  resumeSession();

  const result = {
    created: !!data.created,
    needsDateOfBirth: !!data.needs_date_of_birth,
  };
  console.log('[SocialAuth] exchange() returning:', result);
  return result;
}

// ── Google ───────────────────────────────────────────────────────────────────

export async function signInWithGoogle(): Promise<SocialSignInResult> {
  if (!isGoogleAvailable) {
    throw new SocialSignInError(
      'Google sign-in is not set up in this build.',
      'not_configured',
    );
  }
  let GoogleSignin;
  let isErrorWithCode;
  let isSuccessResponse;
  let statusCodes;
  try {
    const mod = loadGoogle();
    if (!mod) throw new Error('not_linked');
    ({ GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = mod);
    configureGoogle();
  } catch {
    // The native side is not in this binary — an older dev build, Expo Go,
    // or a prebuild that has not been re-run since the library was added.
    throw new SocialSignInError(
      'This build does not include Google sign-in. Please update the app.',
      'not_linked',
    );
  }

  let response;
  try {
    // Android only; resolves immediately on iOS. Without it the failure on a
    // phone with no Play Services is an opaque native rejection.
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    response = await GoogleSignin.signIn();
  } catch (err) {
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) throw new SocialSignInCancelled();
      if (err.code === statusCodes.IN_PROGRESS) throw new SocialSignInCancelled();
      if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new SocialSignInError(
          'Google Play services are not available on this device.',
          'no_play_services',
        );
      }
    }
    throw new SocialSignInError('Google sign-in failed. Please try again.', 'google_failed');
  }

  // v13+ reports cancellation as a value, not a throw — the `catch` above is
  // for older Android paths that still reject. Both have to be handled.
  if (!isSuccessResponse(response)) throw new SocialSignInCancelled();

  const { idToken, user } = response.data;
  if (!idToken) {
    // Almost always a missing or wrong `webClientId`: Google signs the person
    // in happily and simply declines to issue an identity token.
    throw new SocialSignInError(
      'Google did not return a sign-in token. Check the app configuration.',
      'no_id_token',
    );
  }

  return exchange('google', idToken, user.name ?? '');
}

// ── Apple ────────────────────────────────────────────────────────────────────

export async function signInWithApple(): Promise<SocialSignInResult> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (err) {
    if ((err as { code?: string })?.code === 'ERR_REQUEST_CANCELED') {
      throw new SocialSignInCancelled();
    }
    throw new SocialSignInError('Apple sign-in failed. Please try again.', 'apple_failed');
  }

  if (!credential.identityToken) {
    throw new SocialSignInError(
      'Apple did not return a sign-in token. Please try again.',
      'no_id_token',
    );
  }

  // Apple sends the name **only on the very first authorization**, and never
  // again — not even after deleting and reinstalling, unless the person
  // revokes the app in Settings. It is passed straight through because the
  // server has no second chance to ask, and it is used for nothing more
  // load-bearing than seeding a username.
  const { givenName, familyName } = credential.fullName ?? {};
  const fullName = [givenName, familyName].filter(Boolean).join(' ');

  return exchange('apple', credential.identityToken, fullName);
}

/**
 * Drop the Google SDK's cached account.
 *
 * Called from sign-out. Without it, "Sign out" leaves Google still holding the
 * last account and the next tap on the Google button signs straight back in
 * with no chooser — which reads as the sign-out not having worked, and makes
 * it impossible to switch accounts on a shared phone.
 *
 * Never throws: signing out has to finish whatever Google says. There is no
 * Apple equivalent — Apple keeps no session for the app to clear.
 */
export async function clearGoogleSession() {
  if (!isGoogleAvailable) return;
  try {
    const mod = loadGoogle();
    if (!mod) return;
    configureGoogle();
    await mod.GoogleSignin.signOut();
  } catch {
    // Nothing to do about it, and nothing that depends on it.
  }
}
