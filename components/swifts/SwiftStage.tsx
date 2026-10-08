import { StyleSheet, Text, View } from 'react-native';

import { effectFor } from '@/constants/swiftEffects';
import { fonts } from '@/constants/theme';
import type { SwiftRotation, SwiftSticker } from '@/services/swiftDraft';

/**
 * Everything that is drawn *over* a Swift's video, in one place.
 *
 * The colour effect, the text overlay and the stickers are all layers rather
 * than pixels — see `constants/swiftEffects` and `swifts/media.py` — which
 * means there are four surfaces that have to draw them the same way: the
 * camera preview, the editor's player, the composer's preview step, and the
 * feed. Four copies of this maths is four chances for the thing a creator
 * framed to differ from the thing a viewer watches, and that difference is
 * invisible until somebody publishes.
 *
 * Everything drawn here is an ordinary translucent `View`. Nothing uses a
 * blend mode, and nothing establishes a stacking context, because either one
 * freezes the camera and video surfaces this sits on top of —
 * `constants/swiftEffects` documents that at length.
 *
 * So it is one component, and each of those four renders it.
 *
 * ## Why positions are fractions
 *
 * A sticker is stored at `x`/`y` in 0–1, its centre as a fraction of the
 * frame, and converted to pixels here against whatever box this component is
 * given. An arrangement made on a 6.1" phone therefore lands in the same place
 * on a tablet, on a small Android, and in the feed — where the stage is a
 * different size again from the editor it was arranged in.
 *
 * `size` has to be passed rather than measured with `onLayout`: measuring
 * would place every sticker at the top-left corner for one frame before the
 * layout pass lands, which reads as the arrangement jumping into place every
 * time a card scrolls into view.
 */

interface Props {
  /** The box the video occupies, in pixels. Stickers are placed against it. */
  size: { width: number; height: number };
  effect: string;
  /** 0–100. */
  effectIntensity: number;
  stickers: SwiftSticker[];
  overlayText: string;
  overlayPosition: 'top' | 'middle' | 'bottom';
  /**
   * Only the *stickers* rotate with the video here; the video's own rotation
   * is applied by whoever owns the player, because a rotated `VideoView` has
   * to be re-measured and this component does not own that box.
   */
  rotationDeg?: SwiftRotation;
  /** Text scale for the overlay; the feed draws it larger than the editor. */
  textScale?: number;
}

export function SwiftStage({
  size,
  effect,
  effectIntensity,
  stickers,
  overlayText,
  overlayPosition,
  textScale = 1,
}: Props) {
  const treatment = effectFor(effect);
  // The creator's dial multiplies every layer's own opacity rather than
  // replacing it: the relative weights within an effect are what make it look
  // like that effect, and a single flat opacity would collapse a multi-layer
  // treatment into one flat wash halfway down the slider.
  const strength = Math.min(1, Math.max(0, effectIntensity / 100));

  return (
    <View style={styles.root} pointerEvents="none">
      {/* Plain translucent views, deliberately — no `mixBlendMode` and no
          `isolation` stacking context. Those made the camera preview freeze on
          its first frame: isolation forces the subtree to composite offscreen,
          and a system-composited camera surface promoted into an offscreen
          layer stops updating. `constants/swiftEffects` has the full argument
          and what it costs. */}
      {treatment.layers.map((layer, index) => (
        <View
          key={`${treatment.key}-${index}`}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: layer.color, opacity: layer.opacity * strength },
          ]}
        />
      ))}

      {stickers.map((sticker) => (
        <View
          key={sticker.id}
          style={[
            styles.sticker,
            {
              left: sticker.x * size.width,
              top: sticker.y * size.height,
              transform: [
                // Translate by half the glyph box first, so `x`/`y` name the
                // sticker's *centre* rather than its top-left corner — which
                // is what makes scaling and rotating happen in place.
                { translateX: -STICKER_BOX / 2 },
                { translateY: -STICKER_BOX / 2 },
                { rotate: `${sticker.rotation}deg` },
                { scale: sticker.scale },
              ],
            },
          ]}
        >
          <Text style={styles.stickerGlyph} allowFontScaling={false}>
            {sticker.emoji}
          </Text>
        </View>
      ))}

      {overlayText.trim().length > 0 && (
        <View
          style={[
            styles.overlayWrap,
            overlayPosition === 'top' && styles.overlayTop,
            overlayPosition === 'bottom' && styles.overlayBottom,
          ]}
        >
          <Text
            style={[styles.overlayText, { fontSize: 26 * textScale }]}
            numberOfLines={2}
            // Never scales with the OS text size: this is part of the picture,
            // and a viewer's accessibility setting must not reflow a caption
            // the creator positioned against what is behind it.
            allowFontScaling={false}
          >
            {overlayText}
          </Text>
        </View>
      )}
    </View>
  );
}

/** The layout box one sticker occupies at scale 1, in points. */
export const STICKER_BOX = 56;

const styles = StyleSheet.create({
  root: {
    // No `isolation` here. It creates a stacking context, which forces this
    // subtree to composite offscreen and freezes any camera or video surface
    // beneath it — see the note above the layers.
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },

  sticker: {
    position: 'absolute',
    width: STICKER_BOX,
    height: STICKER_BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickerGlyph: {
    fontSize: 40,
    lineHeight: 48,
    textAlign: 'center',
  },

  overlayWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  overlayTop: { justifyContent: 'flex-start', paddingTop: 48 },
  overlayBottom: { justifyContent: 'flex-end', paddingBottom: 48 },
  overlayText: {
    fontFamily: fonts.display,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
});
