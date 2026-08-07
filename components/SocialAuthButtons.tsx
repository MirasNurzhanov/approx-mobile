/**
 * "Continue with Google / Apple", for both the login and the register screen.
 *
 * One component for both because the flows are identical: from here there is
 * no such thing as signing *up* with Google — you tap the button and the
 * server works out whether that identity already has an account. A separate
 * "sign up with Google" would be the same request under a different label, and
 * the label would be wrong half the time.
 *
 * Buttons that cannot work are not rendered. Google's needs a web client id
 * compiled into the build; Apple's exists only on iOS. Both check before
 * drawing rather than failing on tap.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
// A plain import on both platforms. expo-apple-authentication is a no-op
// module off iOS rather than a missing one, and the obvious-looking "fix" of a
// conditional require breaks the New Architecture build.
import * as AppleAuthentication from 'expo-apple-authentication';
import Svg, { Path } from 'react-native-svg';

import { useAuth } from '@/context/AuthContext';
import { runBusy } from '@/services/busy';
import {
  isAppleAvailable,
  isGoogleAvailable,
  signInWithApple,
  signInWithGoogle,
  SocialSignInCancelled,
  SocialSignInError,
} from '@/services/socialAuth';
import { fonts, lightColors as L } from '@/constants/theme';

const BTN_HEIGHT = 52;
const BTN_RADIUS = 14;

// ── Brand glyphs ─────────────────────────────────────────────────────────────
// Drawn rather than imported: lucide has no brand marks, and both Google and
// Apple require their own logo, in their own colours, un-recoloured. These are
// the official paths, so nothing here is a lookalike.

function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7A21.99 21.99 0 0 0 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

// ── The buttons ──────────────────────────────────────────────────────────────

export default function SocialAuthButtons({ disabled = false }: { disabled?: boolean }) {
  const { completeSocialSignIn } = useAuth();
  const [pending, setPending] = useState<'google' | 'apple' | null>(null);
  // Async, and iOS-only, so it starts false and the button appears once the
  // answer is in. Anything else flashes a button on Android for one frame.
  const [appleReady, setAppleReady] = useState(false);

  useEffect(() => {
    let alive = true;
    isAppleAvailable().then((ok) => { if (alive) setAppleReady(ok); });
    return () => { alive = false; };
  }, []);

  async function run(provider: 'google' | 'apple') {
    // TEMP DIAGNOSTIC — remove once the skip-onboarding bug is found.
    console.log('[SocialAuth] run() called for', provider, '| pending:', pending, '| disabled:', disabled);
    if (pending || disabled) return;
    setPending(provider);
    await runBusy(
      async () => {
        const result = provider === 'google'
          ? await signInWithGoogle()
          : await signInWithApple();
        console.log('[SocialAuth] provider sign-in resolved:', result);
        completeSocialSignIn(result);
      },
      () => setPending(null),
    ).catch((err) => {
      // Backing out of the provider's sheet is a decision, not a failure. An
      // alert here would mean every accidental tap ends in a dialog.
      if (err instanceof SocialSignInCancelled) return;
      Alert.alert(
        'Sign-in failed',
        err instanceof SocialSignInError
          ? err.message
          : 'Something went wrong. Please try again.',
      );
    });
  }

  if (!isGoogleAvailable && !appleReady) return null;

  const busy = disabled || pending !== null;

  return (
    <View style={s.wrap}>
      <View style={s.dividerRow}>
        <View style={s.rule} />
        <Text style={s.dividerText}>or continue with</Text>
        <View style={s.rule} />
      </View>

      {isGoogleAvailable ? (
        <Pressable
          onPress={() => run('google')}
          disabled={busy}
          style={({ pressed }) => [s.googleBtn, (pressed || busy) && s.dimmed]}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          accessibilityState={{ disabled: busy, busy: pending === 'google' }}
        >
          {pending === 'google' ? (
            <ActivityIndicator size="small" color={L.t2} />
          ) : (
            <>
              <GoogleMark />
              <Text style={s.googleLabel}>Continue with Google</Text>
            </>
          )}
        </Pressable>
      ) : null}

      {appleReady ? (
        // Apple's own button, not a lookalike. App Review rejects custom
        // renderings of the Apple mark, and this one also localises its label
        // and follows the system appearance for free.
        pending === 'apple' ? (
          <View style={s.applePlaceholder}>
            <ActivityIndicator size="small" color="#fff" />
          </View>
        ) : (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={BTN_RADIUS}
            style={s.appleBtn}
            onPress={() => run('apple')}
          />
        )
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 12 },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  rule: { flex: 1, height: 1, backgroundColor: L.border },
  dividerText: { fontFamily: fonts.body, fontSize: 13, color: L.t2 },

  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: BTN_HEIGHT,
    borderRadius: BTN_RADIUS,
    // White on the cream background, per Google's light-theme button spec —
    // the mark is only allowed on white or on Google Blue.
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: L.border,
  },
  googleLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 16,
    // Not L.t1: Google's spec pins the label to its own greys, and L.t1 is a
    // warm brown that reads as a tinted logo lockup next to the mark.
    color: '#1F1F1F',
  },

  appleBtn: { height: BTN_HEIGHT, width: '100%' },
  applePlaceholder: {
    height: BTN_HEIGHT,
    borderRadius: BTN_RADIUS,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },

  dimmed: { opacity: 0.6 },
});
