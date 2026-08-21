import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

import { IconGlobe, IconLock, IconMusic, IconPeople, IconPin } from '@/components/ui/icons';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { keptDurationMs, type SwiftDraft } from '@/services/swiftDraft';
import type { UploadProgress } from '@/services/swiftUpload';

/**
 * The last look before publishing, and the upload's progress once it starts.
 *
 * The preview is honest about what it is. The trim and the original volume are
 * applied locally and are exactly what the server will produce; the music and
 * the burned-in text are not — they are composited during the render, and
 * playing a second audio track here in sync with the video would drift
 * visibly within one loop. So the summary below *lists* what will be applied
 * rather than pretending the preview already shows it.
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

  useEffect(() => {
    player.volume = draft.originalVolume / 100;
  }, [draft.originalVolume, player]);

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
  const audience = AUDIENCE_LABEL[draft.visibility];
  const seconds = (keptDurationMs(draft) / 1000).toFixed(1);

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          contentFit="contain"
          nativeControls={false}
        />
        {draft.overlayText.trim().length > 0 && (
          <View
            style={[
              styles.overlayWrap,
              draft.overlayPosition === 'top' && styles.overlayTop,
              draft.overlayPosition === 'bottom' && styles.overlayBottom,
            ]}
            pointerEvents="none"
          >
            <Text style={styles.overlayText} numberOfLines={2}>{draft.overlayText}</Text>
          </View>
        )}
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelInner}>
        {draft.caption.trim() ? (
          <Text style={styles.caption}>{draft.caption.trim()}</Text>
        ) : (
          <Text style={styles.captionEmpty}>No caption</Text>
        )}

        <View style={styles.facts}>
          <View style={styles.fact}>
            <audience.Glyph size={16} color={colors.t3} />
            <Text style={styles.factText}>{audience.label}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factText}>{seconds}s</Text>
          </View>
          {draft.track ? (
            <View style={styles.fact}>
              <IconMusic size={16} color={colors.t3} />
              <Text style={styles.factText} numberOfLines={1}>
                {draft.track.title}
              </Text>
            </View>
          ) : null}
          {draft.shareLocation ? (
            <View style={styles.fact}>
              <IconPin size={16} color={colors.teal} />
              <Text style={[styles.factText, { color: colors.teal }]} numberOfLines={1}>
                {draft.placeName || 'Location attached'}
              </Text>
            </View>
          ) : null}
        </View>

        {(draft.track || draft.overlayText.trim()) && (
          <Text style={styles.note}>
            {draft.track && draft.overlayText.trim()
              ? 'Your track and text are added when the Swift publishes, so they aren’t in this preview.'
              : draft.track
                ? 'Your track is mixed in when the Swift publishes, so it isn’t in this preview.'
                : 'Your text is added when the Swift publishes, so it isn’t in this preview.'}
          </Text>
        )}

        {draft.shareLocation && (
          <Text style={styles.privacyNote}>
            Nobody sees this place in the feed. They get a button, and you can
            see who pressed it.
          </Text>
        )}
      </ScrollView>

      {/* Publish / progress */}
      <View style={styles.footer}>
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
                {progress?.stage === 'signing' && 'Preparing…'}
                {progress?.stage === 'uploading' &&
                  `Uploading ${Math.round((progress?.ratio ?? 0) * 100)}%` +
                  (progress.attempt > 1 ? ` · retry ${progress.attempt}` : '')}
                {progress?.stage === 'saving' && 'Finishing…'}
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
      </View>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  stage: { flex: 1, minHeight: 220, backgroundColor: '#000000' },
  overlayWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  overlayTop: { justifyContent: 'flex-start', paddingTop: 48 },
  overlayBottom: { justifyContent: 'flex-end', paddingBottom: 48 },
  overlayText: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 26,
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },

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
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.surface2,
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
    backgroundColor: colors.surface,
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
