import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { setOnAuthFailure } from '@/services/api';
import { getAccessToken, loginRequest } from '@/services/auth';

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // When the api layer gives up on a session (refresh failed), it redirects
    // to '/' — this keeps isAuthenticated in sync so index doesn't bounce the
    // user straight back into the tabs.
    setOnAuthFailure(() => setIsAuthenticated(false));

    Promise.all([
      getAccessToken(),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]).then(([token]) => {
      setIsAuthenticated(!!token);
      setIsLoading(false);
    });
  }, []);

  async function login(email: string, password: string) {
    await loginRequest(email, password);
    setIsAuthenticated(true);
    router.replace('/(tabs)/map');
  }

  async function logout() {
    await AsyncStorage.multiRemove(['access_token', 'refresh_token']);
    setIsAuthenticated(false);
    setIsLoading(false);
    console.log('[Auth] router.replace called, current route should change');
    console.log('[Auth] router state:', router);
    router.dismissAll();
    router.replace('/');
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
