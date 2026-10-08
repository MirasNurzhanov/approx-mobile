import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/services/api';
import { groupAll } from '@/services/interestCategories';
import { InterestBubbleField } from '@/components/ui/InterestBubbleField';
import { fonts, type ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// ─── What are you into? ───────────────────────────────────────────────────────
// Nine bubbles, one per category, with the interests inside them: tapping one
// grows it into a panel filling the field and the chips are right there. The
// grouping — which interests are in which bubble, and what order the bubbles
// come in — is the server's decision and arrives on every interest as
// `category`; see services/interestCategories.
//
// This screen used to define eight categories of its own and sort 681
// interests into them with a regex over the names, then push a separate
// drill-in step to show them. Most of the catalogue fell through the regex into
// a bucket called "Casual": Sports showed a fraction of its 186 entries, and
// there was no bubble at all for Fitness, Travel or Entertainment.

interface Interest {
  id: number;
  name: string;
  icon: string;
  category?: string;
  category_label?: string;
}

export default function InterestsSetupScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const { colors: L } = useTheme();
  const s = useMemo(() => makeStyles(L), [L]);

  const [interests, setInterests] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every failure here used to collapse into one sentence — "Could not load
  // interests" — and an empty catalogue produced no message at all: nine
  // bubbles reading 0, which looks exactly like a screen that has decided you
  // are interested in nothing. The status and the count are the two facts that
  // tell those apart, so both are surfaced and both are logged.
  function load() {
    api.get<Interest[]>('/api/interests/')
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : [];
        console.log('[Interests] /api/interests/ →', list.length, 'interests');
        setInterests(list);
      })
      .catch(e => {
        console.log(
          '[Interests] load failed:',
          e?.response?.status,
          JSON.stringify(e?.response?.data),
        );
        const status = e?.response?.status;
        setError(
          status === 401
            ? 'Your session has expired. Sign in again to choose interests.'
            : `Could not load interests${status ? ` (${status})` : ''}. Please try again.`,
        );
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function retry() {
    setError(null);
    setLoading(true);
    load();
  }

  const groups = groupAll(interests);

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleContinue() {
    setSaving(true);
    try {
      await api.post('/api/interests/select/', { interest_ids: Array.from(selected) });
    } catch {}
    // The `catch` swallows everything, so this always runs. Deliberately not a
    // `finally` — React Compiler bails on any component containing one.
    setSaving(false);
    router.replace('/onboarding-profession');
  }

  return (
    <View style={[s.root, { paddingTop: top }]}>
      <View style={s.header}>
        <Text style={s.title}>What are you into?</Text>
        <Text style={s.subtitle}>
          Tap a bubble to open it. Find people who share your passions.
        </Text>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={L.coral} size="large" />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable
            onPress={retry}
            style={({ pressed }) => [s.retryBtn, pressed && s.dimmed]}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={s.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      ) : interests.length === 0 ? (
        // Loaded, succeeded, and returned nothing. Said out loud, because the
        // alternative is nine bubbles reading 0 and no way to tell whether the
        // catalogue is empty or the screen is broken.
        <View style={s.center}>
          <Text style={s.errorText}>The interest catalogue came back empty.</Text>
          <Text style={s.emptyHint}>
            Nothing to choose from yet — the server has no interests seeded.
          </Text>
          <Pressable
            onPress={retry}
            style={({ pressed }) => [s.retryBtn, pressed && s.dimmed]}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={s.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        // The app's own theme, like the rest of sign-up: a device already set
        // to dark gets a dark onboarding.
        <InterestBubbleField
          groups={groups}
          selected={selected}
          onToggle={toggle}
          palette={L}
        />
      )}

      <View style={[s.footer, { paddingBottom: bottom + 16 }]}>
        <Text style={s.footerCount}>
          {selected.size > 0 ? `${selected.size} selected` : ' '}
        </Text>
        <Pressable
          onPress={handleContinue}
          disabled={selected.size === 0 || saving}
          style={({ pressed }) => [
            s.continueBtn,
            (selected.size === 0 || pressed) && s.dimmed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          {saving
            ? <ActivityIndicator color={L.bg} size="small" />
            : <Text style={s.continueBtnLabel}>Continue</Text>
          }
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (L: ColorPalette) => StyleSheet.create({
  root:   { flex: 1, backgroundColor: L.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyHint: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: L.t2,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: L.border,
    backgroundColor: L.surface,
  },
  retryLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: L.t1,
  },

  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8, gap: 8 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 30,
    color: L.t1,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: L.t2,
  },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: L.border,
    backgroundColor: L.bg,
  },
  footerCount: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: L.t2,
    textAlign: 'center',
  },
  continueBtn: {
    backgroundColor: L.coral,
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 17,
    color: L.bg,
  },

  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: L.red,
    textAlign: 'center',
  },
  dimmed: { opacity: 0.5 },
});
