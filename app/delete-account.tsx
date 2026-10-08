import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import { requestAccountDeletion, type DeletionOptions, type DeletionProof } from '@/services/accountDeletion';
import { SocialSignInCancelled, SocialSignInError } from '@/services/socialAuth';

export default function DeleteAccountScreen() {
  const { colors } = useTheme();
  const { top, bottom } = useSafeAreaInsets();
  const { logout } = useAuth();
  const [options, setOptions] = useState<DeletionOptions | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    api.get<DeletionOptions>('/api/users/delete/').then(response => {
      if (active) setOptions(response.data);
    }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, []);

  async function submit(proof: DeletionProof) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const deadline = await requestAccountDeletion(proof);
      setPassword('');
      Alert.alert('Deletion requested',
        `Your account is now disabled. Final deletion is scheduled after ${new Date(deadline).toLocaleDateString()}. Shared messages and safety records are retained.`);
    } catch (error) {
      if (!(error instanceof SocialSignInCancelled)) {
        Alert.alert('Deletion not confirmed', error instanceof SocialSignInError
          ? error.message
          : 'Check your credentials and connection, then try again. Contact support if you can no longer sign in.');
      }
      pending.current = false;
      setBusy(false);
      return;
    }
    // Only an explicit acceptance ends the session. A rejected request or a
    // cancelled provider sheet leaves the account screen available for retry.
    await logout();
  }

  function confirm(proof: DeletionProof) {
    if (pending.current) return;
    Alert.alert('Request account deletion?', 'This disables your account immediately.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Request deletion', style: 'destructive', onPress: () => { void submit(proof); } },
    ]);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { paddingTop: top + 24, paddingBottom: bottom + 24 }]}>
      <Button label="Back" variant="ghost" onPress={() => router.back()} disabled={busy} />
      <Text style={[styles.title, { color: colors.t1 }]}>Delete account</Text>
      {loadError ? <Text style={{ color: colors.red }}>Could not load deletion options. Go back and try again.</Text>
        : !options ? <ActivityIndicator color={colors.teal} /> : (
          <View style={styles.content}>
            <Text style={{ color: colors.t1 }}>
              Confirm your identity to request deletion. Your account will be disabled immediately,
              followed by final deletion after a {options.grace_days}-day grace period.
              Shared messages and moderation evidence are retained under a deleted-account identity.
            </Text>
            {options.has_password && <>
              <TextInput accessibilityLabel="Current password" placeholder="Current password"
                placeholderTextColor={colors.t3} secureTextEntry autoCapitalize="none"
                autoCorrect={false} textContentType="password" value={password} onChangeText={setPassword}
                editable={!busy} style={[styles.input, { color: colors.t1, borderColor: colors.border }]} />
              <Button label="Confirm password and delete" variant="danger" disabled={!password || busy}
                onPress={() => confirm({ password })} />
            </>}
            {options.providers.map(provider => (
              <Button key={provider} label={`Confirm with ${provider === 'google' ? 'Google' : 'Apple'} and delete`}
                variant="danger" disabled={busy} onPress={() => confirm({ provider })} />
            ))}
            {busy && <ActivityIndicator accessibilityLabel="Requesting deletion" color={colors.teal} />}
          </View>
        )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 20 },
  title: { fontSize: 26, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
});
