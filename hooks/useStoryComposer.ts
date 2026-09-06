// The story composer, and the two ways it opens.
//
// Split out of app/(tabs)/map.tsx. "Is the composer open" and "where will the
// pin go, if there is one" are two questions, and the coordinate is allowed to
// be null: a story does not need a position. The server drops the coordinate
// anyway while Ghost Mode is on, so refusing here would only turn that into a
// failure the user has to decode.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';

export function useStoryComposer(
  /** The live position, read through a ref so opening does not depend on which
   *  render the caller was in. */
  coordsRef: React.RefObject<{ latitude: number; longitude: number } | null>,
) {
  const router = useRouter();
  const [composerOpen, setComposerOpen] = useState(false);
  const [createStoryCoord, setCreateStoryCoord] =
    useState<{ latitude: number; longitude: number } | null>(null);

  // ── The composer, and the swipe that opens it ──
  // `/compose` sends "Story" back to the map rather than opening a composer of
  // its own: the sheet is the map's (`composerOpen`), and only the map holds
  // the coordinate that decides whether the story becomes a pin.
  //
  // The param is cleared as it is read. Left in the route it would survive the
  // sheet being closed, and every later pass through here would reopen it.
  //
  // react-doctor reads the effect below as `no-adjust-state-on-prop-change`.
  // Rejected: `composeParam` is not a prop this state mirrors, it is a
  // navigation *event* arriving through the only channel expo-router gives us.
  // The effect fires once per arrival and clears the param on the same pass, so
  // there is no cascade — the second run returns at the guard.
  const { compose: composeParam } = useLocalSearchParams<{ compose?: string }>();
  useEffect(() => {
    if (composeParam !== 'story') return;
    router.setParams({ compose: undefined });
    // `coordsRef`, not a rendered position: this reacts to the param arriving,
    // not to every position that lands afterwards.
    setCreateStoryCoord(coordsRef.current ?? null);
    setComposerOpen(true);
  }, [composeParam, router, coordsRef]);

  // The left-edge strip that opens `/compose`.
  //
  // Recognition runs natively (gesture-handler), but the callback is kept on
  // the JS thread with `.runOnJS(true)` — navigating from it then needs no
  // worklet hop, which is the one thing the PanResponder this replaces was
  // chosen for. Nothing here tracks the finger visually, so there is no
  // shared value to drive on the UI thread.
  //
  // Both thresholds carry over from the responder. Gesture-handler never
  // claims on touch-down, which is what `onStartShouldSetPanResponder:
  // () => false` bought — a tap, or a vertical drag beginning at the edge,
  // still falls straight through to the map underneath. `activeOffsetX(12)`
  // is the old `dx > 12`, and `failOffsetY` is its `|dx| > |dy| * 1.5`
  // dominance test, which at that same 12pt allows 8pt of vertical drift.
  const composeEdge = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX(12)
        .failOffsetY([-8, 8])
        .onEnd((e) => {
          if (e.translationX > 40) router.push('/compose');
        }),
    [router],
  );

  /** Open on a spot — a long-press pin — or on nothing, for a story with no
   *  place. Not having a fix is no longer a reason a story cannot be written;
   *  it only means the story will not be a pin. */
  function openComposerAt(at: { latitude: number; longitude: number } | null) {
    setCreateStoryCoord(at);
    setComposerOpen(true);
  }

  function closeComposer() {
    setComposerOpen(false);
    setCreateStoryCoord(null);
  }

  return { composerOpen, createStoryCoord, composeEdge, openComposerAt, closeComposer };
}
