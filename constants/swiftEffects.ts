/**
 * The colour treatments a Swift can be filmed and published under.
 *
 * ## Why these are plain tint layers
 *
 * A real filter is a fragment shader over the camera texture, which on React
 * Native means `react-native-vision-camera` plus Skia — two native modules, a
 * fresh dev build for everybody, and a frame processor running on every
 * preview frame. That is a large amount of machinery to own for a feature
 * that is, visually, "put a colour over the picture".
 *
 * So an effect here is a **stack of ordinary translucent views** over the
 * video. It costs nothing, needs no native module, and is applied identically
 * over the camera preview, the editor's player and the feed — in all three
 * cases the same `View`s over the same kind of surface, so what the creator
 * frames is what publishes.
 *
 * ## Why not `mixBlendMode`, which would look better
 *
 * It was tried and it broke the camera. `mixBlendMode` needs an
 * `isolation: 'isolate'` stacking context to blend against what is beneath it,
 * and that context forces the subtree to composite offscreen. A camera preview
 * is a system-composited surface: promoted into an offscreen layer, it renders
 * its first frame and then stops updating, which reads as a frozen picture
 * until the screen is left. `expo-video` draws to the same kind of surface, so
 * the feed was exposed to it too.
 *
 * The blend was also not doing what it looked like it was doing. The isolation
 * boundary sat on the *overlay*, not on a parent containing both the overlay
 * and the video — so each layer blended against the overlay's own transparent
 * background rather than against the picture. A correct arrangement would put
 * the camera and the blend layers as siblings inside one isolated parent, and
 * that is exactly the arrangement that freezes.
 *
 * **What this costs, stated plainly:** alpha compositing can darken, lighten
 * and shift hue, but it cannot desaturate or raise contrast. `mono` and `noir`
 * are therefore *approximations* — a heavy neutral wash that mutes colour
 * rather than removing it — and `vivid` is a warm-magenta lift rather than a
 * real saturation boost. Getting the real versions means the shader path and a
 * native rebuild; nothing short of that will do it.
 *
 * The other honest limitation, unchanged: the effect is **not in the file**. A
 * Swift handed to anything that is not Approx is the untouched recording. That
 * is the same trade every other edit parameter in this composer makes — see
 * `services/swiftDraft` — and it is why `effect` travels as a key.
 *
 * Keys are mirrored in `swifts/capture.py` as `EFFECT_KEYS`; the server
 * refuses one it does not know, so adding an effect here means adding it
 * there.
 */

export interface EffectLayer {
  color: string;
  /** 0–1, before the creator's intensity is applied. */
  opacity: number;
}

export interface SwiftEffect {
  /** Stored on the Swift. '' is the untouched original. */
  key: string;
  label: string;
  layers: EffectLayer[];
}

/**
 * Ordered as the picker shows them, with "Original" first.
 *
 * The order is useful-first rather than alphabetical: the treatments people
 * reach for (a wash of warmth, a cool cast, a faded look) come before the
 * strong ones that suit one clip in twenty.
 *
 * Every opacity here was chosen to read at full strength without burying the
 * picture — the creator's intensity dial scales them down from there, never up.
 */
export const SWIFT_EFFECTS: SwiftEffect[] = [
  { key: '', label: 'Original', layers: [] },
  {
    key: 'warm',
    label: 'Warm',
    layers: [
      { color: '#FF7A2F', opacity: 0.20 },
      { color: '#FFE0B2', opacity: 0.10 },
    ],
  },
  {
    key: 'cool',
    label: 'Cool',
    layers: [
      { color: '#2F6BFF', opacity: 0.18 },
      { color: '#BBD7FF', opacity: 0.08 },
    ],
  },
  {
    key: 'vivid',
    label: 'Vivid',
    layers: [
      // An approximation: alpha cannot raise saturation, so this is a warm
      // magenta-and-amber lift that reads as punchier rather than a real
      // saturation boost. See the module note.
      { color: '#FF3D6E', opacity: 0.09 },
      { color: '#FFC400', opacity: 0.07 },
    ],
  },
  {
    key: 'fade',
    label: 'Fade',
    layers: [
      { color: '#EFE7DC', opacity: 0.26 },
      { color: '#2B2620', opacity: 0.06 },
    ],
  },
  {
    key: 'mono',
    label: 'Mono',
    layers: [
      // Not true greyscale — a heavy neutral wash that mutes colour. The
      // module note explains why the real thing needs a shader.
      { color: '#6E6E73', opacity: 0.62 },
      { color: '#FFFFFF', opacity: 0.05 },
    ],
  },
  {
    key: 'noir',
    label: 'Noir',
    layers: [
      { color: '#14141A', opacity: 0.44 },
      { color: '#8E93A8', opacity: 0.20 },
    ],
  },
  {
    key: 'sepia',
    label: 'Sepia',
    layers: [
      { color: '#7A4A21', opacity: 0.32 },
      { color: '#FFD9A0', opacity: 0.16 },
    ],
  },
  {
    key: 'dream',
    label: 'Dream',
    layers: [
      { color: '#FF9EE5', opacity: 0.16 },
      { color: '#9EE6FF', opacity: 0.14 },
      { color: '#FFFFFF', opacity: 0.08 },
    ],
  },
  {
    key: 'night',
    label: 'Night',
    layers: [
      { color: '#0B1533', opacity: 0.44 },
      { color: '#5B8CFF', opacity: 0.10 },
    ],
  },
];

/** The effect with this key, or the untouched original. */
export function effectFor(key: string | null | undefined): SwiftEffect {
  return SWIFT_EFFECTS.find((e) => e.key === (key ?? '')) ?? SWIFT_EFFECTS[0];
}

/** Whether this key draws anything at all. */
export function hasEffect(key: string | null | undefined): boolean {
  return effectFor(key).layers.length > 0;
}
