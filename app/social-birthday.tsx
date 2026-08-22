/**
 * The one thing Google and Apple cannot tell us.
 *
 * Neither provider hands over a date of birth, and Aura is 13+ — so an account
 * created by tapping a provider button arrives without the one fact the age
 * gate is made of. This screen is where it is asked for, and it is the only
 * step between a social sign-up and the rest of onboarding.
 *
 * Deliberately not skippable, unlike the nationality and profession screens
 * either side of it. Those are colour; this is the gate, and a Skip button on
 * it would make the whole gate optional for anyone who signed in with Google.
 * The way out is to sign out, which the header offers.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import axios from 'axios';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DatePickerField from '@/components/DatePickerField';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import { runBusy } from '@/services/busy';
import { fonts, lightColors as L, radius } from '@/constants/theme';

const BLOB = 300;

export default function SocialBirthdayScreen() {
  const { top } = useSafeAreaInsets();
  const { confirmLogout } = useAuth();
  const [dob, setDob] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleContinue() {
    if (!dob) {
      setError('Please choose your date of birth');
      return;
    }
    setError(null);
    setSaving(true);
    await runBusy(
      () => api.patch('/api/users/profile/', { date_of_birth: dob }),
      () => setSaving(false),
    )
      .then(() => router.replace('/interests-setup'))
      .catch((err) => {
        // The under-13 rejection comes back here, phrased by the server, and it
        // is the message that matters most on this screen — a generic "could
        // not save" would leave someone tapping Continue forever.
        const detail = axios.isAxiosError(err)
          ? err.response?.data?.date_of_birth?.[0]
          : null;
        setError(detail ?? 'Could not save that. Please try again.');
      });
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.blobTL} />
      <View style={s.blobBR} />

      <ScrollView
        contentContainerStyle={[s.content, { paddingTop: top + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <Text style={s.title}>One last thing</Text>
          <Text style={s.subtitle}>
            Aura is for 13 and over, and your provider does not share your
            birthday — so we have to ask. Only your age group is ever shown to
            anyone else.
          </Text>
        </View>

        <DatePickerField value={dob} onChange={setDob} error={error} />

        <Pressable
          onPress={handleContinue}
          disabled={saving}
          style={({ pressed }) => [s.btn, (pressed || saving) && s.btnDimmed]}
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          {saving
            ? <ActivityIndicator color={L.bg} size="small" />
            : <Text style={s.btnLabel}>Continue</Text>
          }
        </Pressable>

        <Pressable onPress={confirmLogout} hitSlop={8} style={s.outRow}>
          <Text style={s.outText}>Not you? Sign out</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
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

  content: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32, gap: 24 },
  header: { gap: 10 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 28,
    color: L.t1,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: L.t2,
  },

  btn: {
    backgroundColor: L.teal,
    borderRadius: radius.m,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDimmed: { opacity: 0.65 },
  btnLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 17,
    color: L.bg,
  },

  outRow: { alignSelf: 'center' },
  outText: { fontFamily: fonts.body, fontSize: 14, color: L.t2 },
});
