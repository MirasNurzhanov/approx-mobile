import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useSyncExternalStore } from 'react';
import * as WebBrowser from 'expo-web-browser';

import { api, BASE_URL } from './api';

// The agreement, on the client side.
//
// Three things live here and nowhere else: what the documents are called, where
// they are, and whether this account has agreed to the current one.
//
// The URLs are *fetched*, not compiled in. `GET /api/users/terms/` is public
// and answers with the version in force plus three links, so moving the
// documents is a backend deploy rather than an App Store release. There is a
// fallback below for the one case that matters — the sign-up screen with no
// network — because a gate that cannot render its own links is a gate nobody
// can get past.

export interface TermsDocuments {
  version: string;
  terms_url: string;
  guidelines_url: string;
  privacy_url: string;
}

/** Used only until the real answer arrives, and when the fetch fails outright.
 *
 *  Built from `BASE_URL` rather than hard-coded, because the documents are
 *  served by Approx's own backend at /legal/ — there is no separate marketing
 *  domain, and inventing one would mean shipping links that resolve to nothing.
 *  If a domain is put in front of the API later, the server's own
 *  `LEGAL_BASE_URL` answers with it and this is never reached.
 *
 *  The version is kept in step with `users/terms.py` by hand; a mismatch is
 *  harmless because acceptance is always recorded against the *server's*
 *  version, never this one. */
const FALLBACK: TermsDocuments = {
  version: '2026-08-25',
  terms_url: `${BASE_URL}/legal/terms/`,
  guidelines_url: `${BASE_URL}/legal/guidelines/`,
  privacy_url: `${BASE_URL}/legal/privacy/`,
};

/** Cached across launches so the gate renders instantly and offline. Not the
 *  source of truth for *acceptance* — that is the server's `needs_terms`. */
const CACHE_KEY = 'terms_documents';

interface TermsState {
  documents: TermsDocuments;
  /** Whether the signed-in account still owes us an agreement. `null` while
   *  unknown — the gate renders nothing rather than flashing in and out. */
  needsAcceptance: boolean | null;
}

let state: TermsState = { documents: FALLBACK, needsAcceptance: null };
const listeners = new Set<() => void>();

function setState(next: TermsState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTerms(): TermsState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Forget the previous account's answer. Called from sign-out — the next
 *  account on this device has its own agreement to make, and inheriting a
 *  `false` would walk it straight past the gate. */
export function resetTerms(): void {
  setState({ documents: state.documents, needsAcceptance: null });
}

/** Load the published documents. Safe to call before sign-in — the endpoint is
 *  public, and this uses bare axios rather than `api` for that reason: `api`
 *  attaches a session and can be latched shut after a sign-out. */
export async function refreshDocuments(): Promise<TermsDocuments> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) setState({ ...state, documents: JSON.parse(cached) });
  } catch {
    // A bad cache entry is not worth failing over; the fetch below replaces it.
  }
  try {
    const { data } = await axios.get<TermsDocuments>(`${BASE_URL}/api/users/terms/`);
    if (data?.version && data?.terms_url) {
      setState({ ...state, documents: data });
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)).catch(() => {});
      return data;
    }
  } catch {
    // Offline, or the endpoint is not deployed yet. The fallback above is
    // exactly what this case is for.
  }
  return state.documents;
}

/** Ask the server whether this account has agreed to the current text.
 *
 * The answer is the server's and only the server's: it compares the stored
 * version against the one in force, so an old build cannot get it wrong by
 * comparing strings itself. A failed fetch leaves `needsAcceptance` as it was
 * rather than guessing — guessing `true` would put a gate in front of somebody
 * who has already agreed, and guessing `false` would let a new account past. */
export async function refreshAcceptance(): Promise<boolean | null> {
  try {
    const { data } = await api.get<{ needs_terms?: boolean }>('/api/users/me/');
    const needs = !!data?.needs_terms;
    setState({ ...state, needsAcceptance: needs });
    return needs;
  } catch {
    return state.needsAcceptance;
  }
}

/** Record agreement for the signed-in account. Throws if the server refuses,
 *  so the caller can keep the gate up rather than dismissing it on a failure. */
export async function acceptTerms(): Promise<void> {
  await api.post('/api/users/terms/accept/', { accept: true });
  setState({ ...state, needsAcceptance: false });
}

/** What a new registration or social sign-up sends alongside its credentials.
 *  The server records the version; the client only says "yes". */
export const ACCEPT_TERMS_PAYLOAD = { accept_terms: true } as const;

/** Open one of the documents in the in-app browser.
 *
 * `openBrowserAsync`, not `Linking.openURL`: App Review expects the terms to be
 * readable without leaving the app, and a hand-off to Safari from a modal
 * sign-up gate loses the user's place in it. */
export async function openDocument(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    // Nothing useful to say — the link is also printed in Settings → Legal.
  }
}
