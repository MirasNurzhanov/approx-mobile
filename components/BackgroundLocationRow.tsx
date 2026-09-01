import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';

import { runBusy } from '@/services/busy';
import { Card } from '@/components/ui/Card';
import { fonts, radius } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  backgroundStatus,
  openAppSettings,
  requestBackground,
  SUPPORTS_BACKGROUND_LOCATION,
  PERMISSION_COPY,
  type BackgroundOutcome,
} from '@/services/permissions';
import {
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
} from '@/services/backgroundLocation';

// "Keep sharing while Approx is closed" — the one control that asks for Always.
//
// This exists because of the shape of the 5.1.1(iv) rejection, not in spite of
// it. Background location is a real Approx feature and it is staying; what was
// wrong was *when* it was requested. The map used to chain the Always request
// off the foreground grant on mount, so opening the app asked for it. Nobody
// had turned anything on.
//
// So it is now a switch, in Privacy & safety, next to the sharing control it
// extends. Turning it on is an explicit activation of a feature that genuinely
// cannot work without continuous location, which is exactly the circumstance
// Apple's guideline contemplates. Turning it off stops the task.
//
// The order below is the one iOS requires and the one the guideline expects:
//
//   user turns the switch on
//     -> Approx explains why, in the card the switch sits in
//     -> the switch is the Continue
//     -> iOS's own "Change to Always Allow?" dialog
//     -> whatever the user chooses is what happens
//
// Nothing here fakes, pre-empts or reinterprets Apple's dialog. When iOS will
// not show one — because the upgrade prompt has been spent — the row says so
// and offers Settings, rather than leaving a switch that silently fails.

interface Props {
  /** Whether the account is currently sharing at all. The switch is inert
   *  while Paused: there is nothing to continue in the background. */
  sharing: boolean;
}

export function BackgroundLocationRow({ sharing }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [status, setStatus] = useState<BackgroundOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await backgroundStatus());
  }, []);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  if (!SUPPORTS_BACKGROUND_LOCATION) return null;

  const on = status === 'granted';

  async function turnOn() {
    setBusy(true);
    // `runBusy` rather than a trailing `setBusy(false)`. Every *branch* below
    // does fall through to the end — which is what the note here used to
    // check — but `requestBackground()` is unguarded, and a rejection from it
    // skipped the reset entirely and left the switch dead for the session.
    // It is a module-level try/finally: written inline, a `finally` would
    // make React Compiler bail on this whole component.
    await runBusy(async () => {
      // `requestBackground` is a no-op when Always is already granted, and goes
      // through iOS's upgrade prompt when it is not. It never asks twice.
      const outcome = await requestBackground();
      setStatus(outcome);

      if (outcome === 'granted') {
        await startBackgroundLocationUpdates().catch(() => {});
      } else if (outcome === 'needs_foreground') {
        Alert.alert(
          'Location access first',
          'Approx needs ordinary location access before iOS will consider keeping '
          + 'it running in the background. Turn on Location in Settings → '
          + 'Permissions, then come back.',
        );
      } else if (outcome === 'needs_settings') {
        Alert.alert(
          'Set this in Settings',
          'iOS will not ask again from inside the app. Open Settings → Approx → '
          + 'Location and choose "Always".',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: openAppSettings },
          ],
        );
      }
    }, () => setBusy(false));
  }

  async function turnOff() {
    setBusy(true);
    // `await refresh()` below is unguarded and `backgroundStatus()` can
    // reject — the mount effect already concedes that with its own
    // `.catch()`. A rejection there used to skip the reset and leave the
    // switch disabled. See `turnOn` for why this is not an inline `finally`.
    await runBusy(async () => {
      // The OS permission is the user's to revoke in Settings; what this switch
      // owns is whether Approx *uses* it. Stopping the task is the honest meaning
      // of turning this off, and it takes effect immediately.
      await stopBackgroundLocationUpdates().catch(() => {});
      Alert.alert(
        'Background updates off',
        'Approx will only update your location while the app is open. To withdraw '
        + 'the permission itself, use Settings → Approx → Location.',
      );
      await refresh();
    }, () => setBusy(false));
  }

  const explanation = (() => {
    if (!sharing) {
      return 'Available once you choose Live or Approximate. There is nothing '
        + 'to keep updating while sharing is paused.';
    }
    if (on) {
      return 'Your location stays current with Approx in the background and your '
        + 'phone locked, for as long as you are sharing. Choosing Paused or '
        + 'closing Approx stops it.';
    }
    if (status === 'needs_settings') {
      return 'iOS will not ask again from inside the app. Open Settings → Approx '
        + '→ Location and choose "Always".';
    }
    if (status === 'needs_foreground') {
      return 'Turn on Location in Settings → Permissions first — iOS will not '
        + 'consider background access until it is granted.';
    }
    return PERMISSION_COPY.locationBackground.primer;
  })();

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={styles.label}>Keep sharing while Approx is closed</Text>
          <Text style={styles.hint}>{explanation}</Text>
        </View>
        <Switch
          value={on}
          onValueChange={(next) => (next ? turnOn() : turnOff())}
          disabled={busy || !sharing}
          trackColor={{ false: colors.border, true: colors.teal }}
          thumbColor={colors.bg}
          accessibilityLabel="Keep sharing my location while Approx is closed"
          accessibilityHint={
            on
              ? 'Turns off background location updates'
              : 'Shows the system request for Always location access'
          }
        />
      </View>

      <Text style={styles.optional}>
        Optional. Everything on the map works while Approx is open without this.
      </Text>
    </Card>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  card: { marginTop: 10, gap: 10, borderRadius: radius.l },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  text: { flex: 1, gap: 4 },
  label: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: colors.t1,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.t2,
  },
  optional: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.t3,
  },
});
