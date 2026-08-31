import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, lightColors as L } from '@/constants/theme';
import { openDocument, refreshDocuments, useTerms } from '@/services/terms';

// The agreement, in front of every door into the app.
//
// App Review's 1.2 asks that a user *explicitly agree* to terms which state
// there is no tolerance for objectionable content or abusive users. "Explicitly"
// is why this is a checkbox rather than a line of small print saying that
// continuing implies consent: implied consent is exactly what the guideline
// rules out, and a rejection on it is expensive.
//
// It sits above both the email form and the Google/Apple buttons, and it gates
// all three — see the `disabled` wiring in app/register.tsx and app/login.tsx.
// Getting that wrong on one provider is the classic way this comes back.
//
// Deliberately *not* the same component as `PermissionPrimer`: this is a
// consent screen that is not in front of an OS dialog, so it may — and must —
// have a way to decline. The two are easy to confuse and Apple treats them as
// opposites. See the header note in components/PermissionPrimer.tsx.

interface Props {
  accepted: boolean;
  onToggle: (next: boolean) => void;
  /** Greyed out while a submit is in flight. */
  disabled?: boolean;
}

export function TermsAgreement({ accepted, onToggle, disabled = false }: Props) {
  const { documents } = useTerms();

  useEffect(() => {
    // Public endpoint, safe before sign-in. Falls back to bundled URLs when
    // offline, so the links always resolve to something.
    refreshDocuments().catch(() => {});
  }, []);

  return (
    <View style={s.wrap}>
      <Pressable
        onPress={() => !disabled && onToggle(!accepted)}
        disabled={disabled}
        hitSlop={8}
        style={({ pressed }) => [s.row, pressed && !disabled && s.pressed]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted, disabled }}
        accessibilityLabel="I agree to the Approx Terms of Use, Community Guidelines and Privacy Policy"
        accessibilityHint="Required before you can create an account or sign in"
      >
        <View style={[s.box, accepted && s.boxChecked, disabled && s.dimmed]}>
          {/* A glyph, not a colour change alone — the checked state has to
              survive being read in greyscale or by somebody who cannot
              distinguish the tick colour from the border. */}
          {accepted ? <Text style={s.tick}>✓</Text> : null}
        </View>

        <Text style={[s.label, disabled && s.dimmed]}>
          I am 13 or older and I agree to Approx&rsquo;s{' '}
          <Text style={s.link} onPress={() => openDocument(documents.terms_url)}>
            Terms of Use
          </Text>
          ,{' '}
          <Text style={s.link} onPress={() => openDocument(documents.guidelines_url)}>
            Community Guidelines
          </Text>
          {' '}and{' '}
          <Text style={s.link} onPress={() => openDocument(documents.privacy_url)}>
            Privacy Policy
          </Text>
          .
        </Text>
      </Pressable>

      {/* The sentence App Review is actually looking for, said in the app and
          not only in the linked document. A reviewer who never opens the links
          has still been shown it. */}
      <Text style={s.zeroTolerance}>
        Approx has zero tolerance for objectionable content or abusive behaviour.
        Posts that break the guidelines are removed and the accounts behind them
        are suspended or banned.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 44 },
  pressed: { opacity: 0.7 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: L.border,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxChecked: { backgroundColor: L.teal, borderColor: L.teal },
  tick: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', lineHeight: 16 },
  label: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: L.t2,
  },
  link: { color: L.teal, fontWeight: '600', textDecorationLine: 'underline' },
  zeroTolerance: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: L.t3,
    paddingLeft: 32,
  },
  dimmed: { opacity: 0.5 },
});
