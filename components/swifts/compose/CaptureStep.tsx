import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraType,
  type FlashMode,
} from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  IconCameraFlip,
  IconClose,
  IconFlash,
  IconFlashOff,
  IconImage,
} from '@/components/ui/icons';
import { GlassIconButton, GlassSurface } from '@/components/ui/GlassSurface';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { MAX_SWIFT_MS, MIN_SWIFT_MS } from '@/services/swiftDraft';

/**
 * Record a vertical Swift, or pick one from the library.
 *
 * ## Why the permissions are handled the way they are
 *
 * Camera *and* microphone, requested separately and at different moments. The
 * camera is asked for when this screen opens, because there is nothing to show
 * without it. The microphone is asked for at the first press of record, and
 * only then — a mic prompt on a screen the user has not yet decided to record
 * on reads as an app listening, which on a proximity social app is exactly the
 * impression not to give.
 *
 * A refused microphone is not a dead end: `expo-camera` records silent video
 * happily, and a Swift with an attached track needs no original audio at all.
 * So a denial downgrades the feature rather than blocking the screen, and the
 * composer says so once rather than nagging.
 *
 * ## Duration
 *
 * `maxDuration` on the recording is the real ceiling — the OS stops the capture
 * itself, so a recording can never exceed it even if JS is busy. The ticking
 * progress ring is cosmetic and is driven by an interval, which means it may
 * drift by a frame or two; it is never the thing that decides when to stop.
 */

export interface CapturedVideo {
  uri: string;
  durationMs: number;
  width: number;
  height: number;
  source: 'camera' | 'library';
}

interface Props {
  onCaptured: (video: CapturedVideo) => void;
  onCancel: () => void;
}

/** How often the progress ring updates while recording. */
const TICK_MS = 100;

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `0:${String(total).padStart(2, '0')}`;
}

