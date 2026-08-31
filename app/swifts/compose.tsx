import { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CaptureStep } from '@/components/swifts/compose/CaptureStep';
import { DetailsStep } from '@/components/swifts/compose/DetailsStep';
import { EditStep } from '@/components/swifts/compose/EditStep';
import { PreviewStep } from '@/components/swifts/compose/PreviewStep';
import type { CapturedVideo } from '@/components/swifts/compose/CaptureStep';
import { IconBack, IconClose } from '@/components/ui/icons';
import { fonts, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  EMPTY_DRAFT,
  MAX_SWIFT_MS,
  validateDraft,
  type SwiftDraft,
} from '@/services/swiftDraft';
import {
  UploadCancelled,
  discardTempFile,
  publishSwift,
  type UploadProgress,
} from '@/services/swiftUpload';

/**
 * Making a Swift, start to finish.
 *
 * **One route with an internal step machine**, not four routes. Backing out
 * of the editor has to land back on capture with nothing lost, and a
 * navigation stack would either lose that state or need a global store to
 * carry it. A `useState` in one component is the whole mechanism, and `draft`
 * is the only thing that has to survive a step change.
 *
 * The compositing decision is documented on the backend, in `swifts/media.py`:
 * nothing here re-encodes, and — since the R2 migration retired the
 * Cloudinary pipeline that used to render a trim/volume/text composite from
 * uploaded parameters — nothing on the server does either. The editor's
 * parameters are applied by the player, both here and in the feed, and the
 * publish step is one multipart POST of the untouched recording plus those
 * parameters. See `services/swiftUpload`.
 */

type Step = 'capture' | 'edit' | 'details' | 'preview';

const ORDER: Step[] = ['capture', 'edit', 'details', 'preview'];

const TITLES: Record<Step, string> = {
  capture: 'New Swift',
  edit: 'Edit',
  details: 'Details',
  preview: 'Preview',
};

