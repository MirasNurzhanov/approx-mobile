import { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import axios from 'axios';
import { router } from 'expo-router';
import { loginRequest } from '@/services/auth';
import { BASE_URL } from '@/services/api';

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const MONTH_KEYS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 100 }, (_, i) => String(CURRENT_YEAR - i));

const ITEM_H = 44;

type FieldErrors = Record<string, string[]>;

// --------------- Wheel column ---------------

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
      <View pointerEvents="none" style={wheel.indicator} />
    </View>
  );
}

const wheel = StyleSheet.create({
  wrap: { flex: 1, height: ITEM_H * 5, overflow: 'hidden' },
  item: { height: ITEM_H, justifyContent: 'center', alignItems: 'center' },
  label: { color: '#444', fontSize: 15 },
  labelSel: { color: '#00b4a6', fontWeight: '700', fontSize: 16 },
  indicator: {
    position: 'absolute',
    top: ITEM_H * 2,
    left: 2,
    right: 2,
    height: ITEM_H,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#00b4a6',
  },
});

// --------------- DatePickerField ---------------

interface DatePickerFieldProps {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}

function DatePickerField({ value, onChange, error }: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);

  const defaultDayIdx = 0;
  const defaultMonthIdx = 0;
  const defaultYearIdx = 20;

  const [dayIdx, setDayIdx] = useState(() => {
    if (!value) return defaultDayIdx;
    const d = value.split('-')[2];
    const i = DAYS.indexOf(d);
    return i >= 0 ? i : defaultDayIdx;
  });
  const [monthIdx, setMonthIdx] = useState(() => {
    if (!value) return defaultMonthIdx;
    const m = value.split('-')[1];
    const i = MONTH_KEYS.indexOf(m);
    return i >= 0 ? i : defaultMonthIdx;
  });
  const [yearIdx, setYearIdx] = useState(() => {
    if (!value) return defaultYearIdx;
    const y = value.split('-')[0];
    const i = YEARS.indexOf(y);
    return i >= 0 ? i : defaultYearIdx;
  });

  const displayValue = value
    ? `${DAYS[dayIdx]} ${MONTH_LABELS[monthIdx]} ${YEARS[yearIdx]}`
    : '';

  function handleDone() {
    onChange(`${YEARS[yearIdx]}-${MONTH_KEYS[monthIdx]}-${DAYS[dayIdx]}`);
    setOpen(false);
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.input, styles.dateInput, error ? styles.inputError : null]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={displayValue ? styles.dateText : styles.datePlaceholder}>
          {displayValue || 'Date of birth'}
        </Text>
      </TouchableOpacity>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Date of birth</Text>
            <View style={styles.wheelRow}>
              <Wheel items={DAYS} selectedIdx={dayIdx} onSelect={setDayIdx} />
              <Wheel items={MONTH_KEYS} labels={MONTH_LABELS} selectedIdx={monthIdx} onSelect={setMonthIdx} />
              <Wheel items={YEARS} selectedIdx={yearIdx} onSelect={setYearIdx} />
            </View>
            <View style={styles.modalBtns}>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDone} style={styles.doneBtn}>
                <Text style={styles.doneText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// --------------- RegisterScreen ---------------

export default function RegisterScreen() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleRegister() {
    console.log('[Register] handleRegister called');
    console.log('[Register] form values:', { username, email, dob, password, confirmPassword });
    setErrors({});

    if (password !== confirmPassword) {
      setErrors({ confirm_password: ['Passwords do not match'] });
      return;
    }
    if (!dob) {
      setErrors({ date_of_birth: ['Date of birth is required'] });
      return;
    }

    console.log('[Register] validation passed, calling API...');
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
      console.log('[Register] API error:', (err as any)?.response?.status, JSON.stringify((err as any)?.response?.data));
      console.log('[Register] full error:', (err as any)?.message);
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

  const fe = (field: string) => errors[field]?.[0] ?? null;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>AURA</Text>
        <Text style={styles.tagline}>Create your account</Text>

        {errors.non_field_errors ? (
          <Text style={[styles.errorText, styles.centerError]}>{errors.non_field_errors[0]}</Text>
        ) : null}
        {errors.detail ? (
          <Text style={[styles.errorText, styles.centerError]}>{errors.detail[0]}</Text>
        ) : null}

        <TextInput
          style={[styles.input, fe('username') ? styles.inputError : null]}
          placeholder="Username"
          placeholderTextColor="#555"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {fe('username') ? <Text style={styles.errorText}>{fe('username')}</Text> : null}

        <TextInput
          style={[styles.input, fe('email') ? styles.inputError : null]}
          placeholder="Email"
          placeholderTextColor="#555"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {fe('email') ? <Text style={styles.errorText}>{fe('email')}</Text> : null}

        <DatePickerField value={dob} onChange={setDob} error={fe('date_of_birth')} />

        <TextInput
          style={[styles.input, fe('password') ? styles.inputError : null]}
          placeholder="Password"
          placeholderTextColor="#555"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {fe('password') ? <Text style={styles.errorText}>{fe('password')}</Text> : null}

        <TextInput
          style={[styles.input, fe('confirm_password') ? styles.inputError : null]}
          placeholder="Confirm password"
          placeholderTextColor="#555"
          secureTextEntry
          value={confirmPassword}
          onChangeText={setConfirmPassword}
        />
        {fe('confirm_password') ? <Text style={styles.errorText}>{fe('confirm_password')}</Text> : null}

        <TouchableOpacity
          style={[styles.button, submitting ? styles.buttonDisabled : null]}
          onPress={handleRegister}
          disabled={submitting}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>{submitting ? 'Creating account…' : 'Create account'}</Text>
        </TouchableOpacity>

        <View style={styles.loginRow}>
          <Text style={styles.loginPrompt}>Already have an account?{'  '}</Text>
          <TouchableOpacity onPress={() => router.replace('/login')}>
            <Text style={styles.loginLink}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0a0a0a' },
  container: {
    flexGrow: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    paddingTop: 60,
    paddingBottom: 40,
  },
  logo: {
    fontSize: 52,
    color: '#00b4a6',
    fontWeight: '800',
    letterSpacing: 10,
    marginBottom: 8,
  },
  tagline: {
    color: '#555',
    fontSize: 14,
    marginBottom: 36,
    letterSpacing: 1,
  },
  input: {
    width: '100%',
    backgroundColor: '#111',
    color: '#fff',
    padding: 16,
    borderRadius: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    fontSize: 15,
  },
  inputError: { borderColor: '#e55', marginBottom: 4 },
  dateInput: { justifyContent: 'center' },
  dateText: { color: '#fff', fontSize: 15 },
  datePlaceholder: { color: '#555', fontSize: 15 },
  errorText: { color: '#e55', fontSize: 12, marginBottom: 10, alignSelf: 'flex-start', paddingLeft: 4 },
  centerError: { alignSelf: 'center', textAlign: 'center', marginBottom: 12 },
  button: {
    width: '100%',
    backgroundColor: '#00b4a6',
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16, letterSpacing: 0.5 },
  loginRow: { flexDirection: 'row', marginTop: 28, alignItems: 'center' },
  loginPrompt: { color: '#555', fontSize: 14 },
  loginLink: { color: '#00b4a6', fontSize: 14, fontWeight: '600' },
  // Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#111',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  wheelRow: { flexDirection: 'row', columnGap: 4 },
  modalBtns: { flexDirection: 'row', columnGap: 12, marginTop: 16 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#1a1a1a', alignItems: 'center' },
  cancelText: { color: '#777', fontWeight: '600' },
  doneBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#00b4a6', alignItems: 'center' },
  doneText: { color: '#fff', fontWeight: '700' },
});
