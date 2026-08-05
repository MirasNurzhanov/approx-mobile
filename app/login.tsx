import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '@/context/AuthContext';
import { lightColors as L } from '@/constants/theme';
import { fonts } from '@/constants/theme';

export default function LoginScreen() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [focused, setFocused]   = useState<'email' | 'password' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace('/(tabs)/map');
  }, [isAuthenticated, isLoading]);

  async function handleLogin() {
    if (!email || !password) return;
    setSubmitting(true);
    // The reset is mirrored on both paths rather than pulled into a `finally`:
    // React Compiler cannot lower a `finally` and gives up on any component
    // containing one, which costs this screen its automatic memoization.
    try {
      await login(email, password);
      setSubmitting(false);
    } catch {
      Alert.alert('Login failed', 'Invalid email or password');
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      {/* Decorative blobs */}
      <View style={s.blobTL} />
      <View style={s.blobBR} />

      <KeyboardAvoidingView
        style={s.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={s.header}>
          <Text style={s.wordmark}>AURA</Text>
          <Text style={s.tagline}>Find your people nearby</Text>
        </View>

        {/* Form */}
        <View style={s.form}>
          <TextInput
            style={[s.input, focused === 'email' && s.inputFocused]}
            placeholder="Email"
            placeholderTextColor={L.t3}
            selectionColor={L.teal}
            value={email}
            onChangeText={setEmail}
            onFocus={() => setFocused('email')}
            onBlur={() => setFocused(null)}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[s.input, focused === 'password' && s.inputFocused]}
            placeholder="Password"
            placeholderTextColor={L.t3}
            selectionColor={L.teal}
            value={password}
            onChangeText={setPassword}
            onFocus={() => setFocused('password')}
            onBlur={() => setFocused(null)}
            secureTextEntry
          />

          <Pressable
            style={({ pressed }) => [s.btn, (pressed || submitting) && s.btnDimmed]}
            onPress={handleLogin}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
          >
            {submitting
              ? <ActivityIndicator color={L.bg} size="small" />
              : <Text style={s.btnLabel}>Sign in</Text>
            }
          </Pressable>
        </View>

        {/* Footer link */}
        <View style={s.footer}>
          <Text style={s.footerText}>Don't have an account? </Text>
          <Pressable onPress={() => router.push('/register')} hitSlop={8}>
            <Text style={s.footerLink}>Register</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const BLOB = 300;

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: L.bg,
  },

  // Decorative blobs — sit behind everything via render order
  blobTL: {
    position: 'absolute',
    top: -BLOB * 0.35,
    left: -BLOB * 0.28,
    width: BLOB,
    height: BLOB,
    borderRadius: BLOB / 2,
    backgroundColor: L.surface2,   // #FCEEE8 — coral tint
  },
  blobBR: {
    position: 'absolute',
    bottom: -BLOB * 0.35,
    right: -BLOB * 0.28,
    width: BLOB,
    height: BLOB,
    borderRadius: BLOB / 2,
    backgroundColor: '#E8E4F5',    // violet tint — not in palette
  },

  inner: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    gap: 32,
  },

  header: {
    alignItems: 'center',
    gap: 8,
  },
  wordmark: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 36,
    letterSpacing: 8,
    color: L.teal,
  },
  tagline: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: L.t2,
  },

  form: { gap: 14 },

  input: {
    backgroundColor: L.surface,
    borderWidth: 1,
    borderColor: L.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 0,
    height: 52,
    fontFamily: fonts.body,
    fontSize: 15,
    color: L.t1,
  },
  inputFocused: { borderColor: L.teal },

  btn: {
    backgroundColor: L.teal,
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnDimmed: { opacity: 0.65 },
  btnLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 17,
    color: L.bg,
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: { fontFamily: fonts.body, fontSize: 14, color: L.t2 },
  footerLink: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: L.teal },
});
