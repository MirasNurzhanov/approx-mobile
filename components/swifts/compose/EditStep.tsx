import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

import { TrimSlider } from '@/components/TrimSlider';
import { VolumeSlider } from '@/components/swifts/compose/VolumeSlider';
import {
  IconScissors, IconText, IconVolume,
} from '@/components/ui/icons';
import { GlassIconButton, GlassSurface } from '@/components/ui/GlassSurface';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  MAX_OVERLAY,
  MAX_SWIFT_MS,
  MIN_SWIFT_MS,
  type SwiftDraft,
} from '@/services/swiftDraft';

/**
 * The editor.
 *
 * Every control here writes a *parameter* on the draft; nothing re-encodes,
 * and nothing on the server does either any more — see `services/swiftDraft`.
 * The preview above applies what it can locally — it seeks within the trim,
 * loops the kept range, and sets the player's volume — and the feed applies
 * the same three things at watch time, so what you see here is exactly what a
 * viewer sees, with one honest exception: the text overlay is a React view
 * sitting over the video in both places rather than pixels inside it, since
 * nothing composites it into the file either.
 *
 * The looping is the fiddly part and it is done here rather than with the
 * player's own `loop`: `expo-video` loops the whole asset, and the kept range
 * is usually a slice of it, so the loop has to be driven from the time
 * updates.
 */

type Tab = 'trim' | 'sound' | 'text';

interface Props {
  draft: SwiftDraft;
  onChange: (patch: Partial<SwiftDraft>) => void;
  /** Fired once the player has measured the source, so the composer can store
   *  a duration the camera did not report. */
  onMeasured: (info: { durationMs: number; width: number; height: number }) => void;
}

const TIME_UPDATE_S = 0.05;

function formatMs(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  return `${total.toFixed(1)}s`;
}

