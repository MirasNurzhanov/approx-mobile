import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '@/context/AuthContext';
import { ParticleBackground } from '@/components/ParticleBackground';

export default function LoginScreen() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/(tabs)/map');
    }
  }, [isAuthenticated, isLoading]);

  async function handleLogin() {
    if (!email || !password) return;
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      Alert.alert('Login failed', 'Invalid email or password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <ParticleBackground />
      <Text style={styles.logo}>AURA</Text>
      <Text style={styles.tagline}>Find your people nearby</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#555"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#555"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TouchableOpacity
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={submitting}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>{submitting ? 'Signing in…' : 'Sign in'}</Text>
      </TouchableOpacity>

      <View style={styles.registerRow}>
        <Text style={styles.registerPrompt}>Don't have an account?{'  '}</Text>
        <TouchableOpacity onPress={() => router.push('/register')}>
          <Text style={styles.registerLink}>Register</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  logo: {
    fontSize: 52,
    color: '#00b4a6',
    fontWeight: '800',
    letterSpacing: 10,
    marginBottom: 8,
  },
  tagline: {
    color: '#555',
    fontSize: 14,
    marginBottom: 48,
    letterSpacing: 1,
  },
  input: {
    width: '100%',
    backgroundColor: '#111',
    color: '#fff',
    padding: 16,
    borderRadius: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    fontSize: 15,
  },
  button: {
    width: '100%',
    backgroundColor: '#00b4a6',
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16, letterSpacing: 0.5 },
  registerRow: { flexDirection: 'row', marginTop: 28, alignItems: 'center' },
  registerPrompt: { color: '#555', fontSize: 14 },
  registerLink: { color: '#00b4a6', fontSize: 14, fontWeight: '600' },
});
