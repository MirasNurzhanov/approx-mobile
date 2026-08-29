import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { acceptTerms, openDocument, useTerms } from '@/services/terms';

// The agreement, for accounts that already existed when it landed.
//
// Everybody who signs up from now on agrees at the door (components/
// TermsAgreement). This is the other half: an install with a live session has
// never been shown the document, and breaking those accounts to fix that would
// be a worse outcome than the problem. So the gate meets them on next launch
// instead — mandatory, but survivable.
//
// It is deliberately *not* dismissible, and that is not the thing App Review
// objected to. What they objected to was a custom sheet standing between a user
// and a native permission dialog with a "Not Now" on it. This stands in front
// of nothing native; it is the agreement itself, and an agreement you can swipe
// away is not one. The way out is "Sign out", which is present and works.

interface Props {
  visible: boolean;
  onAccepted: () => void;
  onSignOut: () => void;
}

export function TermsGate({ visible, onAccepted, onSignOut }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { top, bottom } = useSafeAreaInsets();
  const { documents } = useTerms();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleAccept() {
    setBusy(true);
    setFailed(false);
    try {
      await acceptTerms();
      onAccepted();
    } catch {
      // The gate stays up. Dismissing it on a failed write would leave an
      // account that has agreed on screen and not in the database, which is the
      // one state this whole mechanism exists to prevent.
      setFailed(true);
    }
    // Not a `finally` — React Compiler bails on any component containing one,
    // and both exits above are covered.
    setBusy(false);
  }

  // See the note in components/ReportSheet: a hidden `Modal` still mounts its
  // children, and this one lives in the root layout, so it would otherwise
  // render on every navigation for the whole life of the app.
  if (!visible) return null;

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="overFullScreen"
      transparent
      // No `onRequestClose` action: Android's back button must not dismiss
      // this. Passing a no-op is what keeps the modal from closing itself.
      onRequestClose={() => {}}
    >
      <View style={[styles.root, { paddingTop: top + 24, paddingBottom: bottom + 20 }]}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title} accessibilityRole="header">
            Our terms have been updated
          </Text>
          <Text style={styles.body}>
            Before you carry on, please read and agree to the documents below.
            They set out what Aura is for, what is not allowed on it, and what
            we do with your data.
          </Text>

          <View style={styles.zeroCard}>
            <Text style={styles.zeroTitle}>Zero tolerance</Text>
            <Text style={styles.zeroBody}>
              Aura has zero tolerance for objectionable content and abusive
              users. Harassment, threats, hate speech, sexual content involving
              minors, and impersonation are prohibited. Content that breaks the
              guidelines is removed, and the accounts behind it are suspended or
              banned.
            </Text>
            <Text style={styles.zeroBody}>
              Every post, comment, story and profile can be reported from inside
              the app, and any account can be blocked. Reports are reviewed by a
              person.
            </Text>
          </View>

          <View style={styles.links}>
            <DocLink label="Terms of Use" onPress={() => openDocument(documents.terms_url)} styles={styles} />
            <DocLink label="Community Guidelines" onPress={() => openDocument(documents.guidelines_url)} styles={styles} />
            <DocLink label="Privacy Policy" onPress={() => openDocument(documents.privacy_url)} styles={styles} />
          </View>

          {failed ? (
            <Text style={styles.error}>
              We couldn&rsquo;t record that. Check your connection and try again.
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          <Pressable
            onPress={handleAccept}
            disabled={busy}
            style={({ pressed }) => [
              styles.primary,
              pressed && { opacity: 0.85 },
              busy && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="I agree to the terms"
            accessibilityState={{ disabled: busy, busy }}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.bg} />
            ) : (
              <Text style={styles.primaryText}>I agree</Text>
            )}
          </Pressable>

          {/* The way out. Not a dismissal — declining the terms and continuing
              to use the app are not compatible, so the honest alternative is
              to leave. */}
          <Pressable
            onPress={onSignOut}
            disabled={busy}
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Sign out instead"
          >
            <Text style={styles.secondaryText}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function DocLink({ label, onPress, styles }: {
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.docLink, pressed && { opacity: 0.6 }]}
      accessibilityRole="link"
      accessibilityLabel={`Read the ${label}`}
    >
      <Text style={styles.docLinkText}>{label}</Text>
      <Text style={styles.docLinkChevron}>›</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 24 },
  scroll: { paddingBottom: 24, gap: 16 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 24,
    color: colors.t1,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.t2,
  },
  zeroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 10,
  },
  zeroTitle: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 16,
    color: colors.t1,
  },
  zeroBody: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.t2,
  },
  links: { gap: 2 },
  docLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  docLinkText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: colors.teal,
  },
  docLinkChevron: { fontSize: 22, color: colors.t3, lineHeight: 24 },
  error: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.red,
    marginTop: 4,
  },
  actions: { gap: 4 },
  primary: {
    minHeight: 52,
    borderRadius: radius.m,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: 16,
    color: colors.bg,
  },
  secondary: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 14,
    color: colors.t3,
  },
});
