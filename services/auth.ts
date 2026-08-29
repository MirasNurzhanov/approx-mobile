import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { BASE_URL, clientHeaders, resumeSession } from './api';

/**
 * Sign in, carrying the agreement.
 *
 * `acceptTerms` is what the checkbox on the sign-in screen sets. The server
 * refuses to issue tokens at all for an account that has not agreed to the
 * current Terms and did not send this — see
 * `users.views.SuspensionAwareTokenObtainPairSerializer.get_token`, which
 * gates *before* the pair is minted rather than after.
 *
 * It defaults to false so the two callers that are not the sign-in screen
 * (there are none today, but `loginRequest` is exported) cannot accidentally
 * assert an agreement nobody made.
 */
export async function loginRequest(
  email: string,
  password: string,
  acceptTerms = false,
) {
  const { data } = await axios.post(
    `${BASE_URL}/api/users/login/`,
    { email, password, accept_terms: acceptTerms },
    // Bare axios, so the `api` interceptor's headers do not apply — this runs
    // before a session exists. `clientHeaders()` is the same definition the
    // interceptor uses, so the build number cannot drift between the two.
    //
    // This header is what scopes the server's Terms gate to builds that can
    // satisfy it: without it the server treats the caller as a legacy client
    // and lets it through. It is therefore load-bearing here in a way it is
    // not anywhere else.
    { headers: clientHeaders() },
  );
  await AsyncStorage.setItem('access_token', data.access);
  await AsyncStorage.setItem('refresh_token', data.refresh);
  // The previous sign-out (or a dead refresh) latched the api client shut.
  // Tokens exist again, so let it talk — otherwise every screen after login
  // fails on a client that is still refusing to send.
  resumeSession();
  return data;
}

export async function logoutRequest() {
  await AsyncStorage.removeItem('access_token');
  await AsyncStorage.removeItem('refresh_token');
}

export async function getAccessToken() {
  return AsyncStorage.getItem('access_token');
}
