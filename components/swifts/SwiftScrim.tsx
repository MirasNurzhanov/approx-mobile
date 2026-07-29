import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// Legibility scrim behind the overlay text. Drawn with react-native-svg, which
// the app already ships for the nav arc — expo-linear-gradient would be a new
// native dependency for one rectangle.

interface SwiftScrimProps {
  /** 'top' darkens downward from the top edge, 'bottom' upward from the bottom. */
  edge: 'top' | 'bottom';
  height: number;
  opacity?: number;
}

export function SwiftScrim({ edge, height, opacity = 0.75 }: SwiftScrimProps) {
  const id = `swift-scrim-${edge}`;
  // y1→y2 runs top→bottom; flipping the stops flips which edge is opaque.
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
