import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// Legibility gradient behind text that sits on top of a photo or video.
//
// Drawn with react-native-svg, which the app already ships for the nav arc and
// the icon set — expo-linear-gradient would be a new native dependency, and a
// new native dependency means everyone needs a fresh dev build for one
// rectangle.
//
// Used by the Swifts feed and the story viewer. Both put white text over
// arbitrary user photos, where a flat translucent panel is the wrong answer:
// it reads as a grey box pasted on the image, and it is either too light to
// make text legible over a bright photo or too dark over a dim one. A gradient
// is invisible where the image is already dark and does its work where it is
// not.

interface ScrimProps {
  /** 'top' darkens downward from the top edge, 'bottom' upward from the bottom. */
  edge: 'top' | 'bottom';
  height: number;
  /** Opacity at the fully-dark edge. */
  opacity?: number;
}

/** Gradient ids live in one document-wide namespace, so a fixed string breaks
 *  the moment two scrims are on screen at once — every `url(#id)` resolves to
 *  whichever def mounted last. A feed of cards is exactly that case.
 *
 *  `useId` is React's own answer to that. It replaces a module-level counter
 *  bumped during render, which was impure — under StrictMode's double render it
 *  burned two ids per scrim — and which React Compiler refuses to compile,
 *  costing every screen with a scrim its automatic memoization. The punctuation
 *  React puts in the id is stripped so the value stays safe inside `url(#…)`. */
export function Scrim({ edge, height, opacity = 0.75 }: ScrimProps) {
  const id = `scrim-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  // y1→y2 runs top→bottom; flipping the stops flips which edge is opaque. The
  // middle stop is deliberately not linear — a straight ramp leaves a visible
  // band where it meets the image, and easing it keeps the falloff invisible.
  const stops =
    edge === 'bottom'
      ? [{ offset: '0', o: 0 }, { offset: '0.45', o: opacity * 0.55 }, { offset: '1', o: opacity }]
      : [{ offset: '0', o: opacity }, { offset: '0.55', o: opacity * 0.35 }, { offset: '1', o: 0 }];

  return (
    <Svg
      pointerEvents="none"
      style={[styles.scrim, edge === 'top' ? styles.top : styles.bottom, { height }]}
      width="100%"
      height={height}
    >
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          {stops.map((s) => (
            <Stop key={s.offset} offset={s.offset} stopColor="#000000" stopOpacity={s.o} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0 },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
