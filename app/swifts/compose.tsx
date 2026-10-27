import { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CaptureStep } from '@/components/swifts/compose/CaptureStep';
import { DetailsStep } from '@/components/swifts/compose/DetailsStep';
import { EditStep } from '@/components/swifts/compose/EditStep';
import { MusicPickerSheet } from '@/components/swifts/compose/MusicPickerSheet';
import { PreviewStep } from '@/components/swifts/compose/PreviewStep';
import { SendToFriendsSheet } from '@/components/swifts/SendToFriendsSheet';
import type { CapturedVideo } from '@/components/swifts/compose/CaptureStep';
import { IconBack, IconClose } from '@/components/ui/icons';
import { fonts, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  EMPTY_DRAFT,
  createTakeKey,
  keptDurationMs,
  MAX_SWIFT_MS,
  recordedMs,
  validateDraft,
  type SwiftDraft,
  type SwiftTrackChoice,
} from '@/services/swiftDraft';
import { sendSwiftTo, SWIFT_MUSIC_ENABLED } from '@/services/swiftComposer';
import {
  UploadCancelled,
  discardTempFile,
  publishSwift,
  type UploadProgress,
} from '@/services/swiftUpload';
import { MAX_PINS, pinSwiftLocation } from '@/services/pinnedPlaces';
import { venuesApi } from '@/services/venues';

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

/** The venue a composer was opened from, as the draft and the pin need it. */
interface VenuePlace {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}

/** The draft fields that attach a venue as the Swift's place. */
function venueLocation(venue: VenuePlace | null): Partial<SwiftDraft> {
  if (!venue) return {};
  return {
    shareLocation: true,
    latitude: venue.latitude,
    longitude: venue.longitude,
    placeName: venue.name,
  };
}

