import { Polyline } from 'react-native-maps';

import type { TrailPoint } from '@/hooks/useMotionTrails';

// A fading tail behind a fast-moving marker.
//
// Drawn as native map overlays *beside* the marker, never inside it.
// `react-native-maps` rasterizes a Marker's children to a bitmap, so anything
// animated in there forces `tracksViewChanges` to stay on and re-rasterizes
// every marker on the map each frame — the known way to drop frames with fifty
// pins. Polylines are native overlays and cost nothing per frame.
//
// Nothing here animates per frame, deliberately. The geometry is redrawn when
// a new position arrives on the 10s poll, and motion is conveyed by the shape
// and length of the tail rather than by movement. Animating would mean driving
// native map overlays from JS every frame, which is exactly the thing that
// cannot hold 60fps at this marker count — so the effect is simplified instead.

/** Teal accent, matching the app's tokens. Kept as rgba strings because map
 * overlays take colours directly rather than through the style system. */
const TRAIL_RGB = '31,199,182';

/** Oldest → newest. The tail thins and fades toward the back, so the dense end
 * reads as "here now" and the faint end as "was there". */
const SEGMENT_OPACITY = [0.10, 0.20, 0.34, 0.52];
const SEGMENT_WIDTH = [2, 2.75, 3.5, 4.25];

interface Props {
  path: TrailPoint[];
  /** With Reduce Motion on, this decorative tail collapses to a single short
   * directional stub — the state stays legible, the flourish goes. */
  reduceMotion?: boolean;
}

export function MotionTrail({ path, reduceMotion = false }: Props) {
  if (path.length < 2) return null;

  if (reduceMotion) {
    // Just the last leg: still says "heading that way", without the tapering
    // sweep across the map.
    const stub = path.slice(-2);
    return (
      <Polyline
        coordinates={stub}
        strokeColor={`rgba(${TRAIL_RGB},0.5)`}
        strokeWidth={3}
        lineCap="round"
        zIndex={1}
      />
    );
  }

  // One polyline per segment, because a single polyline cannot vary its
  // opacity along its length. Bounded by TRAIL_POINTS, so this is at most four
  // overlays per person and is allocated once per poll, not per frame.
  const segments = [];
  for (let i = 1; i < path.length; i += 1) {
    // Index from the end so the newest segment is always the strongest, even
    // when the path is still filling up.
    const fromEnd = path.length - 1 - i;
    const step = SEGMENT_OPACITY.length - 1 - fromEnd;
    const idx = Math.max(0, Math.min(SEGMENT_OPACITY.length - 1, step));

    segments.push(
      <Polyline
        // The path is a sliding window — points leave the front as new ones
        // arrive — so an index would hand each segment's identity to its
        // neighbour on every poll. Its two endpoints identify it instead.
        key={`${path[i - 1].latitude},${path[i - 1].longitude}-${path[i].latitude},${path[i].longitude}`}
        coordinates={[path[i - 1], path[i]]}
        strokeColor={`rgba(${TRAIL_RGB},${SEGMENT_OPACITY[idx]})`}
        strokeWidth={SEGMENT_WIDTH[idx]}
        lineCap="round"
        zIndex={1}
      />,
    );
  }

  return <>{segments}</>;
}