export function CaptureStep({ onCaptured, onCancel }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();

  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [micDenied, setMicDenied] = useState(false);

  const cameraRef = useRef<CameraView | null>(null);
  const startedAt = useRef(0);
  const cancelled = useRef(false);

  // Ask for the camera on arrival. The microphone deliberately waits — see the
  // component note.
  useEffect(() => {
    if (cameraPermission && !cameraPermission.granted && cameraPermission.canAskAgain) {
      requestCamera();
    }
  }, [cameraPermission, requestCamera]);

  // The ticking ring. Cleared on every state change, so a component that
  // unmounts mid-recording cannot leave an interval behind writing to state.
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      setElapsed(Date.now() - startedAt.current);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [recording]);

  // Leaving the screen while the camera is rolling has to stop it, or the
  // hardware stays held and the next screen gets a black preview.
  //
  // The ref is deliberately read *in the cleanup* rather than copied when the
  // effect runs, which is what `react-hooks/exhaustive-deps` objects to. Here
  // the usual advice produces the bug it is meant to prevent: this effect runs
  // at mount, and the `CameraView` below it does not exist yet — the screen is
  // still showing a permission gate — so a copied value would be `null` and the
  // cleanup would stop nothing. What has to be stopped is whichever camera is
  // mounted at unmount time, which is exactly what the ref holds then.
  useEffect(() => () => {
    cancelled.current = true;
    cameraRef.current?.stopRecording();
  }, []);

  async function handleRecord() {
    if (recording) {
      cameraRef.current?.stopRecording();
      return;
    }

    // The microphone, asked for at the moment it is about to be used.
    let withAudio = micPermission?.granted ?? false;
    if (!withAudio && micPermission?.canAskAgain !== false) {
      const result = await requestMic();
      withAudio = result.granted;
      if (!result.granted) setMicDenied(true);
    } else if (!withAudio) {
      setMicDenied(true);
    }

    setRecording(true);
    setElapsed(0);
    startedAt.current = Date.now();

    try {
      const result = await cameraRef.current?.recordAsync({
        // The OS enforces this, not our timer.
        maxDuration: MAX_SWIFT_MS / 1000,
      });
      if (cancelled.current) return;

      const durationMs = Date.now() - startedAt.current;
      if (!result?.uri) return;

      if (durationMs < MIN_SWIFT_MS) {
        Alert.alert('Too short', 'Hold the button to record at least a second.');
        return;
      }
      onCaptured({
        uri: result.uri,
        durationMs: Math.min(durationMs, MAX_SWIFT_MS),
        // The camera does not report dimensions; the composer reads them off
        // the player once the source loads — see EditStep's `onMeasured`.
        width: 0,
        height: 0,
        source: 'camera',
      });
    } catch {
      Alert.alert('Recording failed', 'Something interrupted the camera. Try again.');
    } finally {
      setRecording(false);
      setElapsed(0);
    }
  }

  async function handlePick() {
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      // `duration` is milliseconds and may be absent for some providers.
      const durationMs = Math.round(asset.duration ?? 0);
      if (durationMs && durationMs < MIN_SWIFT_MS) {
        Alert.alert('Too short', 'Pick a video at least a second long.');
        return;
      }
      onCaptured({
        uri: asset.uri,
        // Zero means "ask the player" — the trim step measures it either way,
        // and an over-long video is trimmed rather than refused.
        durationMs,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        source: 'library',
      });
    } catch {
      Alert.alert('Could not open your library', 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  // ── Permission states ──────────────────────────────────────────────────────
  if (!cameraPermission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.teal} />
      </View>
    );
  }

  if (!cameraPermission.granted) {
    const blocked = !cameraPermission.canAskAgain;
    return (
      <View style={styles.center}>
        <Text style={styles.gateTitle}>Camera access needed</Text>
        <Text style={styles.gateBody}>
          {blocked
            ? 'Camera access is turned off for Aura. You can turn it back on in Settings, or choose a video you already have.'
            : 'Aura needs the camera to record a Swift. Nothing is captured until you press record.'}
        </Text>
        <Pressable
          style={styles.gateBtn}
          onPress={() => (blocked ? Linking.openSettings() : requestCamera())}
          accessibilityRole="button"
        >
          <Text style={styles.gateBtnLabel}>
            {blocked ? 'Open Settings' : 'Allow camera'}
          </Text>
        </Pressable>
        <Pressable onPress={handlePick} hitSlop={10} accessibilityRole="button">
          <Text style={styles.gateAlt}>Choose from library instead</Text>
        </Pressable>
        <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button">
          <Text style={styles.gateCancel}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  const progress = Math.min(1, elapsed / MAX_SWIFT_MS);
  const flashOn = flash === 'on';
  // Flash is a torch while filming and meaningless on most front cameras, so
  // the control is hidden rather than shown-and-inert.
  const canFlash = facing === 'back';

  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        flash={flash}
        enableTorch={recording && flashOn && canFlash}
        mode="video"
        videoQuality="1080p"
      />

      {/* Top chrome */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <GlassIconButton
          onPress={onCancel}
          hitSlop={12}
          style={styles.chip}
          tone="dark"
          opacity={SCRIM}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <IconClose size={20} color="#FFFFFF" />
        </GlassIconButton>

        {recording ? (
          <GlassSurface style={styles.timer} tone="dark" opacity={SCRIM}>
            <View style={styles.recDot} />
            <Text style={styles.timerText} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
              {formatElapsed(elapsed)}
            </Text>
          </GlassSurface>
        ) : (
          <View />
        )}

        {canFlash ? (
          <GlassIconButton
            onPress={() => setFlash(flashOn ? 'off' : 'on')}
            hitSlop={12}
            style={[styles.chip, flashOn && styles.chipOn]}
            tone="dark"
            opacity={SCRIM}
            accessibilityRole="button"
            accessibilityLabel={flashOn ? 'Turn flash off' : 'Turn flash on'}
            accessibilityState={{ selected: flashOn }}
          >
            {flashOn
              ? <IconFlash size={20} color="#111111" />
              : <IconFlashOff size={20} color="#FFFFFF" />}
          </GlassIconButton>
        ) : (
          <View style={styles.chipSpacer} />
        )}
      </View>

      {micDenied && (
        <GlassSurface
          style={[styles.notice, { top: insets.top + 64 }]}
          tone="dark"
          opacity={0.55}
        >
          <Text style={styles.noticeText}>
            Recording without sound. You can add a track in the next step.
          </Text>
        </GlassSurface>
      )}

      {/* Bottom chrome */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 28 }]}>
        <GlassIconButton
          onPress={handlePick}
          disabled={recording || busy}
          hitSlop={12}
          style={[styles.sideBtn, (recording || busy) && styles.dimmed]}
          tone="dark"
          opacity={SCRIM}
          accessibilityRole="button"
          accessibilityLabel="Choose a video from your library"
        >
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <IconImage size={24} color="#FFFFFF" />}
        </GlassIconButton>

        <Pressable
          onPress={handleRecord}
          style={styles.shutterWrap}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
          accessibilityState={{ busy: recording }}
        >
          {/* Progress ring: a rotating border would need reanimated for one
              control, so the fill is a simple height-proportional bar behind
              the ring — legible, and it cannot drift out of step with the
              OS-enforced maximum. */}
          <View style={styles.shutterRing}>
            <View style={[styles.shutterProgress, { height: `${progress * 100}%` }]} />
          </View>
          <View style={recording ? styles.shutterStop : styles.shutterIdle} />
        </Pressable>

        <GlassIconButton
          onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          disabled={recording}
          hitSlop={12}
          style={[styles.sideBtn, recording && styles.dimmed]}
          tone="dark"
          opacity={SCRIM}
          accessibilityRole="button"
          accessibilityLabel="Switch camera"
        >
          <IconCameraFlip size={24} color="#FFFFFF" />
        </GlassIconButton>
      </View>
    </View>
  );
}

/** How dark the wash over the camera preview is.
 *
 *  The value the hand-written `rgba(0,0,0,0.45)` fills used, kept because it is
 *  the number that was actually tuned: enough for a white glyph to survive a
 *  bright frame behind it, light enough that the control does not black out the
 *  thing it is floating over. `GlassBackdrop`'s usual contrast floor does not
 *  apply over media — see its `tone` note. */
const SCRIM = 0.45;

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },

  gateTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.title,
    color: colors.t1,
    textAlign: 'center',
  },
  gateBody: {
    fontFamily: fonts.body,
    fontSize: typography.body,
    lineHeight: 21,
    color: colors.t2,
    textAlign: 'center',
  },
  gateBtn: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: radius.m,
    backgroundColor: colors.teal,
  },
  gateBtnLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.bg,
  },
  gateAlt: {
    marginTop: 6,
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.teal,
  },
  gateCancel: {
    marginTop: 2,
    fontFamily: fonts.body,
    fontSize: typography.small,
    color: colors.t3,
  },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: '#FFFFFF' },
  chipSpacer: { width: 38, height: 38 },

  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red },
  timerText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },

  notice: {
    position: 'absolute',
    left: 20,
    right: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.m,
  },
  noticeText: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    color: '#FFFFFF',
    textAlign: 'center',
  },

  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sideBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: { opacity: 0.4 },

  shutterWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  shutterRing: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 42,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.85)',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  shutterProgress: { width: '100%', backgroundColor: 'rgba(229,72,77,0.55)' },
  shutterIdle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF' },
  shutterStop: { width: 32, height: 32, borderRadius: 6, backgroundColor: colors.red },
});
