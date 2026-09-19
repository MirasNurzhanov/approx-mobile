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
  EffectTray,
  RotationTray,
  SpeedTray,
  TimerTray,
} from '@/components/swifts/compose/CaptureControls';
import { SwiftStage } from '@/components/swifts/SwiftStage';
import { hasEffect } from '@/constants/swiftEffects';
import {
  IconCameraFlip,
  IconClose,
  IconFlash,
  IconFlashOff,
  IconGauge,
  IconImage,
  IconMic,
  IconMicOff,
  IconMusic,
  IconRotate,
  IconSparkle,
  IconTimer,
} from '@/components/ui/icons';
import { GlassIconButton, GlassSurface } from '@/components/ui/GlassSurface';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  MAX_SWIFT_MS,
  MIN_SWIFT_MS,
  playedMs,
  recordLimitMs,
  type SwiftDraft,
  type SwiftRotation,
} from '@/services/swiftDraft';

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
 * impression not to give. It is not asked for at all when the creator has
 * turned the mic off.
 *
 * A refused microphone is not a dead end: `expo-camera` records silent video
 * happily, and a Swift with an attached track needs no original audio. So a
 * denial downgrades the feature rather than blocking the screen, and the
 * composer says so once rather than nagging.
 *
 * ## Duration, and why the ceiling moves
 *
 * `maxDuration` on the recording is the real ceiling — the OS stops the
 * capture itself, so a recording can never exceed it even if JS is busy. What
 * that number *is* depends on the speed: at 0.5× a take may only roll for
 * thirty seconds, because those thirty seconds play as sixty. `recordLimitMs`
 * folds the creator's own "stop after" choice into the same number. The
 * ticking progress ring is cosmetic, is driven by an interval, and is never
 * the thing that decides when to stop.
 *
 * ## Why the effect is live on the preview
 *
 * Because it is the same three blended `View`s the feed will draw — see
 * `SwiftStage`. Framing a shot under the look it publishes under is the whole
 * point; an effect chosen afterwards, against footage composed without it, is
 * a different and worse feature.
 */

export interface CapturedVideo {
  uri: string;
  durationMs: number;
  width: number;
  height: number;
  source: 'camera' | 'library';
}

interface Props {
  /** The capture settings live on the draft, so a take carries them forward. */
  draft: SwiftDraft;
  onChange: (patch: Partial<SwiftDraft>) => void;
  onCaptured: (video: CapturedVideo) => void;
  onCancel: () => void;
  /** Opens the track picker. Held by the composer, which owns the sheet. */
  onPickMusic: () => void;
}

/** Which tray is open, if any. */
type Tray = 'speed' | 'effect' | 'timer' | 'rotate' | null;

/** How often the progress ring updates while recording. */
const TICK_MS = 100;

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `0:${String(total).padStart(2, '0')}`;
}

