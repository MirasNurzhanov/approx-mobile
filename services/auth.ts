import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { BASE_URL, resumeSession } from './api';

export async function loginRequest(email: string, password: string) {
  const { data } = await axios.post(`${BASE_URL}/api/users/login/`, { email, password });
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
