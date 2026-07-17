import { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import axios from 'axios';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loginRequest } from '@/services/auth';
import { BASE_URL } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { colors, fonts, radius } from '@/constants/theme';

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const MONTH_KEYS = ['01','02','03','04','05','06','07','08','09','10','11','12'];
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 100 }, (_, i) => String(CURRENT_YEAR - i));

const ITEM_H = 44;

type FieldErrors = Record<string, string[]>;

// ─── Wheel column ────────────────────────────────────────────────────────────

interface WheelProps {
  items: string[];
  labels?: string[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}

function Wheel({ items, labels, selectedIdx, onSelect }: WheelProps) {
  const padded = ['', '', ...items, '', ''];
  const [activeIdx, setActiveIdx] = useState(selectedIdx);
  const ref = useRef<FlatList<string>>(null);

  return (
    <View style={wheel.wrap}>
      <FlatList
        ref={ref}
        data={padded}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ index }) => {
          const ai = index - 2;
          const isSel = ai === activeIdx;
          const label = ai >= 0 && ai < items.length ? (labels ? labels[ai] : items[ai]) : '';
          return (
            <View style={wheel.item}>
              <Text style={[wheel.label, isSel && wheel.labelSel]}>{label}</Text>
            </View>
          );
        }}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: ITEM_H, offset: ITEM_H * i, index: i })}
        initialScrollIndex={selectedIdx}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
          const c = Math.max(0, Math.min(i, items.length - 1));
          if (c !== activeIdx) setActiveIdx(c);
        }}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
          const c = Math.max(0, Math.min(i, items.length - 1));
          setActiveIdx(c);
          onSelect(c);
        }}
      />
      {/* selection band */}
      <View pointerEvents="none" style={wheel.band} />
    </View>
  );
}

