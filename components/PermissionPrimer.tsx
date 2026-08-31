import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  check,
  openAppSettings,
  request,
  PERMISSION_COPY,
  type PermissionInfo,
  type PermissionKey,
} from '@/services/permissions';
import { fonts, radius, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// Explain in-app, then let the OS ask. Immediately, and with no way around it.
//
// ─── Why there is no "Not Now" ────────────────────────────────────────────────
//
// There used to be one, and it is what App Review rejected under 5.1.1(iv):
// a custom message appeared before the system permission request, and the user
// could choose "Not Now" and delay the native dialog. Apple treats a
// pre-permission screen that can defer their dialog as an attempt to manage the
// permission decision on their behalf, whether or not that was the intent.
//
// So this sheet now has exactly one action in the state that precedes a native
// dialog — **Continue** — and pressing it goes straight to the OS. There is no
// Not Now, no Skip, no X, no backdrop dismissal, and Android's back button is a
// no-op while it is up.
//
// The user still has complete control: they exercise it in Apple's own dialog,
// which is the only place Apple wants that choice made. Nothing here touches,
// pre-empts or reinterprets Allow / Don't Allow / Allow Once.
//
// ─── The one state that keeps a Cancel ────────────────────────────────────────
//
// When a permission is `blocked` — refused permanently, `canAskAgain` false —
// there is no native dialog left to precede. iOS will not show one again, so
// the sheet is not a pre-permission screen at all: it is a signpost to Settings.
// Apple asks for exactly two actions there, Open Settings and Cancel, and that
// is what it has. `restricted` (parental controls, MDM) is the same shape and
// takes the same treatment.
//
// This distinction is the whole of the rule. A sheet in front of Apple's dialog
// may not offer a way out; a sheet that has no dialog behind it must.
//
// ─── Not to be confused with ──────────────────────────────────────────────────
//
// `components/TermsAgreement` and `components/LocationSharingConsent` are
// consent screens that do *not* precede a native dialog, and both must be
// declinable. Making those undismissible, or making this one dismissible, are
// both rejections.
//
// Usage:
//   const { ensure, primer } = usePermissionPrimer();
//   ... if (!(await ensure('camera'))) return;
//   ... render {primer} somewhere in the tree

type Pending = {
  key: PermissionKey;
  resolve: (granted: boolean) => void;
  /** No native dialog is available any more — offer Settings instead of a
   *  Continue button that would do nothing. */
  needsSettings: boolean;
};

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 28,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    gap: 12,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.title,
    color: colors.t1,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: typography.body,
    lineHeight: typography.body * 1.45,
    color: colors.t2,
    marginBottom: 6,
  },
  primary: {
    backgroundColor: colors.teal,
    borderRadius: radius.m,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  primaryText: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: typography.body,
    color: colors.bg,
  },
  secondary: {
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t2,
  },
  pressed: { opacity: 0.7 },
});

export function usePermissionPrimer() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [pending, setPending] = useState<Pending | null>(null);
  // Mirrors `pending` for the two callbacks below. Both are driven by a tap on
  // the sheet, so they cannot run before this effect has caught the ref up.
  const pendingRef = useRef<Pending | null>(null);
  useEffect(() => { pendingRef.current = pending; });

  // Kept despite react-doctor/react-compiler-no-manual-memoization: `ensure`
  // is this hook's whole public surface, consumed across seven other files that
  // rely on its identity staying stable — `settle`/`onContinue` memoized to
  // match, since `onContinue` depends on `settle`.
  const settle = useCallback((granted: boolean) => {
    pendingRef.current?.resolve(granted);
    setPending(null);
  }, []);

  /**
   * Resolves true when the permission is usable.
   *
   * Shows the explanation sheet when a native dialog is still available, and a
   * "open Settings" sheet when it is not. Never prompts twice, and never
   * resolves without either the OS having been asked or the user having been
   * sent somewhere they can change it.
   */
  const ensure = useCallback(async (key: PermissionKey): Promise<boolean> => {
    const info: PermissionInfo = await check(key);

    if (info.state === 'granted') return true;
    if (info.state === 'unsupported') return false;

    return new Promise<boolean>((resolve) => {
      setPending({
        key,
        resolve,
        // `denied` on iOS means the dialog was refused and will not come back;
        // on Android it means "ask again is still allowed". `check()` already
        // resolves that difference into `blocked` vs `denied`, so this reads
        // the resolved answer rather than re-deriving it.
        needsSettings: info.state === 'blocked' || info.state === 'restricted',
      });
    });
  }, []);

  const onContinue = useCallback(async () => {
    const current = pendingRef.current;
    if (!current) return;
    if (current.needsSettings) {
      openAppSettings();
      settle(false);
      return;
    }
    // Straight to Apple's dialog. Nothing between this line and the OS.
    const info = await request(current.key);
    settle(info.state === 'granted');
  }, [settle]);

  const copy = pending ? PERMISSION_COPY[pending.key] : null;
  const needsSettings = pending?.needsSettings ?? false;

  const primer = (
    <Modal
      visible={!!pending}
      transparent
      animationType="fade"
      // A no-op in the pre-permission state: Android's back button must not
      // defer the system dialog either, which is the same rule the missing
      // "Not Now" enforces. In the Settings state there is no dialog to defer,
      // so back behaves like Cancel.
      onRequestClose={() => { if (needsSettings) settle(false); }}
    >
      {/* Not a Pressable. A tappable backdrop is a dismissal, and dismissing
          this sheet is dismissing Apple's dialog before it is shown. */}
      <View style={styles.backdrop}>
        <View
          style={styles.sheet}
          accessibilityViewIsModal
          accessible={false}
        >
          <Text style={styles.title} accessibilityRole="header">
            {copy?.title}
          </Text>
          <Text style={styles.body}>
            {needsSettings ? copy?.denied : copy?.primer}
          </Text>

          <Pressable
            onPress={onContinue}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={needsSettings ? 'Open system settings' : 'Continue'}
            accessibilityHint={
              needsSettings
                ? 'Opens the system settings app so you can turn this permission on'
                : 'Shows the system permission request, where you can allow or deny'
            }
          >
            <Text style={styles.primaryText}>
              {needsSettings ? 'Open Settings' : 'Continue'}
            </Text>
          </Pressable>

          {/* Only in the Settings state. See the header note: a Cancel here
              when a native dialog is still available is the 5.1.1(iv)
              rejection. */}
          {needsSettings ? (
            <Pressable
              onPress={() => settle(false)}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );

  return { ensure, primer };
}