export function CaptureStep({
  draft, onChange, onCaptured, onCancel, onPickMusic,
}: Props) {
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
  const [tray, setTray] = useState<Tray>(null);
  /** Seconds left before a hands-free take starts, or null when not counting. */
  const [counting, setCounting] = useState<number | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });

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


  async function beginRecording() {
    // The microphone, asked for at the moment it is about to be used — and not
    // at all when the creator has turned it off, which is the point of having
    // the switch.
    let withAudio = false;
    if (draft.micEnabled) {
      withAudio = micPermission?.granted ?? false;
      if (!withAudio && micPermission?.canAskAgain !== false) {
        const result = await requestMic();
        withAudio = result.granted;
        if (!result.granted) setMicDenied(true);
      } else if (!withAudio) {
        setMicDenied(true);
      }
    }

    // `withAudio` is deliberately not passed on to the recording: whether
    // audio is captured at all is the `mute` prop on the camera below, and a
    // refused permission produces silent video from the OS regardless. It is
    // tracked only so the screen can say so once.
    void withAudio;

    // Read before the `try`: an optional call is a "value block", which React
    // Compiler cannot lower inside a try/catch, and it gives up on the whole
    // component when it meets one. There is nothing to record without a mounted
    // camera in any case — the screen is still showing the permission gate.
    const camera = cameraRef.current;
    if (!camera) return;

    setRecording(true);
    setElapsed(0);
    startedAt.current = Date.now();

    // Only the await is inside the `try`. Everything that inspects the result
    // reads it with `?.`, and an optional chain — like a ternary or a `??` — is
    // a "value block" React Compiler cannot lower inside a try/catch, so it
    // would bail on the whole component. The handling below is unreachable on
    // the throwing path anyway, because `result` stays undefined.
    let result: Awaited<ReturnType<NonNullable<typeof camera.recordAsync>>> | undefined;
    try {
      result = await camera.recordAsync({
        // The OS enforces this, not our timer. In *source* seconds, which is
        // what the camera measures — see the note on duration above.
        maxDuration: recordLimitMs(draft) / 1000,
      });
    } catch {
      Alert.alert('Recording failed', 'Something interrupted the camera. Try again.');
    }

    // Nested rather than the three early returns this used to use: those only
    // cleared the spinner because a `finally` caught them, and React Compiler
    // bails on any component containing one.
    if (!cancelled.current && result?.uri) {
      const sourceMs = Date.now() - startedAt.current;
      // Measured against what a viewer will watch, not against what was
      // recorded: at 3× a two-second press is a 0.66-second Swift and is too
      // short, and at 0.3× a one-second press is not.
      if (playedMs(sourceMs, draft.speedPercent) < MIN_SWIFT_MS) {
        Alert.alert('Too short', 'Hold the button to record at least a second.');
      } else {
        onCaptured({
          uri: result.uri,
          durationMs: Math.min(sourceMs, recordLimitMs(draft)),
          // The camera does not report dimensions; the composer reads them off
          // the player once the source loads — see EditStep's `onMeasured`.
          width: 0,
          height: 0,
          source: 'camera',
        });
      }
    }
    setRecording(false);
    setElapsed(0);
  }

  /**
   * The hands-free countdown.
   *
   * A state machine rather than a chain of `setTimeout`s, so that leaving the
   * screen or pressing the shutter again cancels it by the ordinary means —
   * clearing the state — instead of needing a handle to every pending timer.
   */
  useEffect(() => {
    if (counting === null) return;
    if (counting <= 0) {
      setCounting(null);
      beginRecording();
      return;
    }
    const timer = setTimeout(() => setCounting((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(timer);
    // `beginRecording` is stable enough for this: it reads everything it needs
    // off refs and current props at call time, and adding it would restart the
    // countdown on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counting]);

  function handleRecord() {
    if (recording) {
      cameraRef.current?.stopRecording();
      return;
    }
    // A press during the countdown means "never mind", which is the only way
    // to call one off once it has started.
    if (counting !== null) {
      setCounting(null);
      return;
    }
    setTray(null);
    if (draft.countdownS > 0) {
      setCounting(draft.countdownS);
      return;
    }
    beginRecording();
  }

  async function handlePick() {
    setBusy(true);
    // Only the await is inside the `try`, for the same reason as `beginRecording`
    // above: the checks below need `?.` and `??`, and those are "value blocks"
    // React Compiler cannot lower inside a try/catch.
    let picked: ImagePicker.ImagePickerResult | undefined;
    try {
      picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 1,
      });
    } catch {
      Alert.alert('Could not open your library', 'Try again in a moment.');
    }

    // Nested rather than the two early returns this used to use: those only
    // cleared the spinner because a `finally` caught them.
    if (picked && !picked.canceled && picked.assets?.length) {
      const asset = picked.assets[0];
      // `duration` is milliseconds and may be absent for some providers.
      const durationMs = Math.round(asset.duration ?? 0);
      if (durationMs && playedMs(durationMs, draft.speedPercent) < MIN_SWIFT_MS) {
        Alert.alert('Too short', 'Pick a video at least a second long.');
      } else {
        onCaptured({
          uri: asset.uri,
          // Zero means "ask the player" — the trim step measures it either way,
          // and an over-long video is trimmed rather than refused.
          durationMs,
          width: asset.width ?? 0,
          height: asset.height ?? 0,
          source: 'library',
        });
      }
    }
    setBusy(false);
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
            ? 'Camera access is turned off for Approx. You can turn it back on in Settings, or choose a video you already have.'
            : 'Approx needs the camera to record a Swift. Nothing is captured until you press record.'}
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

  const limit = recordLimitMs(draft);
  const progress = Math.min(1, elapsed / Math.max(1, limit));
  const flashOn = flash === 'on';
  // Flash is a torch while filming and meaningless on most front cameras, so
  // the control is hidden rather than shown-and-inert.
  const canFlash = facing === 'back';
  const locked = recording || counting !== null;

  return (
    <View style={styles.root}>
      <View
        style={StyleSheet.absoluteFill}
        onLayout={(e) => setStage({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        })}
      >
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flash}
          enableTorch={recording && flashOn && canFlash}
          mode="video"
          videoQuality="1080p"
          // A take recorded with the mic off has no audio track at all, rather
          // than a silent one — `SwiftDraft.micEnabled` argues why that is a
          // different promise from muting. It is a prop on the view rather
          // than an option on `recordAsync`, which is the only place
          // `expo-camera` accepts it.
          //
          // Deliberately not also set when the *permission* was refused: the
          // OS records silent video in that case anyway, and `micDenied` is
          // written from inside `beginRecording` — it would not have
          // re-rendered this view before the recording it was meant to affect
          // had already begun.
          mute={!draft.micEnabled}
        />
        {/* The same layer stack the feed draws, over the live preview — so what
            is framed here is what publishes. Stickers and text are added in the
            editor, hence the empty list.

            Mounted only when there is a treatment to draw. With no effect
            chosen this component renders an empty full-bleed `View`, and the
            default path should put *nothing* over the camera surface — the
            preview freeze this feature caused once already came from a view
            sitting on top of it, so the safest default is no view at all. */}
        {hasEffect(draft.effect) && (
          <SwiftStage
            size={stage}
            effect={draft.effect}
            effectIntensity={draft.effectIntensity}
            stickers={[]}
            overlayText=""
            overlayPosition="middle"
          />
        )}
      </View>

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

      {/* The tool rail. Hidden while a take is under way — none of these can be
          changed mid-recording, and a rail of inert buttons invites the press
          that does nothing. */}
      {!locked && (
        <View style={[styles.rail, { top: insets.top + 64 }]}>
          <RailButton
            label="Speed"
            active={tray === 'speed'}
            badge={draft.speedPercent === 100 ? null : `${draft.speedPercent / 100}×`}
            onPress={() => setTray(tray === 'speed' ? null : 'speed')}
          >
            <IconGauge size={20} color="#FFFFFF" />
          </RailButton>

          <RailButton
            label="Effect"
            active={tray === 'effect'}
            badge={draft.effect ? '●' : null}
            onPress={() => setTray(tray === 'effect' ? null : 'effect')}
          >
            <IconSparkle size={20} color="#FFFFFF" />
          </RailButton>

          <RailButton
            label="Timer"
            active={tray === 'timer'}
            badge={
              draft.countdownS > 0 || draft.limitMs !== null
                ? `${draft.countdownS > 0 ? `${draft.countdownS}s` : ''}${
                  draft.limitMs !== null ? `·${draft.limitMs / 1000}` : ''}`
                : null
            }
            onPress={() => setTray(tray === 'timer' ? null : 'timer')}
          >
            <IconTimer size={20} color="#FFFFFF" />
          </RailButton>

          <RailButton
            label="Rotate"
            active={tray === 'rotate'}
            badge={draft.rotationDeg ? `${draft.rotationDeg}°` : null}
            onPress={() => setTray(tray === 'rotate' ? null : 'rotate')}
          >
            <IconRotate size={20} color="#FFFFFF" />
          </RailButton>

          <RailButton
            label={draft.track ? 'Track' : 'Music'}
            active={false}
            badge={draft.track ? '♪' : null}
            onPress={onPickMusic}
          >
            <IconMusic size={20} color="#FFFFFF" />
          </RailButton>

          <RailButton
            label={draft.micEnabled ? 'Mic on' : 'Mic off'}
            active={!draft.micEnabled}
            badge={null}
            onPress={() => onChange({ micEnabled: !draft.micEnabled })}
          >
            {draft.micEnabled
              ? <IconMic size={20} color="#FFFFFF" />
              : <IconMicOff size={20} color="#FFFFFF" />}
          </RailButton>
        </View>
      )}

      {micDenied && draft.micEnabled && (
        <GlassSurface
          style={[styles.notice, { top: insets.top + 64 }]}
          tone="dark"
          opacity={0.55}
        >
          <Text style={styles.noticeText}>
            Recording without sound. You can add a track instead.
          </Text>
        </GlassSurface>
      )}

      {!draft.micEnabled && !micDenied && (
        <GlassSurface
          style={[styles.notice, { top: insets.top + 64 }]}
          tone="dark"
          opacity={0.55}
        >
          <Text style={styles.noticeText}>
            Mic off — nothing around you is being recorded.
          </Text>
        </GlassSurface>
      )}

      {/* The countdown, over everything. Large enough to read from where
          somebody has just put the phone down and stepped back. */}
      {counting !== null && counting > 0 && (
        <View style={styles.countdown} pointerEvents="none">
          <Text style={styles.countdownNumber} allowFontScaling={false}>
            {counting}
          </Text>
        </View>
      )}

      {/* The open tray, above the shutter. */}
      {!locked && tray !== null && (
        <View style={[styles.trayWrap, { bottom: insets.bottom + 128 }]}>
          {tray === 'speed' && (
            <SpeedTray
              value={draft.speedPercent}
              onChange={(speedPercent) => onChange({ speedPercent })}
            />
          )}
          {tray === 'effect' && (
            <EffectTray value={draft.effect} onChange={(effect) => onChange({ effect })} />
          )}
          {tray === 'timer' && (
            <TimerTray
              countdownS={draft.countdownS}
              limitMs={draft.limitMs}
              onCountdown={(countdownS) => onChange({ countdownS })}
              onLimit={(limitMs) => onChange({ limitMs })}
            />
          )}
          {tray === 'rotate' && (
            <RotationTray
              value={draft.rotationDeg}
              onChange={(rotationDeg: SwiftRotation) => onChange({ rotationDeg })}
            />
          )}
        </View>
      )}

      {/* Bottom chrome */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 28 }]}>
        <GlassIconButton
          onPress={handlePick}
          disabled={locked || busy}
          hitSlop={12}
          style={[styles.sideBtn, (locked || busy) && styles.dimmed]}
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
          accessibilityLabel={
            recording ? 'Stop recording'
              : counting !== null ? 'Cancel countdown'
                : 'Start recording'
          }
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
          disabled={locked}
          hitSlop={12}
          style={[styles.sideBtn, locked && styles.dimmed]}
          tone="dark"
          opacity={SCRIM}
          accessibilityRole="button"
          accessibilityLabel="Switch camera"
        >
          <IconCameraFlip size={24} color="#FFFFFF" />
        </GlassIconButton>
      </View>

      {/* What this take will actually be, in one line. The limit is in played
          time, so at anything but 1× it disagrees with the clock — which is
          exactly the thing a creator needs told before they press record
          rather than after. */}
      {!locked && (draft.speedPercent !== 100 || draft.limitMs !== null) && (
        <GlassSurface
          style={[styles.budget, { bottom: insets.bottom + 104 }]}
          tone="dark"
          opacity={0.5}
        >
          <Text style={styles.budgetText} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
            {draft.speedPercent === 100
              ? `Up to ${Math.round(Math.min(draft.limitMs ?? MAX_SWIFT_MS, MAX_SWIFT_MS) / 1000)}s`
              : `Film ${Math.round(limit / 1000)}s → plays ${
                Math.round(Math.min(draft.limitMs ?? MAX_SWIFT_MS, MAX_SWIFT_MS) / 1000)}s`}
          </Text>
        </GlassSurface>
      )}
    </View>
  );
}

/** One button on the vertical tool rail. */
function RailButton({
  children, label, badge, active, onPress,
}: {
  children: React.ReactNode;
  label: string;
  badge: string | null;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={styles.railBtn}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <GlassSurface
        style={[styles.railIcon, active && styles.railIconOn]}
        tone="dark"
        opacity={SCRIM}
      >
        {children}
      </GlassSurface>
      <Text style={styles.railLabel} maxFontSizeMultiplier={MAX_SCALE_FIXED} numberOfLines={1}>
        {badge ?? label}
      </Text>
    </Pressable>
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

  rail: {
    position: 'absolute',
    right: 12,
    alignItems: 'center',
    gap: 14,
  },
  railBtn: { alignItems: 'center', gap: 3, width: 54 },
  railIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railIconOn: { borderWidth: 1.5, borderColor: '#FFFFFF' },
  railLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.micro,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

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
    right: 78,
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

  countdown: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownNumber: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 120,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 18,
  },

  trayWrap: { position: 'absolute', left: 16, right: 16 },

  budget: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 13,
  },
  budgetText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.micro,
    color: '#FFFFFF',
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
