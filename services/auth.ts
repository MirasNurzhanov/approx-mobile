import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { BASE_URL } from './api';

export async function loginRequest(email: string, password: string) {
  const { data } = await axios.post(`${BASE_URL}/api/users/login/`, { email, password });
  await AsyncStorage.setItem('access_token', data.access);
  await AsyncStorage.setItem('refresh_token', data.refresh);
  return data;
}

export async function logoutRequest() {
  await AsyncStorage.removeItem('access_token');
  await AsyncStorage.removeItem('refresh_token');
}

export async function getAccessToken() {
  return AsyncStorage.getItem('access_token');
}
