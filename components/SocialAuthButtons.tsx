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
 *
 * ── Why these are circles, and what that costs ───────────────────────────────
 * Both marks are logo-only circles rather than full-width labelled bars.
 *
 * That is allowed, and the rule is worth stating because it is the one thing
 * that constrains this file: Apple permits a **logo-only** Sign in with Apple
 * button to be circular, while a button carrying the logo *and* text must stay
 * rectangular. So the shape and the missing label are one decision, not two —
 * a circle with "Continue with Apple" in it would not be a legal button.
 *
 * The cost is that this is now a *custom* Sign in with Apple button, where it
 * used to be `AppleAuthentication.AppleAuthenticationButton` — Apple's own.
 * Three things came free with that and now have to be held by hand:
 *
 *   the mark      Apple's rule is to use their downloaded logo artwork and
 *                 never draw your own. This renders Ionicons' `logo-apple`,
 *                 which is what Settings → Connected Accounts already uses, so
 *                 the two Apple marks in the app at least match. Before
 *                 submission it should be swapped for the artwork from Apple
 *                 Design Resources — a one-line change here.
 *   the label     the native button localised "Continue with Apple" into every
 *                 language Apple ships. A logo-only button has no label to
 *                 localise, so nothing regresses — but the accessibility label
 *                 below is now the only wording, and it is English-only.
 *   recognition   Apple asks that a custom button still read instantly as a
 *                 Sign in with Apple button. Black circle, white mark (white
 *                 circle, black mark in dark mode, Apple's dark-background
 *                 style), sat next to Google under "or continue with" is the
 *                 conventional form of exactly that.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { fonts, type ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

/** Diameter. Comfortably past the 44pt minimum touch target, and large enough
 *  that a 24pt mark sits in it with room rather than filling it. */
const CIRCLE = 56;

// ── Brand glyphs ─────────────────────────────────────────────────────────────
// Drawn rather than imported: lucide has no brand marks, and both Google and
// Apple require their own logo, in their own colours, un-recoloured. These are
// the official paths, so nothing here is a lookalike.

export function GoogleMark({ size = 20 }: { size?: number }) {
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

export default function SocialAuthButtons({
  disabled = false,
  acceptedTerms = false,
}: {
  /** A *hard* stop — the form is mid-submit and nothing should start. Not the
   *  terms checkbox: see `acceptedTerms`, which this used to be conflated with
   *  and which now blocks the sign-in by itself. */
  disabled?: boolean;
  /** Whether the user has ticked the agreement on the screen above.
   *
   *  Two jobs, and they used to be split across two props in a way that lost
   *  one of them. It is passed to the server, which refuses to create an
   *  account without it — and it also gates the tap here, rather than the
   *  caller separately folding `!acceptedTerms` into `disabled`.
   *
   *  The reason it moved is that `disabled` cannot explain itself. A tap on a
   *  disabled Pressable does not reach any handler, so an unticked checkbox
   *  made both buttons completely inert with no message, no alert and nothing
   *  but a 0.6 opacity — which on a white circle over a cream background is
   *  very close to invisible. "The buttons do not work" is the correct reading
   *  of that. Gating here means the tap lands, and says what is missing. */
  acceptedTerms?: boolean;
}) {
  const { completeSocialSignIn } = useAuth();
  const { colors: L, themeMode } = useTheme();
  const dark = themeMode === 'dark';
  const s = useMemo(() => makeStyles(L, dark), [L, dark]);
  // Apple's dark-background style is the white button with a black mark.
  const appleInk = dark ? '#000000' : '#FFFFFF';
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
    if (pending || disabled) return;
    // Before anything else, and *not* by being disabled. The sign-in still
    // cannot run without the agreement — `acceptedTerms` is checked here and
    // sent to the server, which refuses the account on its own — but a person
    // who taps now gets told why instead of watching nothing happen.
    if (!acceptedTerms) {
      Alert.alert(
        'Agree to the Terms first',
        'Tick the box above to agree to the Terms of Use, then continue with Google or Apple.',
      );
      return;
    }
    setPending(provider);
    await runBusy(
      async () => {
        const result = provider === 'google'
          ? await signInWithGoogle(acceptedTerms)
          : await signInWithApple(acceptedTerms);
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

  /** Hard stop: nothing may start. The Pressable is genuinely disabled. */
  const busy = disabled || pending !== null;
  /** Soft stop: dimmed to show it is not ready, but still receives the tap so
   *  it can say what is missing. */
  const blocked = !acceptedTerms;
  const hint = blocked ? 'Agree to the Terms of Use first' : undefined;

  return (
    <View style={s.wrap}>
      <View style={s.dividerRow}>
        <View style={s.rule} />
        <Text style={s.dividerText}>or continue with</Text>
        <View style={s.rule} />
      </View>

      <View style={s.row}>
        {isGoogleAvailable ? (
          <Pressable
            onPress={() => run('google')}
            disabled={busy}
            style={({ pressed }) => [s.circle, s.googleCircle, (pressed || busy || blocked) && s.dimmed]}
            accessibilityRole="button"
            // Load-bearing now in a way it was not before. The label used to be
            // on screen as well; with the text gone this string is the only
            // thing a screen reader has to go on, so it stays a full sentence
            // rather than "Google".
            accessibilityLabel="Continue with Google"
            accessibilityHint={hint}
            accessibilityState={{ disabled: busy, busy: pending === 'google' }}
          >
            {pending === 'google'
              ? <ActivityIndicator size="small" color={L.t2} />
              : <GoogleMark size={24} />}
          </Pressable>
        ) : null}

        {appleReady ? (
          <Pressable
            onPress={() => run('apple')}
            disabled={busy}
            style={({ pressed }) => [s.circle, s.appleCircle, (pressed || busy || blocked) && s.dimmed]}
            accessibilityRole="button"
            accessibilityLabel="Continue with Apple"
            accessibilityHint={hint}
            accessibilityState={{ disabled: busy, busy: pending === 'apple' }}
          >
            {pending === 'apple'
              ? <ActivityIndicator size="small" color={appleInk} />
              : <Ionicons name="logo-apple" size={26} color={appleInk} style={s.appleGlyph} />}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (L: ColorPalette, dark: boolean) => StyleSheet.create({
  wrap: { gap: 12 },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  rule: { flex: 1, height: 1, backgroundColor: L.border },
  dividerText: { fontFamily: fonts.body, fontSize: 13, color: L.t2 },

  /** The two marks sit together as a pair, centred, rather than stacked as two
   *  full-width bars. With the labels gone there is nothing to left-align to. */
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginTop: 4,
  },

  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  googleCircle: {
    // Google's own button themes: white with a light stroke on light pages,
    // #131314 with an #8E918F stroke on dark ones. The mark keeps its colours
    // in both, so the circle carries its own fill rather than the page's.
    backgroundColor: dark ? '#131314' : '#FFFFFF',
    borderWidth: 1,
    borderColor: dark ? '#8E918F' : L.border,
  },

  appleCircle: { backgroundColor: dark ? '#FFFFFF' : '#000000' },
  /** The Apple mark's leaf puts its optical centre below its bounding-box
   *  centre, so a glyph centred by geometry reads as sitting low. */
  appleGlyph: { marginTop: -2 },

  dimmed: { opacity: 0.6 },
});
