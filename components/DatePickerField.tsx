/**
 * The three-wheel date-of-birth picker.
 *
 * Lifted out of app/register.tsx once a second screen needed it: a Google or
 * Apple sign-up hands us an account with no birthday, and the age gate has to
 * be answered there too. Two copies of a wheel picker is two places for the
 * padding maths to drift.
 *
 * Fixed to the light palette, like the auth screens it appears on — those are
 * cream in both themes, and a picker that followed the system theme would be a
 * dark sheet on a cream card.
 */
import { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type FlatList,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { fonts, lightColors as L, radius } from '@/constants/theme';

// Module-local: nothing outside this file reads the wheels' contents, and an
// exported non-component would cost the file its Fast Refresh boundary.
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const MONTH_KEYS = ['01','02','03','04','05','06','07','08','09','10','11','12'];
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 100 }, (_, i) => String(CURRENT_YEAR - i));

const ITEM_H = 44;

// ─── Wheel column ─────────────────────────────────────────────────────────────

interface WheelProps {
  items: string[];
  labels?: string[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}

/** One row's highlight, driven straight off the shared scroll position on the
 *  UI thread — the wheel crosses an item boundary many times a second during
 *  a fling, and re-rendering the row from React state on every one of those
 *  crossings is exactly the jank this is avoiding. */
function WheelRow({ index, count, text, scrollY }: {
  index: number; count: number; text: string; scrollY: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const raw = Math.round(scrollY.get() / ITEM_H);
    const active = Math.max(0, Math.min(raw, count - 1));
    return index === active ? { color: L.t1, fontWeight: '600' as const, fontSize: 16 } : {};
  });
  return (
    <View style={wh.item}>
      <Animated.Text style={[wh.label, style]}>{text}</Animated.Text>
    </View>
  );
}

function Wheel({ items, labels, selectedIdx, onSelect }: WheelProps) {
  const padded = ['', '', ...items, '', ''];
  const ref = useRef<FlatList<string>>(null);
  // Matches `getItemLayout`'s offset for padded-index `selectedIdx`, which is
  // also where `initialScrollIndex` lands the list before the first frame.
  const scrollY = useSharedValue(selectedIdx * ITEM_H);

  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });

  return (
    <View style={wh.wrap}>
      <Animated.FlatList
        ref={ref}
        data={padded}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ index }) => {
          const ai = index - 2;
          const text = ai >= 0 && ai < items.length ? (labels ? labels[ai] : items[ai]) : '';
          return <WheelRow index={ai} count={items.length} text={text} scrollY={scrollY} />;
        }}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: ITEM_H, offset: ITEM_H * i, index: i })}
        initialScrollIndex={selectedIdx}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
          const c = Math.max(0, Math.min(i, items.length - 1));
          onSelect(c);
        }}
      />
    </View>
  );
}

const wh = StyleSheet.create({
  wrap: { flex: 1, height: ITEM_H * 5, overflow: 'hidden' },
  item: { height: ITEM_H, justifyContent: 'center', alignItems: 'center' },
  label:    { fontFamily: fonts.body, color: L.t3, fontSize: 15 },
});

// ─── DatePickerField ──────────────────────────────────────────────────────────

interface DatePickerFieldProps {
  /** ISO `YYYY-MM-DD`, or '' for unset. */
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  label?: string;
}

export default function DatePickerField({
  value, onChange, error, label = 'Date of birth',
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);

  const [dayIdx,   setDayIdx]   = useState(() => { const i = DAYS.indexOf(value.split('-')[2]);       return i >= 0 ? i : 0;  });
  const [monthIdx, setMonthIdx] = useState(() => { const i = MONTH_KEYS.indexOf(value.split('-')[1]); return i >= 0 ? i : 0;  });
  const [yearIdx,  setYearIdx]  = useState(() => { const i = YEARS.indexOf(value.split('-')[0]);       return i >= 0 ? i : 20; });

  const displayValue = value ? `${DAYS[dayIdx]} ${MONTH_LABELS[monthIdx]} ${YEARS[yearIdx]}` : '';

  function handleDone() {
    onChange(`${YEARS[yearIdx]}-${MONTH_KEYS[monthIdx]}-${DAYS[dayIdx]}`);
    setOpen(false);
  }

  return (
    <View style={dp.wrapper}>
      <Text style={dp.fieldLabel}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={[dp.trigger, !!error && dp.triggerError]}
        accessibilityRole="button"
        accessibilityLabel={displayValue ? `${label}, ${displayValue}` : label}
      >
        <Text style={displayValue ? dp.valueText : dp.placeholder}>
          {displayValue || 'DD Mon YYYY'}
        </Text>
      </Pressable>
      {error ? <Text style={dp.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade">
        <View style={dp.overlay}>
          <View style={dp.sheet}>
            <Text style={dp.sheetTitle}>{label}</Text>
            <View style={dp.wheelRow}>
              <View pointerEvents="none" style={dp.band} />
              <Wheel items={DAYS}       selectedIdx={dayIdx}   onSelect={setDayIdx}   />
              <Wheel items={MONTH_KEYS} labels={MONTH_LABELS}  selectedIdx={monthIdx} onSelect={setMonthIdx} />
              <Wheel items={YEARS}      selectedIdx={yearIdx}  onSelect={setYearIdx}  />
            </View>
            <View style={dp.sheetBtns}>
              <Pressable
                onPress={() => setOpen(false)}
                style={({ pressed }) => [dp.modalBtn, dp.modalBtnSecondary, pressed && dp.pressed]}
              >
                <Text style={dp.modalBtnTextSecondary}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleDone}
                style={({ pressed }) => [dp.modalBtn, dp.modalBtnPrimary, pressed && dp.pressed]}
              >
                <Text style={dp.modalBtnTextPrimary}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const dp = StyleSheet.create({
  wrapper:   { gap: 4 },
  fieldLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: '500', color: L.t2 },
  trigger: {
    backgroundColor: L.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: L.border,
    paddingHorizontal: 14,
    height: 52,
    justifyContent: 'center',
  },
  triggerError: { borderColor: L.red },
  valueText:   { fontFamily: fonts.body, fontSize: 15, color: L.t1 },
  placeholder: { fontFamily: fonts.body, fontSize: 15, color: L.t3 },
  error:       { fontFamily: fonts.body, fontSize: 12, color: L.red },

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    backgroundColor: L.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: L.border,
    padding: 20,
  },
  sheetTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 17,
    color: L.t1,
    textAlign: 'center',
    marginBottom: 16,
  },
  wheelRow: { flexDirection: 'row', gap: 4 },
  band: {
    position: 'absolute',
    top: ITEM_H * 2,
    left: 0,
    right: 0,
    height: ITEM_H,
    backgroundColor: L.surface2,
    borderRadius: radius.s,
  },
  sheetBtns: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  modalBtnPrimary:   { backgroundColor: L.teal, borderColor: 'transparent' },
  modalBtnSecondary: { backgroundColor: 'transparent', borderColor: L.border },
  modalBtnTextPrimary:   { fontFamily: fonts.body, fontWeight: '600', fontSize: 15, color: L.bg },
  modalBtnTextSecondary: { fontFamily: fonts.body, fontWeight: '600', fontSize: 15, color: L.t1 },
  pressed: { opacity: 0.65 },
});
