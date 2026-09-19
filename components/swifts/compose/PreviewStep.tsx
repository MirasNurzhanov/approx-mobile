import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

import { SwiftStage } from '@/components/swifts/SwiftStage';
import {
  IconAt, IconGlobe, IconHash, IconLock, IconMusic, IconPeople, IconPin, IconSend,
  IconSparkle, IconSticker,
} from '@/components/ui/icons';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { useMusicBed } from '@/hooks/useMusicBed';
import { effectFor } from '@/constants/swiftEffects';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  effectiveHashtags,
  effectiveMentions,
  keptDurationMs,
  playedMs,
  type SwiftDraft,
} from '@/services/swiftDraft';
import type { UploadProgress } from '@/services/swiftUpload';

/**
 * The last look before publishing, and the upload's progress once it starts.
 *
 * The preview is honest about what it is, and — since the R2 migration — that
 * is now "the whole thing": trim, speed, rotation and volume are applied
 * locally, the bed plays alongside, and the effect, text and stickers are
 * drawn by the very component the feed uses (`SwiftStage`). Nothing here is
 * composited server-side any more for this to diverge from.
 *
 * The facts row underneath is the other half of the job. A creator has by this
 * point made a dozen choices across three screens, and this is the last place
 * to notice that one of them is not what they meant — so every choice that is
 * *not* the default gets a chip, and the ones that are default get none.
 */

interface Props {
  draft: SwiftDraft;
  progress: UploadProgress | null;
  error: string | null;
  onPublish: () => void;
  onCancelUpload: () => void;
  onRetry: () => void;
}

const TIME_UPDATE_S = 0.05;

const AUDIENCE_LABEL = {
  public: { label: 'Everyone', Glyph: IconGlobe },
  friends: { label: 'Friends', Glyph: IconPeople },
  private: { label: 'Only me', Glyph: IconLock },
} as const;