export default function SwiftComposerScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('capture');
  const [draft, setDraft] = useState<SwiftDraft>(EMPTY_DRAFT);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // The recording currently on disk. Deleted once it has been published or
  // deliberately discarded, so a creator who records six takes is not left
  // with six full-size videos in the app's cache.
  const tempUriRef = useRef<string | null>(null);

  // An upload that outlives its screen is the user's mobile data being spent
  // on a Swift nobody is waiting for any more. Discard and Cancel already
  // abort; this covers every other way the composer can go — a deep link
  // elsewhere, a router replace, a parent unmounting it — none of which run
  // either of those handlers.
  //
  // Empty deps on purpose: this must fire on unmount and never in between,
  // and the ref it reads is current by construction.
  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = (next: Partial<SwiftDraft>) =>
    setDraft((prev) => ({ ...prev, ...next }));

  // ── Navigation between steps ───────────────────────────────────────────────
  function goBack() {
    if (progress && progress.stage !== 'error') return; // mid-upload; use Cancel
    const index = ORDER.indexOf(step);
    if (index <= 0) {
      confirmExit();
      return;
    }
    // Backing out of the editor means discarding the take, which is worth a
    // confirmation — it is the one back press that destroys something.
    if (step === 'edit') {
      Alert.alert('Discard this take?', 'Your recording will be deleted.', [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            discardTempFile(tempUriRef.current);
            tempUriRef.current = null;
            setDraft(EMPTY_DRAFT);
            setStep('capture');
          },
        },
      ]);
      return;
    }
    setStep(ORDER[index - 1]);
  }

  function confirmExit() {
    if (!draft.uri) {
      router.back();
      return;
    }
    Alert.alert('Discard this Swift?', 'Nothing will be saved.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          abortRef.current?.abort();
          discardTempFile(tempUriRef.current);
          router.back();
        },
      },
    ]);
  }

  // Android's hardware back has to mean "previous step", not "leave the
  // composer" — otherwise one press throws away a recording and four screens
  // of adjustments.
  useFocusEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack();
      return true;
    });
    return () => sub.remove();
  });

  function handleCaptured(video: CapturedVideo) {
    // A previous take being replaced is a file nobody will ever want again.
    if (tempUriRef.current && tempUriRef.current !== video.uri) {
      discardTempFile(tempUriRef.current);
    }
    tempUriRef.current = video.source === 'camera' ? video.uri : null;

    setDraft({
      ...EMPTY_DRAFT,
      uri: video.uri,
      source: video.source,
      durationMs: video.durationMs,
      width: video.width,
      height: video.height,
      // An import longer than the ceiling opens pre-trimmed to the limit
      // rather than being refused — the creator chooses which 60 seconds.
      trimEndMs: video.durationMs > MAX_SWIFT_MS ? MAX_SWIFT_MS : null,
    });
    setStep('edit');
  }

  function next() {
    const index = ORDER.indexOf(step);
    if (index < ORDER.length - 1) setStep(ORDER[index + 1]);
  }

  // ── Publishing ─────────────────────────────────────────────────────────────
  async function handlePublish() {
    const problems = validateDraft(draft);
    if (problems.length > 0) {
      setError(problems[0].message);
      return;
    }
    if (!draft.uri) return;

    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const published = await publishSwift(draft, {
        signal: controller.signal,
        onProgress: setProgress,
      });

      setProgress({ stage: 'done', ratio: 1, attempt: 1 });
      // The recording has served its purpose; R2 has the copy that matters.
      discardTempFile(tempUriRef.current);
      tempUriRef.current = null;

      // Not the main feed: the ranked feed excludes the viewer's own Swifts
      // (recs/candidates.py — same rule every For You feed follows), so
      // landing there right after publishing would show everything *except*
      // what was just posted. The permalink is the one place that can.
      router.replace({ pathname: '/swifts/[id]', params: { id: published.id } });
    } catch (e: any) {
      if (e instanceof UploadCancelled) {
        setProgress(null);
        return;
      }
      setProgress({ stage: 'error', ratio: 0, attempt: 1 });
      // `.message` on an `UploadError` is already the user-facing wording;
      // `.detail` is the raw server reason, logged rather than shown — see
      // services/swiftUpload.
      setError(e?.message ?? 'Could not publish that Swift.');
    } finally {
      abortRef.current = null;
    }
  }

  function cancelUpload() {
    abortRef.current?.abort();
    setProgress(null);
  }

  // ── Chrome ─────────────────────────────────────────────────────────────────
  // The capture step draws its own full-bleed chrome over the camera.
  if (step === 'capture') {
    return (
      <View style={styles.root}>
        <CaptureStep onCaptured={handleCaptured} onCancel={confirmExit} />
      </View>
    );
  }

  const index = ORDER.indexOf(step);
  const canAdvance = step !== 'preview';
  const blockingProblem = step === 'edit'
    ? validateDraft(draft).find((p) => p.field === 'trim')
    : undefined;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <IconBack size={22} color={colors.t1} />
        </Pressable>

        <View style={styles.headerCentre}>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
            {TITLES[step]}
          </Text>
          <Text style={styles.headerStep} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
            Step {index} of {ORDER.length - 1}
          </Text>
        </View>

        {canAdvance ? (
          <Pressable
            onPress={next}
            disabled={!!blockingProblem}
            hitSlop={12}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Next step"
          >
            <Text
              style={[styles.headerAction, !!blockingProblem && styles.headerActionOff]}
              maxFontSizeMultiplier={MAX_SCALE_FIXED}
            >
              Next
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={confirmExit}
            hitSlop={12}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Discard"
          >
            <IconClose size={20} color={colors.t2} />
          </Pressable>
        )}
      </View>

      {step === 'edit' && (
        <EditStep
          draft={draft}
          onChange={patch}
          onMeasured={({ durationMs }) =>
            setDraft((prev) => ({
              ...prev,
              durationMs: prev.durationMs || durationMs,
              trimEndMs:
                prev.trimEndMs
                ?? (durationMs > MAX_SWIFT_MS ? MAX_SWIFT_MS : null),
            }))
          }
        />
      )}
      {step === 'details' && <DetailsStep draft={draft} onChange={patch} />}
      {step === 'preview' && (
        <PreviewStep
          draft={draft}
          progress={progress}
          error={error}
          onPublish={handlePublish}
          onCancelUpload={cancelUpload}
          onRetry={() => {
            setError(null);
            setProgress(null);
            handlePublish();
          }}
        />
      )}

      {blockingProblem && (
        <View style={styles.blocker}>
          <Text style={styles.blockerText}>{blockingProblem.message}</Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerBtn: { minWidth: 56, paddingVertical: 4 },
  headerCentre: { flex: 1, alignItems: 'center', gap: 1 },
  headerTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },
  headerStep: {
    fontFamily: fonts.body,
    fontSize: typography.micro,
    color: colors.t3,
  },
  headerAction: {
    textAlign: 'right',
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.teal,
  },
  headerActionOff: { color: colors.t3 },

  blocker: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.red,
  },
  blockerText: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
