import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { colors, fonts } from '@/constants/theme';

export type DraggableTabKey = 'alerts' | 'chats' | 'clubs';

const TAB_KEYS: DraggableTabKey[] = ['alerts', 'chats', 'clubs'];
const TAB_INDEX: Record<DraggableTabKey, number> = { alerts: 0, chats: 1, clubs: 2 };
const SPRING = { damping: 20, stiffness: 280 };
const GAP = 8;
const LONG_PRESS_MS = 380;

interface TabDef {
  key: DraggableTabKey;
  label: string;
  count: number;
}

interface Props {
  tabs: TabDef[];
  activeTab: DraggableTabKey;
  order: DraggableTabKey[];
  onTabPress: (key: DraggableTabKey) => void;
  onOrderChange: (next: DraggableTabKey[]) => void;
}

export function DraggableTabs({ tabs, activeTab, order, onTabPress, onOrderChange }: Props) {
  const orderRef = useRef(order);
  orderRef.current = order;
  const onOrderChangeRef = useRef(onOrderChange);
  onOrderChangeRef.current = onOrderChange;
  const onTabPressRef = useRef(onTabPress);
  onTabPressRef.current = onTabPress;

  // Slot center-x and width (set from onLayout, read in UI-thread worklets).
  const cx0 = useSharedValue(0); const cx1 = useSharedValue(0); const cx2 = useSharedValue(0);
  const sw0 = useSharedValue(0); const sw1 = useSharedValue(0); const sw2 = useSharedValue(0);

  // Per-slot animated translation and scale.
  const tx0 = useSharedValue(0); const tx1 = useSharedValue(0); const tx2 = useSharedValue(0);
  const sc0 = useSharedValue(1); const sc1 = useSharedValue(1); const sc2 = useSharedValue(1);

  const activeDrag = useSharedValue(-1);
  const hoverTarget = useSharedValue(-1);

  // Numeric tab-key encoding per slot so tap callbacks can read which tab is here.
  const st0 = useSharedValue(TAB_INDEX[order[0]]);
  const st1 = useSharedValue(TAB_INDEX[order[1]]);
  const st2 = useSharedValue(TAB_INDEX[order[2]]);

  useEffect(() => {
    st0.value = TAB_INDEX[order[0]];
    st1.value = TAB_INDEX[order[1]];
    st2.value = TAB_INDEX[order[2]];
  }, [order]);

  // ── Key insight ───────────────────────────────────────────────────────────────
  // The drag tx values place each pill at the exact visual position it will occupy
  // after the re-render at tx=0. So we must NOT reset tx on the UI thread before
  // the React commit lands — that would show a wrong intermediate frame.
  //
  // Instead: leave tx alone in onFinalize (reorder case), and zero it out here in
  // useLayoutEffect, which fires synchronously after React's commit and before the
  // next native paint. Both changes arrive at the GPU in the same frame → no glitch.
  const initialMount = useRef(true);
  useLayoutEffect(() => {
    if (initialMount.current) { initialMount.current = false; return; }
    tx0.value = 0; tx1.value = 0; tx2.value = 0;
  }, [order]);

  // Stable JS-thread callbacks.
  const doReorder = useCallback((from: number, to: number) => {
    const next = [...orderRef.current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onOrderChangeRef.current(next);
  }, []);

  const doTabPress = useCallback((tabIdx: number) => {
    onTabPressRef.current(TAB_KEYS[tabIdx]);
  }, []);

  // ── Worklet helpers ───────────────────────────────────────────────────────────

  const didReorder = useSharedValue(false);

  function resetAll() {
    'worklet';
    if (didReorder.value) {
      // Reorder: only reset scale/state. tx is zeroed by useLayoutEffect in the
      // same frame as the React re-render, so there is no visible intermediate state.
      sc0.value = 1; sc1.value = 1; sc2.value = 1;
    } else {
      // Cancelled drag: spring everything back to origin.
      tx0.value = withSpring(0, SPRING); tx1.value = withSpring(0, SPRING); tx2.value = withSpring(0, SPRING);
      sc0.value = withSpring(1, SPRING); sc1.value = withSpring(1, SPRING); sc2.value = withSpring(1, SPRING);
    }
    didReorder.value = false;
    activeDrag.value = -1;
    hoverTarget.value = -1;
  }

  function computeHover(newCenter: number): number {
    'worklet';
    const d0 = Math.abs(newCenter - cx0.value);
    const d1 = Math.abs(newCenter - cx1.value);
    const d2 = Math.abs(newCenter - cx2.value);
    const min = Math.min(d0, d1, d2);
    if (min === d0) return 0;
    if (min === d1) return 1;
    return 2;
  }

  function shiftOthers(dragSlot: number, hover: number, shift: number) {
    'worklet';
    const dir = dragSlot < hover ? -1 : 1;
    if (dragSlot !== 0) {
      const inRange = dragSlot < hover ? (0 > dragSlot && 0 <= hover) : (0 >= hover && 0 < dragSlot);
      tx0.value = withSpring(inRange ? dir * shift : 0, SPRING);
    }
    if (dragSlot !== 1) {
      const inRange = dragSlot < hover ? (1 > dragSlot && 1 <= hover) : (1 >= hover && 1 < dragSlot);
      tx1.value = withSpring(inRange ? dir * shift : 0, SPRING);
    }
    if (dragSlot !== 2) {
      const inRange = dragSlot < hover ? (2 > dragSlot && 2 <= hover) : (2 >= hover && 2 < dragSlot);
      tx2.value = withSpring(inRange ? dir * shift : 0, SPRING);
    }
  }

  // ── Gestures ──────────────────────────────────────────────────────────────────

  const gesture0 = Gesture.Race(
    Gesture.Pan()
      .activateAfterLongPress(LONG_PRESS_MS)
      .onStart(() => { activeDrag.value = 0; hoverTarget.value = 0; sc0.value = withSpring(1.08, SPRING); })
      .onUpdate(({ translationX }) => {
        tx0.value = translationX;
        const hover = computeHover(cx0.value + translationX);
        hoverTarget.value = hover;
        shiftOthers(0, hover, sw0.value + GAP);
      })
      .onEnd(() => { const to = hoverTarget.value; if (to !== 0) { didReorder.value = true; runOnJS(doReorder)(0, to); } })
      .onFinalize(() => resetAll()),
    Gesture.Tap().onEnd((_, s) => { if (s) runOnJS(doTabPress)(st0.value); }),
  );

  const gesture1 = Gesture.Race(
    Gesture.Pan()
      .activateAfterLongPress(LONG_PRESS_MS)
      .onStart(() => { activeDrag.value = 1; hoverTarget.value = 1; sc1.value = withSpring(1.08, SPRING); })
      .onUpdate(({ translationX }) => {
        tx1.value = translationX;
        const hover = computeHover(cx1.value + translationX);
        hoverTarget.value = hover;
        shiftOthers(1, hover, sw1.value + GAP);
      })
      .onEnd(() => { const to = hoverTarget.value; if (to !== 1) { didReorder.value = true; runOnJS(doReorder)(1, to); } })
      .onFinalize(() => resetAll()),
    Gesture.Tap().onEnd((_, s) => { if (s) runOnJS(doTabPress)(st1.value); }),
  );

  const gesture2 = Gesture.Race(
    Gesture.Pan()
      .activateAfterLongPress(LONG_PRESS_MS)
      .onStart(() => { activeDrag.value = 2; hoverTarget.value = 2; sc2.value = withSpring(1.08, SPRING); })
      .onUpdate(({ translationX }) => {
        tx2.value = translationX;
        const hover = computeHover(cx2.value + translationX);
        hoverTarget.value = hover;
        shiftOthers(2, hover, sw2.value + GAP);
      })
      .onEnd(() => { const to = hoverTarget.value; if (to !== 2) { didReorder.value = true; runOnJS(doReorder)(2, to); } })
      .onFinalize(() => resetAll()),
    Gesture.Tap().onEnd((_, s) => { if (s) runOnJS(doTabPress)(st2.value); }),
  );

  const gestures = [gesture0, gesture1, gesture2];

  // ── Animated styles ───────────────────────────────────────────────────────────

  const anim0 = useAnimatedStyle(() => ({
    transform: [{ translateX: tx0.value }, { scale: sc0.value }],
    zIndex: activeDrag.value === 0 ? 10 : 1,
  }));
  const anim1 = useAnimatedStyle(() => ({
    transform: [{ translateX: tx1.value }, { scale: sc1.value }],
    zIndex: activeDrag.value === 1 ? 10 : 1,
  }));
  const anim2 = useAnimatedStyle(() => ({
    transform: [{ translateX: tx2.value }, { scale: sc2.value }],
    zIndex: activeDrag.value === 2 ? 10 : 1,
  }));
  const animStyles = [anim0, anim1, anim2];

  const tabMap = Object.fromEntries(tabs.map((t) => [t.key, t])) as Record<DraggableTabKey, TabDef>;

  return (
    <View style={styles.row}>
      {order.map((tabKey, slotIdx) => {
        const tab = tabMap[tabKey];
        const isActive = tabKey === activeTab;
        const isAlerts = tabKey === 'alerts';

        return (
          <GestureDetector key={slotIdx} gesture={gestures[slotIdx]}>
            <Animated.View
              style={[styles.slot, animStyles[slotIdx]]}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                if (slotIdx === 0) { cx0.value = x + width / 2; sw0.value = width; }
                else if (slotIdx === 1) { cx1.value = x + width / 2; sw1.value = width; }
                else                   { cx2.value = x + width / 2; sw2.value = width; }
              }}
            >
              <View style={[styles.pill, isActive && styles.pillActive]}>
                <Text style={[styles.label, isActive && styles.labelActive]}>
                  {tab.label}
                </Text>
                {tab.count > 0 && (
                  <View style={[
                    styles.badge,
                    isActive ? styles.badgeActive : isAlerts ? styles.badgeAlerts : styles.badgeDefault,
                  ]}>
                    <Text style={[
                      styles.badgeText,
                      isActive && styles.badgeTextActive,
                      !isActive && isAlerts && styles.badgeTextAlerts,
                    ]}>
                      {tab.count}
                    </Text>
                  </View>
                )}
              </View>
            </Animated.View>
          </GestureDetector>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Flush with the search field above it — same 16pt gutters, and the three
  // pills divide the row between them so the strip ends where the field ends
  // instead of floating centred inside it.
  row: {
    flexDirection: 'row',
    gap: GAP,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
  },
  /** Equal thirds. It also makes the drag maths exact: every slot is the same
   *  width, so a pill swapped with its neighbour travels precisely one slot. */
  slot: { flex: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  pillActive: { backgroundColor: colors.teal },
  label: { fontFamily: fonts.body, fontSize: 13, fontWeight: '500', color: colors.t3 },
  labelActive: { color: colors.bg, fontWeight: '700' },
  badge: { borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeActive: { backgroundColor: 'rgba(10,12,14,0.25)' },
  badgeAlerts: { backgroundColor: colors.red },
  badgeDefault: { backgroundColor: colors.surface2 },
  badgeText: { fontFamily: fonts.body, color: colors.t3, fontSize: 10, fontWeight: '700' },
  badgeTextActive: { color: colors.bg },
  badgeTextAlerts: { color: '#fff' },
});