export function PreviewStep({
  draft,
  progress,
  error,
  onPublish,
  onCancelUpload,
  onRetry,
}: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  const player = useVideoPlayer(draft.uri ?? '', (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = TIME_UPDATE_S;
  });

  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    bufferedPosition: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
  });

  const trimEnd = draft.trimEndMs ?? draft.durationMs;
  const seeking = useRef(false);

  // Zero whenever the mic was off: there is nothing in the file to turn up,
  // and a slider reading 100 over a silent take would be a lie at the last
  // moment a creator can act on it.
  useEffect(() => {
    player.volume = draft.micEnabled ? draft.originalVolume / 100 : 0;
  }, [draft.originalVolume, draft.micEnabled, player]);

  useEffect(() => {
    player.playbackRate = draft.speedPercent / 100;
  }, [draft.speedPercent, player]);

  useEffect(() => {
    if (seeking.current) return;
    const nowMs = currentTime * 1000;
    if (nowMs >= trimEnd - 40 || nowMs < draft.trimStartMs - 40) {
      seeking.current = true;
      player.currentTime = draft.trimStartMs / 1000;
      setTimeout(() => { seeking.current = false; }, 120);
    }
  }, [currentTime, trimEnd, draft.trimStartMs, player]);

  useEffect(() => {
    player.play();
  }, [player]);

  const uploading = progress !== null && progress.stage !== 'done' && progress.stage !== 'error';

  // The bed, in step with the picture — the same arrangement the editor and
  // the feed use, so this preview sounds like the published Swift too. Silent
  // during the upload: a track still playing under a progress bar reads as the
  // app having ignored the button.
  useMusicBed({
    track: draft.track,
    volume: draft.musicVolume,
    startMs: draft.musicStartMs,
    positionMs: playedMs(
      Math.max(0, currentTime * 1000 - draft.trimStartMs), draft.speedPercent,
    ),
    playing: !uploading,
  });
  const audience = AUDIENCE_LABEL[draft.visibility];
  const seconds = (keptDurationMs(draft) / 1000).toFixed(1);
  // What will actually publish: the caption's tags merged with the field's,
  // which is what `swifts.tagging` will store. See `services/swiftDraft`.
  const tags = effectiveHashtags(draft);
  const handles = effectiveMentions(draft);

  return (
    <View style={styles.root}>
      <View
        style={styles.stage}
        onLayout={(e) => setStage({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        })}
      >
        <VideoView
          style={[
            StyleSheet.absoluteFill,
            draft.rotationDeg !== 0 && {
              transform: [{ rotate: `${draft.rotationDeg}deg` }],
            },
            (draft.rotationDeg === 90 || draft.rotationDeg === 270) && stage.width > 0 && {
              width: stage.height,
              height: stage.width,
              left: (stage.width - stage.height) / 2,
              top: (stage.height - stage.width) / 2,
            },
          ]}
          player={player}
          contentFit="contain"
          nativeControls={false}
        />
        <SwiftStage
          size={stage}
          effect={draft.effect}
          effectIntensity={draft.effectIntensity}
          stickers={draft.stickers}
          overlayText={draft.overlayText}
          overlayPosition={draft.overlayPosition}
        />
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelInner}>
        {draft.caption.trim() ? (
          <Text style={styles.caption}>{draft.caption.trim()}</Text>
        ) : (
          <Text style={styles.captionEmpty}>No caption</Text>
        )}

        {/* Every non-default choice, as a chip. See the component note: this
            is the last screen on which a mistake three steps back is still
            cheap to fix. */}
        <View style={styles.facts}>
          <GlassSurface style={styles.fact} tone="surface2">
            <audience.Glyph size={16} color={colors.t3} />
            <Text style={styles.factText}>{audience.label}</Text>
          </GlassSurface>
          <GlassSurface style={styles.fact} tone="surface2">
            <Text style={styles.factText}>{seconds}s</Text>
          </GlassSurface>
          {draft.speedPercent !== 100 && (
            <GlassSurface style={styles.fact} tone="surface2">
              <Text style={styles.factText}>{draft.speedPercent / 100}× speed</Text>
            </GlassSurface>
          )}
          {draft.rotationDeg !== 0 && (
            <GlassSurface style={styles.fact} tone="surface2">
              <Text style={styles.factText}>Rotated {draft.rotationDeg}°</Text>
            </GlassSurface>
          )}
          {draft.effect !== '' && (
            <GlassSurface style={styles.fact} tone="surface2">
              <IconSparkle size={16} color={colors.t3} />
              <Text style={styles.factText}>{effectFor(draft.effect).label}</Text>
            </GlassSurface>
          )}
          {draft.track && (
            <GlassSurface style={styles.fact} tone="surface2">
              <IconMusic size={16} color={colors.t3} />
              <Text style={styles.factText} numberOfLines={1}>
                {draft.track.title}
              </Text>
            </GlassSurface>
          )}
          {draft.stickers.length > 0 && (
            <GlassSurface style={styles.fact} tone="surface2">
              <IconSticker size={16} color={colors.t3} />
              <Text style={styles.factText}>{draft.stickers.length}</Text>
            </GlassSurface>
          )}
          {tags.length > 0 && (
            <GlassSurface style={styles.fact} tone="surface2">
              <IconHash size={16} color={colors.t3} />
              <Text style={styles.factText} numberOfLines={1}>
                {tags.length}
              </Text>
            </GlassSurface>
          )}
          {handles.length > 0 && (
            <GlassSurface style={styles.fact} tone="surface2">
              <IconAt size={16} color={colors.t3} />
              <Text style={styles.factText} numberOfLines={1}>
                {handles.length}
              </Text>
            </GlassSurface>
          )}
          {draft.sendTo.length > 0 && (
            <GlassSurface style={styles.fact} tone="surface2">
              <IconSend size={16} color={colors.teal} />
              <Text style={[styles.factText, { color: colors.teal }]}>
                {draft.sendTo.length}
              </Text>
            </GlassSurface>
          )}
          {draft.shareLocation ? (
            <GlassSurface style={styles.fact} tone="surface2">
              <IconPin size={16} color={colors.teal} />
              <Text style={[styles.factText, { color: colors.teal }]} numberOfLines={1}>
                {draft.placeName || 'Location attached'}
              </Text>
            </GlassSurface>
          ) : null}
        </View>

        {/* The tags spelled out, not just counted — a wrong one is only
            findable if it is readable. */}
        {(tags.length > 0 || handles.length > 0) && (
          <Text style={styles.tagLine}>
            {[...tags.map((t) => `#${t}`), ...handles.map((h) => `@${h}`)].join('  ')}
          </Text>
        )}

        {draft.sendTo.length > 0 && (
          <Text style={styles.note}>
            Sending privately to {draft.sendTo.length}{' '}
            {draft.sendTo.length === 1 ? 'person' : 'people'} once it publishes.
          </Text>
        )}

        {draft.shareLocation && (
          <Text style={styles.privacyNote}>
            Nobody sees this place in the feed. They get a button, and you can
            see who pressed it.
          </Text>
        )}
      </ScrollView>

      {/* Publish / progress. The bar is chrome and takes the glass; the teal
          button inside it deliberately does not — it is the primary action on
          the screen, and a translucent primary action stops reading as one. */}
      <GlassSurface style={styles.footer} opacity={0.86}>
        {error ? (
          <>
            <Text style={styles.error}>{error}</Text>
            <Pressable style={styles.publish} onPress={onRetry} accessibilityRole="button">
              <Text style={styles.publishLabel}>Try again</Text>
            </Pressable>
          </>
        ) : uploading ? (
          <>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  { width: `${Math.round((progress?.ratio ?? 0) * 100)}%` },
                ]}
              />
            </View>
            <View style={styles.progressRow}>
              <Text style={styles.progressText} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
                {progress?.stage === 'uploading' &&
                  `Uploading ${Math.round((progress?.ratio ?? 0) * 100)}%` +
                  (progress.attempt > 1 ? ` · retry ${progress.attempt}` : '')}
              </Text>
              <Pressable onPress={onCancelUpload} hitSlop={10} accessibilityRole="button">
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable style={styles.publish} onPress={onPublish} accessibilityRole="button">
            <Text style={styles.publishLabel}>Publish Swift</Text>
          </Pressable>
        )}
      </GlassSurface>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  stage: { flex: 1, minHeight: 220, backgroundColor: '#000000', overflow: 'hidden' },

  panel: { maxHeight: 220 },
  panelInner: { padding: 18, gap: 12 },
  caption: {
    fontFamily: fonts.body,
    fontSize: typography.body,
    lineHeight: 21,
    color: colors.t1,
  },
  captionEmpty: {
    fontFamily: fonts.body,
    fontSize: typography.body,
    color: colors.t3,
    fontStyle: 'italic',
  },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // No `backgroundColor` here or on `footer`: the fill is drawn behind their
  // content by `GlassBackdrop`, and a background would sit on top of the blur.
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    maxWidth: '100%',
  },
  factText: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    color: colors.t2,
    flexShrink: 1,
  },
  note: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.t3,
  },
  tagLine: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.teal,
  },
  privacyNote: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.teal,
  },

  footer: {
    padding: 18,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  publish: {
    height: 50,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.teal,
  },
  publishLabel: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: typography.body,
    color: colors.bg,
  },

  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: colors.teal },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressText: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    color: colors.t2,
    fontVariant: ['tabular-nums'],
  },
  cancel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.red,
  },
  error: { fontFamily: fonts.body, fontSize: typography.small, color: colors.red },
});