export function EditStep({ draft, onChange, onMeasured }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = useState<Tab>('trim');

  const player = useVideoPlayer(draft.uri ?? '', (p) => {
    p.loop = false;
    p.muted = false;
    p.timeUpdateEventInterval = TIME_UPDATE_S;
  });

  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    bufferedPosition: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
  });

  const trimEnd = draft.trimEndMs ?? draft.durationMs;

  // The source's real duration and dimensions, which the camera does not
  // report. Taken from the player's own `sourceLoad`, which fires once when
  // the asset is ready and carries both.
  //
  // An effect watching `player.duration` would be the obvious alternative and
  // is worse in two ways: it needs a `setState` inside the effect to fire only
  // once, and it re-reads a value that is not React state, so it runs on every
  // time update until the guard latches.
  useEventListener(player, 'sourceLoad', ({ duration, availableVideoTracks }) => {
    const track = availableVideoTracks?.[0];
    onMeasured({
      durationMs: Math.round((duration ?? 0) * 1000),
      width: track?.size?.width ?? draft.width,
      height: track?.size?.height ?? draft.height,
    });
  });

  // The original track's volume, previewed live.
  useEffect(() => {
    player.volume = draft.originalVolume / 100;
  }, [draft.originalVolume, player]);

  // Loop the kept range. `currentTime` is seconds; the draft is milliseconds.
  const seeking = useRef(false);
  useEffect(() => {
    if (draft.durationMs <= 0 || seeking.current) return;
    const nowMs = currentTime * 1000;
    if (nowMs >= trimEnd - 40 || nowMs < draft.trimStartMs - 40) {
      seeking.current = true;
      player.currentTime = draft.trimStartMs / 1000;
      // A short guard: the seek itself produces a time update, and reacting to
      // that one would seek again forever.
      setTimeout(() => { seeking.current = false; }, 120);
    }
  }, [currentTime, draft.durationMs, trimEnd, draft.trimStartMs, player]);

  useEffect(() => {
    player.play();
  }, [player]);

  const positionMs = currentTime * 1000;
  const kept = trimEnd - draft.trimStartMs;

  function scrubTo(ms: number) {
    seeking.current = true;
    player.currentTime = ms / 1000;
    setTimeout(() => { seeking.current = false; }, 120);
  }

  return (
    <View style={styles.root}>
      {/* Preview */}
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
            <Text style={styles.overlayText} numberOfLines={2}>
              {draft.overlayText}
            </Text>
          </View>
        )}
        <GlassSurface style={styles.stageBadge} tone="dark" opacity={0.5}>
          <Text style={styles.stageBadgeText} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
            {formatMs(kept)}
          </Text>
        </GlassSurface>
      </View>

      {/* Tabs */}
      <GlassSurface style={styles.tabs}>
        {([
          ['trim', 'Trim', IconScissors],
          ['sound', 'Sound', IconVolume],
          ['text', 'Text', IconText],
        ] as const).map(([key, label, Glyph]) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[styles.tab, active && styles.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Glyph size={18} color={active ? colors.teal : colors.t3} />
              <Text
                style={[styles.tabLabel, active && styles.tabLabelActive]}
                maxFontSizeMultiplier={MAX_SCALE_FIXED}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </GlassSurface>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelInner}>
        {tab === 'trim' && (
          <View style={styles.section}>
            <Text style={styles.sectionHint}>
              Drag the handles to choose the part that becomes your Swift.
            </Text>
            {draft.durationMs > 0 ? (
              <TrimSlider
                duration={draft.durationMs}
                startMs={draft.trimStartMs}
                endMs={trimEnd}
                minLengthMs={MIN_SWIFT_MS}
                positionMs={positionMs}
                format={formatMs}
                onChange={(start, end) => onChange({ trimStartMs: start, trimEndMs: end })}
                onCommit={(start, end) => {
                  onChange({ trimStartMs: start, trimEndMs: end });
                  scrubTo(start);
                }}
              />
            ) : (
              <Text style={styles.sectionHint}>Measuring…</Text>
            )}
            {kept > MAX_SWIFT_MS && (
              <Text style={styles.warn}>
                A Swift can be at most 60 seconds — trim it down to continue.
              </Text>
            )}
          </View>
        )}

        {tab === 'sound' && (
          <View style={styles.section}>
            <VolumeSlider
              label="Original sound"
              value={draft.originalVolume}
              onChange={(v) => onChange({ originalVolume: v })}
            />
            <Text style={styles.sectionHint}>
              {draft.originalVolume === 0
                ? 'The video publishes silent.'
                : 'The sound recorded with the video.'}
            </Text>
          </View>
        )}

        {tab === 'text' && (
          <View style={styles.section}>
            <TextInput
              style={styles.input}
              value={draft.overlayText}
              onChangeText={(t) => onChange({ overlayText: t.slice(0, MAX_OVERLAY) })}
              placeholder="Add a line of text"
              placeholderTextColor={colors.t3}
              maxLength={MAX_OVERLAY}
              accessibilityLabel="Text overlay"
            />
            <View style={styles.positionRow}>
              {(['top', 'middle', 'bottom'] as const).map((position) => {
                const active = draft.overlayPosition === position;
                return (
                  <GlassIconButton
                    key={position}
                    onPress={() => onChange({ overlayPosition: position })}
                    style={[styles.posBtn, active && styles.posBtnActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.posLabel, active && styles.posLabelActive]}>
                      {position[0].toUpperCase() + position.slice(1)}
                    </Text>
                  </GlassIconButton>
                );
              })}
            </View>
            <Text style={styles.sectionHint}>
              One line, drawn over the video — here and wherever it plays.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  stage: {
    flex: 1,
    backgroundColor: '#000000',
    minHeight: 240,
  },
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
  stageBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  stageBadgeText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },

  tabs: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 10 },
  tabActive: { backgroundColor: colors.tealTint },
  tabLabel: {
    fontFamily: fonts.body,
    fontSize: typography.micro,
    color: colors.t3,
  },
  tabLabelActive: { color: colors.teal, fontWeight: '600' },

  panel: { maxHeight: 260 },
  panelInner: { padding: 18 },
  section: { gap: 12 },
  sectionHint: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    lineHeight: 19,
    color: colors.t3,
  },
  warn: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    color: colors.red,
  },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: typography.body,
    color: colors.t1,
  },
  positionRow: { flexDirection: 'row', gap: 8 },
  posBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.border,
  },
  posBtnActive: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  posLabel: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    color: colors.t2,
  },
  posLabelActive: { color: colors.teal, fontWeight: '600' },
});
