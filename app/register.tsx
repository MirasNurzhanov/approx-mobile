import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import axios from 'axios';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loginRequest } from '@/services/auth';
import { BASE_URL } from '@/services/api';
import { fonts, lightColors as L, radius } from '@/constants/theme';

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const MONTH_KEYS = ['01','02','03','04','05','06','07','08','09','10','11','12'];
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 100 }, (_, i) => String(CURRENT_YEAR - i));

const ITEM_H = 44;
const BLOB   = 300;

type FieldErrors = Record<string, string[]>;

// ─── Shared light-themed input (always cream/white palette) ───────────────────

function AuthInput({ label, error, style, onFocus, onBlur, ...rest }: {
  label?: string;
  error?: string;
} & TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={ai.wrapper}>
      {label ? <Text style={ai.label}>{label}</Text> : null}
      <TextInput
        {...rest}
        style={[ai.input, focused && ai.inputFocused, !!error && ai.inputError, style]}
        placeholderTextColor={L.t3}
        selectionColor={L.teal}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      />
      {error ? <Text style={ai.error}>{error}</Text> : null}
    </View>
  );
}

const ai = StyleSheet.create({
  wrapper: { gap: 4 },
  label: { fontFamily: fonts.body, fontSize: 13, fontWeight: '500', color: L.t2 },
  input: {
    backgroundColor: L.surface,
    borderWidth: 1,
    borderColor: L.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 0,
    height: 52,
    fontFamily: fonts.body,
    fontSize: 15,
    color: L.t1,
  },
  inputFocused: { borderColor: L.teal },
  inputError:   { borderColor: L.red },
  error: { fontFamily: fonts.body, fontSize: 12, color: L.red },
});

// ─── Wheel column ─────────────────────────────────────────────────────────────

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
    <View style={wh.wrap}>
      <FlatList
        ref={ref}
        data={padded}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ index }) => {
          const ai = index - 2;
          const isSel = ai === activeIdx;
          const text = ai >= 0 && ai < items.length ? (labels ? labels[ai] : items[ai]) : '';
          return (
            <View style={wh.item}>
              <Text style={[wh.label, isSel && wh.labelSel]}>{text}</Text>
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
    </View>
  );
}

const wh = StyleSheet.create({
  wrap: { flex: 1, height: ITEM_H * 5, overflow: 'hidden' },
  item: { height: ITEM_H, justifyContent: 'center', alignItems: 'center' },
  label:    { fontFamily: fonts.body, color: L.t3, fontSize: 15 },
  labelSel: { fontFamily: fonts.body, color: L.t1, fontWeight: '600', fontSize: 16 },
});

// ─── DatePickerField ──────────────────────────────────────────────────────────

interface DatePickerFieldProps {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}

function DatePickerField({ value, onChange, error }: DatePickerFieldProps) {
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

// ─── RegisterScreen ───────────────────────────────────────────────────────────

export default function RegisterScreen() {
  const { top } = useSafeAreaInsets();
  const [username,        setUsername]        = useState('');
  const [email,           setEmail]           = useState('');
  const [dob,             setDob]             = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors,          setErrors]          = useState<FieldErrors>({});
  const [submitting,      setSubmitting]      = useState(false);

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
    }
    // Reached on both paths: the `catch` records the errors and stops there.
    // Not a `finally` — React Compiler bails on any component containing one.
    setSubmitting(false);
  }

  const fe = (field: string) => errors[field]?.[0];
  const globalError = errors.non_field_errors?.[0] ?? errors.detail?.[0];

  return (
    <KeyboardAvoidingView
      style={rs.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Decorative blobs */}
      <View style={rs.blobTL} />
      <View style={rs.blobBR} />

      <ScrollView
        contentContainerStyle={[rs.container, { paddingTop: top + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: 'transparent' }}
      >
        <Text style={rs.title}>Create account</Text>

        {globalError ? (
          <View style={rs.globalError}>
            <Text style={rs.globalErrorText}>{globalError}</Text>
          </View>
        ) : null}

        <View style={rs.form}>
          <AuthInput
            label="Username"
            placeholder="yourhandle"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            error={fe('username')}
          />
          <AuthInput
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
          <AuthInput
            label="Password"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            error={fe('password')}
          />
          <AuthInput
            label="Confirm password"
            placeholder="••••••••"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            error={fe('confirm_password')}
          />
        </View>

        <Pressable
          onPress={handleRegister}
          disabled={submitting}
          style={({ pressed }) => [rs.btn, (pressed || submitting) && rs.btnDimmed]}
          accessibilityRole="button"
          accessibilityLabel="Create Account"
        >
          {submitting
            ? <ActivityIndicator color={L.bg} size="small" />
            : <Text style={rs.btnLabel}>Create Account</Text>
          }
        </Pressable>

        <View style={rs.signinRow}>
          <Text style={rs.signinText}>Already have an account? </Text>
          <Pressable onPress={() => router.replace('/login')} hitSlop={8}>
            <Text style={rs.signinLink}>Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const rs = StyleSheet.create({
  root: { flex: 1, backgroundColor: L.bg },

  blobTL: {
    position: 'absolute',
    top: -BLOB * 0.35,
    left: -BLOB * 0.28,
    width: BLOB,
    height: BLOB,
    borderRadius: BLOB / 2,
    backgroundColor: L.surface2,
  },
  blobBR: {
    position: 'absolute',
    bottom: -BLOB * 0.35,
    right: -BLOB * 0.28,
    width: BLOB,
    height: BLOB,
    borderRadius: BLOB / 2,
    backgroundColor: '#E8E4F5',
  },

  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 28,
    color: L.t1,
    marginBottom: 28,
  },
  globalError: {
    backgroundColor: `${L.red}18`,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: L.red,
    padding: 12,
    marginBottom: 20,
  },
  globalErrorText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: L.red,
    textAlign: 'center',
  },
  form: { gap: 16, marginBottom: 28 },

  btn: {
    backgroundColor: L.teal,
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  btnDimmed: { opacity: 0.65 },
  btnLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 17,
    color: L.bg,
  },

  signinRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 28,
  },
  signinText: { fontFamily: fonts.body, fontSize: 14, color: L.t2 },
  signinLink: { fontFamily: fonts.body, fontSize: 14, color: L.teal, fontWeight: '600' },
});
