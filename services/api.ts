import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { router } from 'expo-router';

export const BASE_URL = 'https://project-x-production-3261.up.railway.app';

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type QueueEntry = { resolve: (token: string) => void; reject: (err: unknown) => void };

let isRefreshing = false;
let failedQueue: QueueEntry[] = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      });
    }

    original._retry = true;
    isRefreshing = true;

    const refresh = await AsyncStorage.getItem('refresh_token');

    if (!refresh) {
      isRefreshing = false;
      await AsyncStorage.multiRemove(['access_token', 'refresh_token']);
      router.replace('/');
      return Promise.reject(error);
    }

    try {
      const { data } = await axios.post(`${BASE_URL}/api/users/token/refresh/`, { refresh });
      await AsyncStorage.setItem('access_token', data.access);
      api.defaults.headers.common.Authorization = `Bearer ${data.access}`;
      original.headers.Authorization = `Bearer ${data.access}`;
      processQueue(null, data.access);
      return api(original);
    } catch (refreshError) {
      processQueue(refreshError, null);
      await AsyncStorage.multiRemove(['access_token', 'refresh_token']);
      router.replace('/');
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);
