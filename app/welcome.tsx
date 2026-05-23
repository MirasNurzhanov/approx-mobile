import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

import { ParticleBackground } from '@/components/ParticleBackground';

export default function WelcomeScreen() {
  return (
    <View style={styles.root}>
      <ParticleBackground />

      <View style={styles.content}>
        <Image source={require('../assets/images/icon.png')} style={styles.logo} />

        <View style={styles.buttons}>
          <TouchableOpacity style={styles.loginBtn} onPress={() => router.push('/login')} activeOpacity={0.85}>
            <Text style={styles.loginText}>Login</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.registerBtn} onPress={() => router.push('/register')} activeOpacity={0.85}>
            <Text style={styles.registerText}>Register</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  logo: {
    width: 220,
    height: 220,
    borderRadius: 48,
    marginBottom: 56,
  },

  buttons: { width: '100%', gap: 14 },
  loginBtn: {
    width: '100%',
    backgroundColor: '#00b4a6',
    paddingVertical: 17,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#00b4a6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  loginText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  registerBtn: {
    width: '100%',
    paddingVertical: 17,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00b4a6',
  },
  registerText: { color: '#00b4a6', fontSize: 16, fontWeight: '600', letterSpacing: 0.5 },
});
