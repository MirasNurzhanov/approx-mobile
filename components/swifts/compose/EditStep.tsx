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
import { SwiftStage } from '@/components/swifts/SwiftStage';
import { VolumeSlider } from '@/components/swifts/compose/VolumeSlider';
import {
  StickerDragLayer,
  StickerTray,
} from '@/components/swifts/compose/StickerEditor';
import { SWIFT_EFFECTS } from '@/constants/swiftEffects';
import {
  IconMic,
  IconMicOff,
  IconMusic,
  IconRotate,
  IconScissors,
  IconSend,
  IconSparkle,
  IconSticker,
  IconText,
  IconVolume,
} from '@/components/ui/icons';
import { GlassIconButton, GlassSurface } from '@/components/ui/GlassSurface';
import { useMusicBed } from '@/hooks/useMusicBed';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import {
  createStickerId,
  MAX_OVERLAY,
  MAX_STICKERS,
  MAX_SWIFT_MS,
  MIN_SWIFT_MS,
  playedMs,
  type SwiftDraft,
  type SwiftRotation,
} from '@/services/swiftDraft';
import { SWIFT_MUSIC_ENABLED } from '@/services/swiftComposer';

/**
 * The editor.
 *
 * Every control here writes a *parameter* on the draft; nothing re-encodes,
 * and nothing on the server does either — see `services/swiftDraft`. The
 * preview above applies what it can locally — it seeks within the trim, loops
 * the kept range, runs at the chosen speed, sets the player's volume, plays
 * the attached track alongside, and draws the effect, the text and the
 * stickers as layers — and the feed applies the same things at watch time
 * through the same `SwiftStage`, so what you see here is what a viewer sees.
 *
 * The looping is the fiddly part and it is done here rather than with the
 * player's own `loop`: `expo-video` loops the whole asset, and the kept range
 * is usually a slice of it, so the loop has to be driven from the time
 * updates. Speed makes it fiddlier — `currentTime` is always in *source*
 * seconds whatever `playbackRate` is set to, so every comparison here is in
 * source milliseconds and only the numbers shown to the creator are converted.
 */

type Tab = 'trim' | 'sound' | 'text' | 'stickers' | 'effect';

interface Props {
  draft: SwiftDraft;
  onChange: (patch: Partial<SwiftDraft>) => void;
  /** Fired once the player has measured the source, so the composer can store
   *  a duration the camera did not report. */
  onMeasured: (info: { durationMs: number; width: number; height: number }) => void;
  /** Opens the track picker; the composer owns the sheet. */
  onPickMusic: () => void;
  /** Opens the "send privately" sheet; likewise. */
  onPickRecipients: () => void;
}

const TIME_UPDATE_S = 0.05;

/** A played duration, for the creator. */
function formatMs(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  return `${total.toFixed(1)}s`;
}

