import { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  check,
  openAppSettings,
  request,
  PERMISSION_COPY,
  type PermissionInfo,
  type PermissionKey,
} from '@/services/permissions';
import { colors, fonts, radius, type as typography } from '@/constants/theme';

// Priming: explain in-app, then let the OS ask.
//
// iOS gives an app exactly one shot at each permission dialog. A cold prompt
// that gets refused is permanent until the user goes digging in Settings, so
// the system dialog is never the first thing the user sees — this sheet is,
// and it only appears when the permission has never been asked for.
//
// Usage:
//   const { ensure, primer } = usePermissionPrimer();
//   ... if (!(await ensure('camera'))) return;
//   ... render {primer} somewhere in the tree

type Pending = {
  key: PermissionKey;
  resolve: (granted: boolean) => void;
  /** Already refused before — offer Settings rather than a dead button. */
  blocked: boolean;
};

export function usePermissionPrimer() {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const settle = useCallback((granted: boolean) => {
    pendingRef.current?.resolve(granted);
    setPending(null);
  }, []);

  /**
   * Resolves true when the permission is usable. Shows the explanation sheet
   * first when the permission has never been asked for, and a "open Settings"
   * sheet when it was permanently refused. Never prompts twice.
   */
  const ensure = useCallback(async (key: PermissionKey): Promise<boolean> => {
    const info: PermissionInfo = await check(key);

    if (info.state === 'granted') return true;
    if (info.state === 'unsupported') return false;

    return new Promise<boolean>((resolve) => {
      setPending({ key, resolve, blocked: info.state === 'blocked' });
    });
  }, []);

  const onContinue = useCallback(async () => {
    const current = pendingRef.current;
    if (!current) return;
    if (current.blocked) {
      openAppSettings();
      settle(false);
      return;
    }
    const info = await request(current.key);
    settle(info.state === 'granted');
  }, [settle]);

  const copy = pending ? PERMISSION_COPY[pending.key] : null;

  const primer = (
    <Modal
      visible={!!pending}
      transparent
      animationType="fade"
      onRequestClose={() => settle(false)}
    >
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
            {pending?.blocked ? copy?.denied : copy?.primer}
          </Text>

          <Pressable
            onPress={onContinue}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={pending?.blocked ? 'Open system settings' : 'Continue'}
            accessibilityHint={
              pending?.blocked
                ? 'Opens the system settings app so you can turn this permission on'
                : 'Shows the system permission request'
            }
          >
            <Text style={styles.primaryText}>
              {pending?.blocked ? 'Open Settings' : 'Continue'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => settle(false)}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Not now"
          >
            <Text style={styles.secondaryText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  return { ensure, primer };
}

const styles = StyleSheet.create({
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
