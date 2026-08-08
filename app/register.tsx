import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import axios from 'axios';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DatePickerField from '@/components/DatePickerField';
import SocialAuthButtons from '@/components/SocialAuthButtons';
import { loginRequest } from '@/services/auth';
import { runBusy } from '@/services/busy';
import { BASE_URL } from '@/services/api';
import { fonts, lightColors as L, radius } from '@/constants/theme';

const BLOB = 300;

type FieldErrors = Record<string, string[]>;

// ─── Shared light-themed input (always cream/white palette) ───────────────────

function AuthInput({ label, error, style, onFocus, onBlur, ...rest }: {
  label?: string;
  error?: string;
} & TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={ai.wrapper}>
      {label ? <Text style={ai.label}>{label}</Text> : null}
      <TextInput
        {...rest}
        style={[ai.input, focused && ai.inputFocused, !!error && ai.inputError, style]}
        placeholderTextColor={L.t3}
        selectionColor={L.teal}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      />
      {error ? <Text style={ai.error}>{error}</Text> : null}
    </View>
  );
}

const ai = StyleSheet.create({
  wrapper: { gap: 4 },
  label: { fontFamily: fonts.body, fontSize: 13, fontWeight: '500', color: L.t2 },
  input: {
    backgroundColor: L.surface,
    borderWidth: 1,
    borderColor: L.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 0,
    height: 52,
    fontFamily: fonts.body,
    fontSize: 15,
    color: L.t1,
  },
  inputFocused: { borderColor: L.teal },
  inputError:   { borderColor: L.red },
  error: { fontFamily: fonts.body, fontSize: 12, color: L.red },
});

// ─── RegisterScreen ───────────────────────────────────────────────────────────

export default function RegisterScreen() {
  const { top } = useSafeAreaInsets();
  const [username,        setUsername]        = useState('');
  const [email,           setEmail]           = useState('');
  const [dob,             setDob]             = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors,          setErrors]          = useState<FieldErrors>({});
  const [submitting,      setSubmitting]      = useState(false);

  async function handleRegister() {
    setErrors({});
    if (password !== confirmPassword) {
      setErrors({ confirm_password: ['Passwords do not match'] });
      return;
    }
    if (!dob) {
      setErrors({ date_of_birth: ['Date of birth is required'] });
      return;
    }
    setSubmitting(true);
    await runBusy(async () => {
      await axios.post(`${BASE_URL}/api/users/register/`, {
        username,
        email,
        date_of_birth: dob,
        password,
        password2: confirmPassword,
      });
      await loginRequest(email, password);
      router.replace('/interests-setup');
    }, () => setSubmitting(false)).catch((err) => {
      if (axios.isAxiosError(err) && err.response?.data) {
        const data = err.response.data;
        if (typeof data === 'object' && !Array.isArray(data)) {
          setErrors(data as FieldErrors);
        } else {
          setErrors({ non_field_errors: ['Registration failed. Please try again.'] });
        }
      } else {
        setErrors({ non_field_errors: ['Registration failed. Please try again.'] });
      }
    });
  }

  const fe = (field: string) => errors[field]?.[0];
  const globalError = errors.non_field_errors?.[0] ?? errors.detail?.[0];

  return (
    <KeyboardAvoidingView
      style={rs.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Decorative blobs */}
      <View style={rs.blobTL} />
      <View style={rs.blobBR} />

      <ScrollView
        contentContainerStyle={[rs.container, { paddingTop: top + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: 'transparent' }}
      >
        <Text style={rs.title}>Create account</Text>

        {globalError ? (
          <View style={rs.globalError}>
            <Text style={rs.globalErrorText}>{globalError}</Text>
          </View>
        ) : null}

        {/* On the autofill props through this form, see app/login.tsx for the
            contract. The difference here is `newPassword`, which asks the OS to
            *generate and save* rather than to fill something it already has.
            Both password boxes carry it: iOS looks for a matching pair to
            recognise a confirmation field, and marking only the first makes the
            suggested password fill the top box and leave the bottom one empty. */}
        <View style={rs.form}>
          <AuthInput
            label="Username"
            placeholder="yourhandle"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username-new"
            textContentType="nickname"
            error={fe('username')}
          />
          <AuthInput
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            // The account identifier, so this is what the saved credential gets
            // filed under. `emailAddress` would save an address with no login
            // attached to it.
            textContentType="username"
            error={fe('email')}
          />
          <DatePickerField value={dob} onChange={setDob} error={fe('date_of_birth')} />
          <AuthInput
            label="Password"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            // Handed to iOS's strong-password generator so what it invents is
            // something the server will accept. Django's default validators
            // want 8+ characters and not all digits; this clears both.
            passwordRules="minlength: 12; required: lower; required: upper; required: digit;"
            error={fe('password')}
          />
          <AuthInput
            label="Confirm password"
            placeholder="••••••••"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            error={fe('confirm_password')}
          />
        </View>

        <Pressable
          onPress={handleRegister}
          disabled={submitting}
          style={({ pressed }) => [rs.btn, (pressed || submitting) && rs.btnDimmed]}
          accessibilityRole="button"
          accessibilityLabel="Create Account"
        >
          {submitting
            ? <ActivityIndicator color={L.bg} size="small" />
            : <Text style={rs.btnLabel}>Create Account</Text>
          }
        </Pressable>

        <View style={rs.social}>
          <SocialAuthButtons disabled={submitting} />
        </View>

        <View style={rs.signinRow}>
          <Text style={rs.signinText}>Already have an account? </Text>
          <Pressable onPress={() => router.replace('/login')} hitSlop={8}>
            <Text style={rs.signinLink}>Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const rs = StyleSheet.create({
  root: { flex: 1, backgroundColor: L.bg },

  blobTL: {
    position: 'absolute',
    top: -BLOB * 0.35,
    left: -BLOB * 0.28,
    width: BLOB,
    height: BLOB,
    borderRadius: BLOB / 2,
    backgroundColor: L.surface2,
  },
  blobBR: {
    position: 'absolute',
    bottom: -BLOB * 0.35,
    right: -BLOB * 0.28,
    width: BLOB,
    height: BLOB,
    borderRadius: BLOB / 2,
    backgroundColor: '#E8E4F5',
  },

  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 28,
    color: L.t1,
    marginBottom: 28,
  },
  globalError: {
    backgroundColor: `${L.red}18`,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: L.red,
    padding: 12,
    marginBottom: 20,
  },
  globalErrorText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: L.red,
    textAlign: 'center',
  },
  form: { gap: 16, marginBottom: 28 },

  btn: {
    backgroundColor: L.teal,
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  btnDimmed: { opacity: 0.65 },
  btnLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 17,
    color: L.bg,
  },

  social: { marginTop: 20 },

  signinRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 28,
  },
  signinText: { fontFamily: fonts.body, fontSize: 14, color: L.t2 },
  signinLink: { fontFamily: fonts.body, fontSize: 14, color: L.teal, fontWeight: '600' },
});