export function EditStep({
  draft, onChange, onMeasured, onPickMusic, onPickRecipients,
}: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = useState<Tab>('trim');
  const [stage, setStage] = useState({ width: 0, height: 0 });

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

  // The original track's volume, previewed live. Zero whenever the mic was
  // off, because there is nothing in the file to turn up — see
  // `SwiftDraft.micEnabled`.
  useEffect(() => {
    player.volume = draft.micEnabled ? draft.originalVolume / 100 : 0;
  }, [draft.originalVolume, draft.micEnabled, player]);

  // Speed, previewed live. `playbackRate` changes what the viewer hears as
  // well as sees, which is correct: a 2× Swift's own audio is meant to be
  // sped up too.
  useEffect(() => {
    player.playbackRate = draft.speedPercent / 100;
  }, [draft.speedPercent, player]);

  // Loop the kept range. `currentTime` is seconds *of source*; the draft is
  // milliseconds of source. Speed does not enter into either.
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
  const keptSource = trimEnd - draft.trimStartMs;
  const kept = playedMs(keptSource, draft.speedPercent);

  // The bed, in step with the picture. Its position is measured from the start
  // of the kept range and in *played* time, because that is the timeline a
  // listener hears — a 2× Swift moves through its backing track at 2× too.
  useMusicBed({
    track: draft.track,
    volume: draft.musicVolume,
    startMs: draft.musicStartMs,
    positionMs: playedMs(Math.max(0, positionMs - draft.trimStartMs), draft.speedPercent),
    playing: true,
  });

  function scrubTo(ms: number) {
    seeking.current = true;
    player.currentTime = ms / 1000;
    setTimeout(() => { seeking.current = false; }, 120);
  }

  function addSticker(emoji: string) {
    if (draft.stickers.length >= MAX_STICKERS) return;
    onChange({
      stickers: [
        ...draft.stickers,
        {
          id: createStickerId(),
          emoji,
          // Placed centrally and slightly high — over the middle of the frame
          // but clear of the caption area a viewer reads at the bottom.
          x: 0.5,
          y: 0.42,
          scale: 1,
          rotation: 0,
        },
      ],
    });
  }

  function moveSticker(id: string, x: number, y: number) {
    onChange({
      stickers: draft.stickers.map((s) => (s.id === id ? { ...s, x, y } : s)),
    });
  }

  function removeSticker(id: string) {
    onChange({ stickers: draft.stickers.filter((s) => s.id !== id) });
  }

  return (
    <View style={styles.root}>
      {/* Preview */}
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
            // The rotation, previewed. A quarter turn swaps the box's axes, so
            // the view is sized to the stage's *other* dimension and centred —
            // otherwise a 90° clip renders into a portrait box and is cropped
            // to a letterbox slot the published one would not be.
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

        {/* Only while the sticker tab is open: at every other moment the
            preview should behave like the feed, where these are not touchable. */}
        {tab === 'stickers' && (
          <StickerDragLayer
            stickers={draft.stickers}
            size={stage}
            onMove={moveSticker}
            onRemove={removeSticker}
          />
        )}

        <View style={styles.stageTopRight}>
          {/* Rotation lives on the stage rather than in a tab, because the clip
              that needs it most is an *imported* one — and an import lands
              here, having passed through the capture screen's own rotate
              control in the time it takes to tap a thumbnail. A creator who
              finds their video sideways has to be able to fix it where they
              are looking at it. */}
          <Pressable
            onPress={() => onChange({
              rotationDeg: (((draft.rotationDeg + 90) % 360) as SwiftRotation),
            })}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Rotate. Currently ${draft.rotationDeg} degrees.`}
          >
            <GlassSurface
              style={[styles.stageBtn, draft.rotationDeg !== 0 && styles.stageBtnOn]}
              tone="dark"
              opacity={0.5}
            >
              <IconRotate size={16} color="#FFFFFF" />
              {draft.rotationDeg !== 0 && (
                <Text style={styles.stageBadgeText} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
                  {draft.rotationDeg}°
                </Text>
              )}
            </GlassSurface>
          </Pressable>

          <GlassSurface style={styles.stageBadge} tone="dark" opacity={0.5}>
            <Text style={styles.stageBadgeText} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
              {formatMs(kept)}
            </Text>
          </GlassSurface>
        </View>

        {/* Sending this to somebody is a decision about the Swift rather than
            about the edit, but it belongs here: the editor is where a creator
            is looking at what they made and deciding who it is for. */}
        <Pressable
          onPress={onPickRecipients}
          style={styles.sendBtn}
          accessibilityRole="button"
          accessibilityLabel={
            draft.sendTo.length > 0
              ? `Sending to ${draft.sendTo.length} people. Change.`
              : 'Send privately to friends'
          }
        >
          <GlassSurface style={styles.sendInner} tone="dark" opacity={0.5}>
            <IconSend size={16} color="#FFFFFF" />
            <Text style={styles.sendText} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
              {draft.sendTo.length > 0 ? `Send to ${draft.sendTo.length}` : 'Send to…'}
            </Text>
          </GlassSurface>
        </Pressable>
      </View>

      {/* Tabs */}
      <GlassSurface style={styles.tabs}>
        {([
          ['trim', 'Trim', IconScissors],
          ['sound', 'Sound', IconVolume],
          ['text', 'Text', IconText],
          ['stickers', 'Stickers', IconSticker],
          ['effect', 'Effect', IconSparkle],
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
                // In source milliseconds, like everything the slider handles:
                // the shortest legal *played* Swift is a second, which at 3×
                // is only a third of a second of source.
                minLengthMs={Math.max(1, Math.round(MIN_SWIFT_MS * draft.speedPercent / 100))}
                positionMs={positionMs}
                format={(ms) => formatMs(playedMs(ms, draft.speedPercent))}
                onChange={(start, end) => onChange({ trimStartMs: start, trimEndMs: end })}
                onCommit={(start, end) => {
                  onChange({ trimStartMs: start, trimEndMs: end });
                  scrubTo(start);
                }}
              />
            ) : (
              <Text style={styles.sectionHint}>Measuring…</Text>
            )}
            {draft.speedPercent !== 100 && (
              <Text style={styles.sectionHint}>
                Playing at {draft.speedPercent / 100}×, so {formatMs(keptSource)} of
                video becomes {formatMs(kept)}.
              </Text>
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
            {/* Mic first: whether there is any recorded sound at all comes
                before how loud it is, and when the mic was off the slider
                below is meaningless rather than merely at zero. */}
            <GlassSurface style={styles.micRow}>
              {draft.micEnabled
                ? <IconMic size={20} color={colors.teal} />
                : <IconMicOff size={20} color={colors.t3} />}
              <View style={styles.micText}>
                <Text style={styles.micLabel}>
                  {draft.micEnabled ? 'Microphone was on' : 'Microphone was off'}
                </Text>
                <Text style={styles.sectionHint}>
                  {draft.micEnabled
                    ? 'This take has its own sound.'
                    : 'Nothing around you was recorded. Record again to change it.'}
                </Text>
              </View>
            </GlassSurface>

            <VolumeSlider
              label="Original sound"
              value={draft.micEnabled ? draft.originalVolume : 0}
              onChange={(v) => onChange({ originalVolume: v })}
              disabled={!draft.micEnabled}
            />
            {draft.micEnabled && (
              <Text style={styles.sectionHint}>
                {draft.originalVolume === 0
                  ? 'The video plays silent.'
                  : 'The sound recorded with the video.'}
              </Text>
            )}

            {SWIFT_MUSIC_ENABLED && <View style={styles.divider} />}

            {/* Music is switched off for now — see SWIFT_MUSIC_ENABLED. */}
            {!SWIFT_MUSIC_ENABLED ? null : draft.track ? (
              <>
                <View style={styles.trackRow}>
                  <IconMusic size={18} color={colors.teal} />
                  <View style={styles.micText}>
                    <Text style={styles.micLabel} numberOfLines={1}>
                      {draft.track.title}
                    </Text>
                    <Text style={styles.sectionHint} numberOfLines={1}>
                      {draft.track.artist || 'Unknown artist'}
                    </Text>
                  </View>
                  <Pressable onPress={onPickMusic} hitSlop={10} accessibilityRole="button">
                    <Text style={styles.trackAction}>Change</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onChange({ track: null, musicStartMs: 0 })}
                    hitSlop={10}
                    accessibilityRole="button"
                  >
                    <Text style={styles.trackRemove}>Remove</Text>
                  </Pressable>
                </View>
                <VolumeSlider
                  label="Music"
                  value={draft.musicVolume}
                  onChange={(v) => onChange({ musicVolume: v })}
                />
              </>
            ) : (
              <Pressable
                onPress={onPickMusic}
                style={styles.addTrack}
                accessibilityRole="button"
                accessibilityLabel="Add music"
              >
                <IconMusic size={18} color={colors.teal} />
                <Text style={styles.addTrackLabel}>Add music</Text>
              </Pressable>
            )}
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

        {tab === 'stickers' && (
          <View style={styles.section}>
            <StickerTray count={draft.stickers.length} onAdd={addSticker} />
            {draft.stickers.length > 0 && (
              <Text style={styles.sectionHint}>
                {draft.stickers.length} placed. Hold one on the video to remove it.
              </Text>
            )}
          </View>
        )}

        {tab === 'effect' && (
          <View style={styles.section}>
            <View style={styles.effectRow}>
              {SWIFT_EFFECTS.map((effect) => {
                const active = draft.effect === effect.key;
                return (
                  <Pressable
                    key={effect.key || 'original'}
                    onPress={() => onChange({ effect: effect.key })}
                    style={[styles.effectChip, active && styles.effectChipOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${effect.label} effect`}
                  >
                    <View
                      style={[
                        styles.swatch,
                        effect.layers.length > 0
                          ? { backgroundColor: effect.layers[0].color }
                          : styles.swatchNone,
                      ]}
                    />
                    <Text style={[styles.effectLabel, active && styles.effectLabelOn]}>
                      {effect.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {draft.effect !== '' && (
              <VolumeSlider
                label="Strength"
                value={draft.effectIntensity}
                onChange={(v) => onChange({ effectIntensity: v })}
              />
            )}
            <Text style={styles.sectionHint}>
              Applied when it plays, not baked into the file — so you can change
              or remove it after publishing.
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
    overflow: 'hidden',
  },
  stageTopRight: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 12,
  },
  stageBtnOn: { borderWidth: 1, borderColor: '#FFFFFF' },
  stageBadge: {
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

  sendBtn: { position: 'absolute', top: 12, left: 12 },
  sendInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 13,
  },
  sendText: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    color: '#FFFFFF',
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

  panel: { maxHeight: 280 },
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
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 4,
  },

  micRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  micText: { flex: 1, gap: 2 },
  micLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.t1,
  },

  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.tealLine,
    backgroundColor: colors.tealTint,
  },
  trackAction: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    color: colors.teal,
  },
  trackRemove: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.caption,
    color: colors.red,
  },
  addTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: radius.m,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.tealLine,
    backgroundColor: colors.tealTint,
  },
  addTrackLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.teal,
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

  effectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  effectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  effectChipOn: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  effectLabel: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    color: colors.t2,
  },
  effectLabelOn: { color: colors.teal, fontWeight: '600' },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  swatchNone: {
    backgroundColor: 'transparent',
    borderColor: colors.t3,
    borderWidth: 1.5,
  },
});
