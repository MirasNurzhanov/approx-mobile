import axios from 'axios';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const API_URL = 'https://project-x-production-3261.up.railway.app';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    console.log('Login pressed!', email, password);
    setLoading(true);
    try {
      const response = await axios.post(`${API_URL}/api/users/login/`, { email, password });
      const { access, refresh } = response.data;
      // Store tokens (we'll add AsyncStorage next)
      console.log('Login success!', access);
      router.replace('/map');
    } catch (error) {
      Alert.alert('Error', 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>AURA</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#888"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#888"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Logging in...' : 'Login'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 48, color: '#00b4a6', fontWeight: 'bold', marginBottom: 40, letterSpacing: 8 },
  input: { width: '100%', backgroundColor: '#1a1a1a', color: '#fff', padding: 16, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: '#00b4a6' },
  button: { width: '100%', backgroundColor: '#00b4a6', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});