const wheel = StyleSheet.create({
  wrap: { flex: 1, height: ITEM_H * 5, overflow: 'hidden' },
  item: { height: ITEM_H, justifyContent: 'center', alignItems: 'center' },
  label: {
    fontFamily: fonts.body,
    color: colors.t3,
    fontSize: 15,
  },
  labelSel: {
    fontFamily: fonts.body,
    color: colors.t1,
    fontWeight: '600',
    fontSize: 16,
  },
  band: {
    position: 'absolute',
    top: ITEM_H * 2,
    left: 0,
    right: 0,
    height: ITEM_H,
    backgroundColor: colors.surface2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});

// ─── DatePickerField ──────────────────────────────────────────────────────────

interface DatePickerFieldProps {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}

function DatePickerField({ value, onChange, error }: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);

  const [dayIdx, setDayIdx] = useState(() => {
    if (!value) return 0;
    const i = DAYS.indexOf(value.split('-')[2]);
    return i >= 0 ? i : 0;
  });
  const [monthIdx, setMonthIdx] = useState(() => {
    if (!value) return 0;
    const i = MONTH_KEYS.indexOf(value.split('-')[1]);
    return i >= 0 ? i : 0;
  });
  const [yearIdx, setYearIdx] = useState(() => {
    if (!value) return 20;
    const i = YEARS.indexOf(value.split('-')[0]);
    return i >= 0 ? i : 20;
  });

  const displayValue = value
    ? `${DAYS[dayIdx]} ${MONTH_LABELS[monthIdx]} ${YEARS[yearIdx]}`
    : '';

  function handleDone() {
    onChange(`${YEARS[yearIdx]}-${MONTH_KEYS[monthIdx]}-${DAYS[dayIdx]}`);
    setOpen(false);
  }

  return (
    <View style={dp.wrapper}>
      <Text style={dp.fieldLabel}>Date of birth</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={[dp.trigger, !!error && dp.triggerError]}
      >
        <Text style={displayValue ? dp.valueText : dp.placeholder}>
          {displayValue || 'DD Mon YYYY'}
        </Text>
      </Pressable>
      {error ? <Text style={dp.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade">
        <View style={dp.overlay}>
          <View style={dp.sheet}>
            <Text style={dp.sheetTitle}>Date of birth</Text>
            <View style={dp.wheelRow}>
              <Wheel items={DAYS} selectedIdx={dayIdx} onSelect={setDayIdx} />
              <Wheel items={MONTH_KEYS} labels={MONTH_LABELS} selectedIdx={monthIdx} onSelect={setMonthIdx} />
              <Wheel items={YEARS} selectedIdx={yearIdx} onSelect={setYearIdx} />
            </View>
            <View style={dp.sheetBtns}>
              <Button label="Cancel" variant="secondary" size="md" onPress={() => setOpen(false)} />
              <Button label="Done" variant="primary" size="md" onPress={handleDone} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const dp = StyleSheet.create({
  wrapper: { gap: 6 },
  fieldLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: colors.t2,
  },
  trigger: {
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  triggerError: { borderColor: colors.red },
  valueText: { fontFamily: fonts.body, fontSize: 15, color: colors.t1 },
  placeholder: { fontFamily: fonts.body, fontSize: 15, color: colors.t3 },
  error: { fontFamily: fonts.body, fontSize: 12, color: colors.red },

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  sheetTitle: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 17,
    color: colors.t1,
    textAlign: 'center',
    marginBottom: 16,
  },
  wheelRow: { flexDirection: 'row', gap: 4 },
  sheetBtns: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
});

// ─── RegisterScreen ───────────────────────────────────────────────────────────

export default function RegisterScreen() {
  const { top } = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleRegister() {
    setErrors({});
    if (password !== confirmPassword) {
      setErrors({ confirm_password: ['Passwords do not match'] });
      return;
    }
    if (!dob) {
      setErrors({ date_of_birth: ['Date of birth is required'] });
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(`${BASE_URL}/api/users/register/`, {
        username,
        email,
        date_of_birth: dob,
        password,
        password2: confirmPassword,
      });
      await loginRequest(email, password);
      router.replace('/interests-setup');
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data) {
        const data = err.response.data;
        if (typeof data === 'object' && !Array.isArray(data)) {
          setErrors(data as FieldErrors);
        } else {
          setErrors({ non_field_errors: ['Registration failed. Please try again.'] });
        }
      } else {
        setErrors({ non_field_errors: ['Registration failed. Please try again.'] });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const fe = (field: string) => errors[field]?.[0];

  const globalError = errors.non_field_errors?.[0] ?? errors.detail?.[0];

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: top + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Create account</Text>

        {globalError ? (
          <View style={styles.globalError}>
            <Text style={styles.globalErrorText}>{globalError}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <Input
            label="Username"
            placeholder="yourhandle"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            error={fe('username')}
          />
          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            error={fe('email')}
          />
          <DatePickerField value={dob} onChange={setDob} error={fe('date_of_birth')} />
          <Input
            label="Password"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            error={fe('password')}
          />
          <Input
            label="Confirm password"
            placeholder="••••••••"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            error={fe('confirm_password')}
          />
        </View>

        <Button
          label="Create Account"
          variant="primary"
          size="lg"
          fullWidth
          loading={submitting}
          onPress={handleRegister}
        />

        <View style={styles.signinRow}>
          <Text style={styles.signinText}>Already have an account? </Text>
          <Pressable onPress={() => router.replace('/login')} hitSlop={8}>
            <Text style={styles.signinLink}>Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 28,
    color: colors.t1,
    marginBottom: 28,
  },
  globalError: {
    backgroundColor: `${colors.red}18`,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.red,
    padding: 12,
    marginBottom: 20,
  },
  globalErrorText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.red,
    textAlign: 'center',
  },
  form: { gap: 16, marginBottom: 28 },
  signinRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 28,
  },
  signinText: { fontFamily: fonts.body, fontSize: 14, color: colors.t2 },
  signinLink: { fontFamily: fonts.body, fontSize: 14, color: colors.teal, fontWeight: '600' },
});
