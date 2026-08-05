import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { fonts } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

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

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: GAP,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
  },
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

export function DraggableTabs({ tabs, activeTab, order, onTabPress, onOrderChange }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // All three are read only from the gesture callbacks below, which cannot fire
  // before the commit this effect follows — so syncing here rather than during
  // render costs nothing and keeps the component compilable.
  const orderRef = useRef(order);
  const onOrderChangeRef = useRef(onOrderChange);
  const onTabPressRef = useRef(onTabPress);
  useEffect(() => {
    orderRef.current = order;
    onOrderChangeRef.current = onOrderChange;
    onTabPressRef.current = onTabPress;
  });

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
    st0.set(TAB_INDEX[order[0]]);
    st1.set(TAB_INDEX[order[1]]);
    st2.set(TAB_INDEX[order[2]]);
  }, [order, st0, st1, st2]);

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
    tx0.set(0); tx1.set(0); tx2.set(0);
  }, [order, tx0, tx1, tx2]);

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
    if (didReorder.get()) {
      // Reorder: only reset scale/state. tx is zeroed by useLayoutEffect in the
      // same frame as the React re-render, so there is no visible intermediate state.
      sc0.set(1); sc1.set(1); sc2.set(1);
    } else {
      // Cancelled drag: spring everything back to origin.
      tx0.set(withSpring(0, SPRING)); tx1.set(withSpring(0, SPRING)); tx2.set(withSpring(0, SPRING));
      sc0.set(withSpring(1, SPRING)); sc1.set(withSpring(1, SPRING)); sc2.set(withSpring(1, SPRING));
    }
    didReorder.set(false);
    activeDrag.set(-1);
    hoverTarget.set(-1);
  }

  function computeHover(newCenter: number): number {
    'worklet';
    const d0 = Math.abs(newCenter - cx0.get());
    const d1 = Math.abs(newCenter - cx1.get());
    const d2 = Math.abs(newCenter - cx2.get());
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
      tx0.set(withSpring(inRange ? dir * shift : 0, SPRING));
    }
    if (dragSlot !== 1) {
      const inRange = dragSlot < hover ? (1 > dragSlot && 1 <= hover) : (1 >= hover && 1 < dragSlot);
      tx1.set(withSpring(inRange ? dir * shift : 0, SPRING));
    }
    if (dragSlot !== 2) {
      const inRange = dragSlot < hover ? (2 > dragSlot && 2 <= hover) : (2 >= hover && 2 < dragSlot);
      tx2.set(withSpring(inRange ? dir * shift : 0, SPRING));
    }
  }

  // ── Gestures ──────────────────────────────────────────────────────────────────

  const gesture0 = Gesture.Race(
    Gesture.Pan()
      .activateAfterLongPress(LONG_PRESS_MS)
      .onStart(() => { activeDrag.set(0); hoverTarget.set(0); sc0.set(withSpring(1.08, SPRING)); })
      .onUpdate(({ translationX }) => {
        tx0.set(translationX);
        const hover = computeHover(cx0.get() + translationX);
        hoverTarget.set(hover);
        shiftOthers(0, hover, sw0.get() + GAP);
      })
      .onEnd(() => { const to = hoverTarget.get(); if (to !== 0) { didReorder.set(true); scheduleOnRN(doReorder, 0, to); } })
      .onFinalize(() => resetAll()),
    Gesture.Tap().onEnd((_, s) => { if (s) scheduleOnRN(doTabPress, st0.get()); }),
  );

  const gesture1 = Gesture.Race(
    Gesture.Pan()
      .activateAfterLongPress(LONG_PRESS_MS)
      .onStart(() => { activeDrag.set(1); hoverTarget.set(1); sc1.set(withSpring(1.08, SPRING)); })
      .onUpdate(({ translationX }) => {
        tx1.set(translationX);
        const hover = computeHover(cx1.get() + translationX);
        hoverTarget.set(hover);
        shiftOthers(1, hover, sw1.get() + GAP);
      })
      .onEnd(() => { const to = hoverTarget.get(); if (to !== 1) { didReorder.set(true); scheduleOnRN(doReorder, 1, to); } })
      .onFinalize(() => resetAll()),
    Gesture.Tap().onEnd((_, s) => { if (s) scheduleOnRN(doTabPress, st1.get()); }),
  );

  const gesture2 = Gesture.Race(
    Gesture.Pan()
      .activateAfterLongPress(LONG_PRESS_MS)
      .onStart(() => { activeDrag.set(2); hoverTarget.set(2); sc2.set(withSpring(1.08, SPRING)); })
      .onUpdate(({ translationX }) => {
        tx2.set(translationX);
        const hover = computeHover(cx2.get() + translationX);
        hoverTarget.set(hover);
        shiftOthers(2, hover, sw2.get() + GAP);
      })
      .onEnd(() => { const to = hoverTarget.get(); if (to !== 2) { didReorder.set(true); scheduleOnRN(doReorder, 2, to); } })
      .onFinalize(() => resetAll()),
    Gesture.Tap().onEnd((_, s) => { if (s) scheduleOnRN(doTabPress, st2.get()); }),
  );

  const gestures = [gesture0, gesture1, gesture2];

  // ── Animated styles ───────────────────────────────────────────────────────────

  const anim0 = useAnimatedStyle(() => ({
    transform: [{ translateX: tx0.get() }, { scale: sc0.get() }],
    zIndex: activeDrag.get() === 0 ? 10 : 1,
  }));
  const anim1 = useAnimatedStyle(() => ({
    transform: [{ translateX: tx1.get() }, { scale: sc1.get() }],
    zIndex: activeDrag.get() === 1 ? 10 : 1,
  }));
  const anim2 = useAnimatedStyle(() => ({
    transform: [{ translateX: tx2.get() }, { scale: sc2.get() }],
    zIndex: activeDrag.get() === 2 ? 10 : 1,
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
                if (slotIdx === 0) { cx0.set(x + width / 2); sw0.set(width); }
                else if (slotIdx === 1) { cx1.set(x + width / 2); sw1.set(width); }
                else                   { cx2.set(x + width / 2); sw2.set(width); }
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

