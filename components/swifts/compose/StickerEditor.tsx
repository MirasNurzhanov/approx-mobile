import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import { STICKER_BOX } from '@/components/swifts/SwiftStage';
import { fonts, radius, type as typography, MAX_SCALE_FIXED } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { MAX_STICKERS, type SwiftSticker } from '@/services/swiftDraft';

/**
 * Placing, dragging and removing the emoji on a Swift.
 *
 * Two pieces that only make sense together: the tray of emoji to add, and the
 * invisible layer over the preview that lets the ones already added be moved.
 *
 * ## Why the drag layer is separate from `SwiftStage`
 *
 * `SwiftStage` draws stickers everywhere they appear — the editor, the preview
 * step, the feed — and in three of those four places they must not be
 * touchable. A feed card whose emoji can be dragged would eat the swipe that
 * scrolls to the next Swift, which is the single gesture the whole surface
 * depends on.
 *
 * So `SwiftStage` is `pointerEvents="none"` and draws, and this component sits
 * over it in the editor only and handles. The two therefore have to agree
 * exactly about where a sticker *is*, which is why both place from the same
 * fractional coordinates against the same measured box, and why `STICKER_BOX`
 * is exported from the one that draws rather than duplicated here.
 *
 * ## Why the gesture writes through `scheduleOnRN`
 *
 * The pan runs on the UI thread and the draft is React state, so every update
 * has to hop back. `scheduleOnRN` rather than `runOnJS`: Reanimated 4 renamed
 * it and the old name is gone — the same call `VolumeSlider` and `TrimSlider`
 * next door already use.
 *
 * Positions are committed continuously rather than on release. A sticker that
 * only lands when you lift your finger feels detached from it, and the cost of
 * a state write per frame here is one re-render of a component tree that is
 * already re-rendering for the video.
 */

/**
 * The tray's emoji.
 *
 * A fixed list rather than the system keyboard, and that is the interesting
 * decision. A keyboard would offer every emoji, but it also opens over the
 * preview — so the thing being decorated is hidden at the moment of choosing,
 * and each sticker costs a keyboard open, a search and a dismiss. A grid that
 * sits *beside* the video is two taps and never covers it.
 *
 * Grouped the way people reach for them, common first.
 */
const TRAY: { label: string; emoji: string[] }[] = [
  {
    label: 'Reactions',
    emoji: ['😂', '😍', '🥹', '😭', '😳', '🤯', '😎', '🥶', '😴', '🤡', '👀', '💀'],
  },
  {
    label: 'Hands',
    emoji: ['🔥', '💯', '👏', '🙌', '🤝', '👍', '👎', '🫶', '✌️', '🤙', '💪', '🙏'],
  },
  {
    label: 'Hearts',
    emoji: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💖', '✨', '⭐'],
  },
  {
    label: 'Places',
    emoji: ['📍', '🗺️', '🏔️', '🌇', '🌃', '🏙️', '🌊', '🌲', '☀️', '🌙', '⛄', '🌧️'],
  },
  {
    label: 'Things',
    emoji: ['☕', '🍕', '🍜', '🎧', '🎵', '📷', '🚗', '✈️', '⚽', '🎉', '🎈', '🎁'],
  },
];

// ── The tray ─────────────────────────────────────────────────────────────────

interface TrayProps {
  count: number;
  onAdd: (emoji: string) => void;
}

export function StickerTray({ count, onAdd }: TrayProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const full = count >= MAX_STICKERS;

  return (
    <View style={styles.tray}>
      <Text style={styles.trayHint} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
        {full
          ? `That is all ${MAX_STICKERS}. Remove one to add another.`
          : 'Tap to add, then drag it where you want it.'}
      </Text>
      {TRAY.map((group) => (
        <View key={group.label} style={styles.group}>
          <Text style={styles.groupLabel} maxFontSizeMultiplier={MAX_SCALE_FIXED}>
            {group.label}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.groupRow}
          >
            {group.emoji.map((emoji) => (
              <Text
                key={emoji}
                style={[styles.trayEmoji, full && styles.trayEmojiOff]}
                onPress={full ? undefined : () => onAdd(emoji)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${emoji}`}
                accessibilityState={{ disabled: full }}
                allowFontScaling={false}
              >
                {emoji}
              </Text>
            ))}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

// ── The drag layer ───────────────────────────────────────────────────────────

interface LayerProps {
  stickers: SwiftSticker[];
  /** The box the video occupies, so fractions convert to pixels. */
  size: { width: number; height: number };
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
}

export function StickerDragLayer({ stickers, size, onMove, onRemove }: LayerProps) {
  if (size.width <= 0 || size.height <= 0) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {stickers.map((sticker) => (
        <DraggableSticker
          key={sticker.id}
          sticker={sticker}
          size={size}
          onMove={onMove}
          onRemove={onRemove}
        />
      ))}
    </View>
  );
}

function DraggableSticker({
  sticker, size, onMove, onRemove,
}: {
  sticker: SwiftSticker;
  size: { width: number; height: number };
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  // Absolute placement rather than a translation delta: the draft is the
  // single source of truth for where a sticker is, and a gesture that
  // accumulated its own offset would drift away from it the moment anything
  // else wrote a position (an undo, a reset, a reload of a draft).
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      scheduleOnRN(
        onMove,
        sticker.id,
        // `absoluteX` is screen space and the layer is not at the screen's
        // origin, so this uses the translation against the sticker's own
        // stored position instead — which is in the layer's space by
        // construction.
        clamp01(sticker.x + e.translationX / size.width),
        clamp01(sticker.y + e.translationY / size.height),
      );
    })
    .onEnd((e) => {
      scheduleOnRN(
        onMove,
        sticker.id,
        clamp01(sticker.x + e.translationX / size.width),
        clamp01(sticker.y + e.translationY / size.height),
      );
    });

  // A long press removes it. Not a delete button on the sticker itself: at
  // this size the button would be most of the sticker, and every sticker would
  // wear one — which is a video covered in chrome rather than in emoji.
  const remove = Gesture.LongPress()
    .minDuration(450)
    .onStart(() => scheduleOnRN(onRemove, sticker.id));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pan, remove)}>
      <View
        style={[
          styles.hit,
          {
            left: sticker.x * size.width,
            top: sticker.y * size.height,
            transform: [
              { translateX: -STICKER_BOX / 2 },
              { translateY: -STICKER_BOX / 2 },
            ],
          },
        ]}
        accessibilityRole="adjustable"
        accessibilityLabel={`${sticker.emoji} sticker. Drag to move, hold to remove.`}
        accessibilityActions={[{ name: 'activate', label: 'remove' }]}
        onAccessibilityAction={() => onRemove(sticker.id)}
      />
    </GestureDetector>
  );
}

/** Worklet-safe: runs on the UI thread inside the gesture handlers. */
function clamp01(value: number): number {
  'worklet';
  return Math.min(1, Math.max(0, value));
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  tray: { gap: 14 },
  trayHint: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    lineHeight: 19,
    color: colors.t3,
  },
  group: { gap: 6 },
  groupLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.micro,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.t3,
  },
  groupRow: { gap: 6, paddingRight: 8 },
  trayEmoji: {
    fontSize: 28,
    lineHeight: 38,
    width: 44,
    textAlign: 'center',
    borderRadius: radius.s,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  trayEmojiOff: { opacity: 0.35 },

  // Transparent: the sticker itself is drawn by `SwiftStage` underneath, and
  // this is only the target that catches the finger. Sized to the glyph box so
  // the touch area matches what is visible.
  hit: {
    position: 'absolute',
    width: STICKER_BOX,
    height: STICKER_BOX,
  },
});