export default function SwiftComposerScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('capture');
  const [draft, setDraft] = useState<SwiftDraft>(EMPTY_DRAFT);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Both sheets are owned here rather than by the step that opens them: the
  // music picker is reachable from capture *and* from the editor, and hoisting
  // it means one instance and one piece of state rather than two that can
  // disagree about what is attached.
  const [pickingMusic, setPickingMusic] = useState(false);
  const [pickingRecipients, setPickingRecipients] = useState(false);

  // Started from a venue's card on the map (`venueSwiftRoute`). The id is all
  // the route carries; where that venue *is* comes from the server below, so a
  // coordinate cannot be edited into a published Swift through navigation
  // state.
  const { venueId: venueParam } = useLocalSearchParams<{ venueId?: string }>();
  const venueId = Number(venueParam);
  /** The venue this composer was opened from, once the server has placed it. */
  const venueRef = useRef<VenuePlace | null>(null);
  const venueAsked = useRef(false);

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

  // A Swift made at a venue arrives with that venue as its place, so the
  // creator does not have to find on a map the café they are standing in. It
  // is still only a default: Details can change or remove it like any other
  // location, and nothing is pinned unless it survives to publication.
  useEffect(() => {
    if (!Number.isInteger(venueId) || venueId < 1 || venueAsked.current) return;
    venueAsked.current = true;
    let alive = true;
    venuesApi.get(venueId).then(({ data }) => {
      if (!alive || !Number.isFinite(data?.latitude) || !Number.isFinite(data?.longitude)) return;
      venueRef.current = {
        id: data.id, name: data.name, latitude: data.latitude, longitude: data.longitude,
      };
      patch(venueLocation(venueRef.current));
    }).catch(() => {
      // The composer works without it; the creator can still add a location.
    });
    return () => { alive = false; };
    // Once per venue id: `venueAsked` makes a re-run a no-op anyway.
  }, [venueId]);

  // ── Navigation between steps ───────────────────────────────────────────────

  // Declared above `goBack`, which calls it. React Compiler cannot rewrite a
  // reference to a function hoisted from further down the component
  // ([PruneHoistedContexts]) and bails on the whole screen when it finds one.
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

  function goBack() {
    if (abortRef.current || (progress && progress.stage !== 'error')) return;
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

    // The limit in *source* milliseconds: at 2× the ceiling is two minutes of
    // video, because two minutes is what becomes sixty seconds. A creator's
    // own "stop after" choice does not apply to an import — they are choosing
    // which part of an existing video to keep, and the trim handles are that
    // choice.
    const sourceCeiling = recordedMs(MAX_SWIFT_MS, draft.speedPercent);

    setDraft((prev) => ({
      ...EMPTY_DRAFT,
      // A new take is a new draft, but it is still the Swift this venue's card
      // opened the composer for.
      ...venueLocation(venueRef.current),
      // …and it was filmed under these, so they survive. Retaking a shot and
      // finding the speed, effect and track you chose have been reset is the
      // kind of thing that makes somebody stop retaking shots.
      speedPercent: prev.speedPercent,
      rotationDeg: prev.rotationDeg,
      effect: prev.effect,
      effectIntensity: prev.effectIntensity,
      micEnabled: prev.micEnabled,
      countdownS: prev.countdownS,
      limitMs: prev.limitMs,
      track: prev.track,
      musicVolume: prev.musicVolume,
      musicStartMs: prev.musicStartMs,
      idempotencyKey: createTakeKey(),
      uri: video.uri,
      source: video.source,
      durationMs: video.durationMs,
      width: video.width,
      height: video.height,
      // An import longer than the ceiling opens pre-trimmed to the limit
      // rather than being refused — the creator chooses which 60 seconds.
      trimEndMs: video.durationMs > sourceCeiling ? sourceCeiling : null,
    }));
    setStep('edit');
  }

  function next() {
    const index = ORDER.indexOf(step);
    if (index < ORDER.length - 1) setStep(ORDER[index + 1]);
  }

  // ── Publishing ─────────────────────────────────────────────────────────────
  /**
   * Put the venue on the creator's own map, now that a Swift exists there.
   *
   * Only if the place that published is still the venue's: somebody who
   * changed or removed the location in Details gets no pin, because a pin
   * would then name a place the Swift was not made at. Failures are swallowed
   * deliberately — the Swift is already published, and a pin that did not save
   * is not a reason to show a publishing error — except a full map, which is a
   * decision only the creator can make.
   */
  async function pinVenue(swiftId: number) {
    const venue = venueRef.current;
    if (!venue) return;
    if (!draft.shareLocation) return;
    if (draft.latitude !== venue.latitude || draft.longitude !== venue.longitude) return;

    const result = await pinSwiftLocation({
      swiftId,
      latitude: venue.latitude,
      longitude: venue.longitude,
      placeName: venue.name,
      precision: 'exact',
    }).catch(() => null);

    if (result && !result.ok && result.reason === 'limit') {
      Alert.alert(
        'Your map is full',
        `You can keep ${MAX_PINS} pinned places. Remove one to pin ${venue.name}.`,
      );
    }
  }

  /**
   * Deliver the Swift to the people chosen in the editor.
   *
   * After publishing, because a send needs a Swift that exists — there is no
   * id to forward until the 201 comes back.
   *
   * Failures are reported but never turned into a publishing error, for the
   * same reason `pinVenue` swallows its own: the Swift is up, and telling
   * somebody their post failed because a message did not go is both false and
   * the wrong thing to act on. A refusal per person is the ordinary case
   * — somebody may have blocked them since the sheet loaded, or may not be
   * allowed to watch this particular Swift — so it is said plainly and once.
   */
  async function sendQueued(swiftId: number) {
    if (draft.sendTo.length === 0) return;
    const result = await sendSwiftTo(swiftId, draft.sendTo).catch(() => null);
    if (result === null) {
      Alert.alert(
        'Swift published',
        'It is up, but we could not send it to anyone just now. You can share it from the Swift itself.',
      );
      return;
    }
    if (result.refused.length > 0) {
      Alert.alert(
        'Sent to some people',
        `${result.sent.length} sent. ${result.refused.length} could not be — they may not be able to watch this Swift.`,
      );
    }
  }

  async function handlePublish() {
    // A ref closes the same-render double-tap window before React renders progress.
    if (abortRef.current) return;
    const problems = validateDraft(draft);
    if (problems.length > 0) {
      setError(problems[0].message);
      return;
    }
    if (!draft.uri) return;

    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ stage: 'uploading', ratio: 0, attempt: 1 });

    try {
      const published = await publishSwift(draft, {
        signal: controller.signal,
        onProgress: setProgress,
      });

      setProgress({ stage: 'done', ratio: 1, attempt: 1 });
      // The recording has served its purpose; R2 has the copy that matters.
      discardTempFile(tempUriRef.current);
      tempUriRef.current = null;

      await pinVenue(published.id);
      await sendQueued(published.id);

      // Not the main feed: the ranked feed excludes the viewer's own Swifts
      // (recs/candidates.py — same rule every For You feed follows), so
      // landing there right after publishing would show everything *except*
      // what was just posted. The permalink is the one place that can.
      router.replace({ pathname: '/swifts/[id]', params: { id: published.id } });
      return; // Keep the submission locked until navigation unmounts this screen.
    } catch (e: any) {
      if (e instanceof UploadCancelled) {
        setProgress(null);
      } else {
        setProgress({ stage: 'error', ratio: 0, attempt: 1 });
        // `.message` on an `UploadError` is already the user-facing wording;
        // `.detail` is the raw server reason, logged rather than shown — see
        // services/swiftUpload.
        setError(e?.message ?? 'Could not publish that Swift.');
      }
    }
    // Not a `finally` — React Compiler bails on any component containing one.
    // The cancelled branch is an `else` rather than an early return so that this
    // still clears on that path, which is what the `finally` was for.
    abortRef.current = null;
  }

  function cancelUpload() {
    abortRef.current?.abort();
  }

  // ── Chrome ─────────────────────────────────────────────────────────────────
  // Both sheets, rendered by whichever step is on screen. One definition
  // rather than two copies: `Modal` draws over everything regardless of where
  // it sits in the tree, so the only thing that would differ between copies is
  // which one somebody forgot to update.
  const sheets = (
    <>
      <MusicPickerSheet
        visible={SWIFT_MUSIC_ENABLED && pickingMusic}
        selected={draft.track}
        startMs={draft.musicStartMs}
        // Zero before a take exists — the picker then offers the whole track
        // and the offset is bounded again once there is a Swift to bound it.
        swiftDurationMs={draft.uri ? keptDurationMs(draft) : 0}
        onCancel={() => setPickingMusic(false)}
        onConfirm={(track: SwiftTrackChoice, startMs: number) => {
          patch({ track, musicStartMs: startMs });
          setPickingMusic(false);
        }}
        onRemove={() => {
          patch({ track: null, musicStartMs: 0 });
          setPickingMusic(false);
        }}
      />
      <SendToFriendsSheet
        visible={pickingRecipients}
        selected={draft.sendTo}
        // `queue` rather than `send`: there is no Swift to send yet. The ids
        // are held on the draft and spent once publishing returns an id — see
        // `handlePublish`.
        mode="queue"
        onCancel={() => setPickingRecipients(false)}
        onConfirm={(sendTo) => {
          patch({ sendTo });
          setPickingRecipients(false);
        }}
      />
    </>
  );

  // The capture step draws its own full-bleed chrome over the camera.
  if (step === 'capture') {
    return (
      <View style={styles.root}>
        <CaptureStep
          draft={draft}
          onChange={patch}
          onCaptured={handleCaptured}
          onCancel={confirmExit}
          onPickMusic={() => setPickingMusic(true)}
        />
        {sheets}
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
          onPickMusic={() => setPickingMusic(true)}
          onPickRecipients={() => setPickingRecipients(true)}
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
          onRetry={handlePublish}
        />
      )}

      {blockingProblem && (
        <View style={styles.blocker}>
          <Text style={styles.blockerText}>{blockingProblem.message}</Text>
        </View>
      )}

      {sheets}
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
