import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { runBusy } from '@/services/busy';
import { fonts, lightColors as L } from '@/constants/theme';
import { TermsAgreement } from '@/components/TermsAgreement';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [focused, setFocused]   = useState<'email' | 'password' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  // No isAuthenticated-watching redirect here — login() already navigates
  // explicitly on success. A second, unconditional "authenticated → map"
  // effect here raced that: it fired a beat after the explicit redirect
  // (effects run post-commit) and silently overwrote it, which is why a
  // fresh sign-up appeared to skip both the age gate and interest selection
  // entirely. Social sign-in (Google/Apple) lives on /register only.
  async function handleLogin() {
    if (!email || !password) return;
    // Belt and braces with the disabled button below: `onSubmitEditing` on the
    // password field also reaches here, and a keyboard "go" must not be a way
    // round the agreement.
    if (!acceptedTerms) return;
    setSubmitting(true);
    await runBusy(
      () => login(email, password, acceptedTerms),
      () => setSubmitting(false),
    ).catch((e: any) => {
      // The server has its own copy of this rule and will refuse a login for
      // an account that has not agreed. Reaching it means the client-side gate
      // was bypassed somehow, so say what is actually wrong rather than
      // claiming the password was bad.
      if (e?.response?.data?.code === 'terms_required') {
        Alert.alert('Agreement required', e.response.data.detail);
        return;
      }
      Alert.alert('Login failed', 'Invalid email or password');
    });
  }

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Decorative blobs */}
      <View style={s.blobTL} />
      <View style={s.blobBR} />

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Scrolls rather than centring in a fixed box: on a small phone with
            the keyboard up the column can still run off screen, and content
            that cannot be reached is worse than content that is not perfectly
            centred. `flexGrow` keeps it centred on every screen that does have
            the room. */}
        <ScrollView
          contentContainerStyle={s.inner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={s.header}>
            <Text style={s.wordmark}>APPROX</Text>
            <Text style={s.tagline}>Find your people nearby</Text>
          </View>

          {/* Form
              The autofill props below are what make the phone's own password
              manager offer to fill and to save — iCloud Keychain on iOS, the
              Android autofill service (Google Password Manager, 1Password,
              Bitwarden, whichever is set) on Android. It takes both attributes,
              not either: `autoComplete` is the cross-platform hint Android
              reads, `textContentType` is the iOS one, and a field with only one
              of them is filled on one operating system and ignored on the other.

              `username`/`password` — not `newPassword` — is the pairing that
              makes iOS *offer to save* after a successful sign-in, so the
              password box has to be a sibling of a field iOS considers the
              account name. That is why the email field is marked `username`
              rather than `emailAddress`. */}
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
              autoComplete="email"
              textContentType="username"
              importantForAutofill="yes"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              submitBehavior="submit"
            />
            <TextInput
              ref={passwordRef}
              style={[s.input, focused === 'password' && s.inputFocused]}
              placeholder="Password"
              placeholderTextColor={L.t3}
              selectionColor={L.teal}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFocused('password')}
              onBlur={() => setFocused(null)}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              importantForAutofill="yes"
              returnKeyType="go"
              // Submitting from the keyboard rather than only from the button is
              // half of why the save prompt appears: both platforms treat "the
              // password field was submitted" as the signal that a login just
              // happened and is worth offering to remember.
              onSubmitEditing={handleLogin}
            />

            {/* A checkbox, not links, and above the button rather than below
                it — the agreement has to be read before the thing it gates.

                This screen was links-only until App Review's wording was read
                closely: "The EULA or terms of use agreement presented to users
                before registering **or logging in**." An existing account that
                authenticated first and met `TermsGate` a moment later is
                exactly the order they objected to. The agreement now happens
                before the request leaves the phone, and the server refuses to
                mint tokens without it either — see
                `users.views.SuspensionAwareTokenObtainPairSerializer.get_token`,
                which gates in front of the mint rather than after it.

                `TermsGate` stays, but only as the safety net for sessions that
                were already open when this build installed and so never pass
                through this screen. */}
            <View style={s.terms}>
              <TermsAgreement
                accepted={acceptedTerms}
                onToggle={setAcceptedTerms}
                disabled={submitting}
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                s.btn,
                (pressed || submitting || !acceptedTerms) && s.btnDimmed,
              ]}
              onPress={handleLogin}
              disabled={submitting || !acceptedTerms}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ disabled: submitting || !acceptedTerms }}
              accessibilityHint={
                acceptedTerms ? undefined : 'Agree to the Terms of Use first'
              }
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

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const BLOB = 300;

const s = StyleSheet.create({
  terms: { marginTop: 20, paddingHorizontal: 4 },

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

  flex: { flex: 1 },

  inner: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingVertical: 32,
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
