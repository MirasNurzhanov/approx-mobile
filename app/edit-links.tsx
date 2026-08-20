import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/Card';
import { IconBack, IconClose } from '@/components/ui/icons';
import { iconForPlatform, platformName } from '@/components/ui/platformMeta';
import {
  addLink,
  deleteLink,
  fetchLinks,
  hostOf,
  linkErrorMessage,
  reorderLinks,
  HANDLE_PLATFORMS,
  MAX_LINKS,
  type ProfileLink,
} from '@/services/links';
import { fonts, radius, type as typography } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// Add, remove and reorder profile links.
//
// Reordering is up/down buttons rather than drag-and-drop on purpose: a drag
// handle is unusable with a screen reader and awkward at large text sizes,
// whereas a pair of buttons has a real accessible name and a 44pt target.

export default function EditLinksScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { top, bottom } = useSafeAreaInsets();

  const [links, setLinks] = useState<ProfileLink[] | null>(null);
  const [value, setValue] = useState('');
  const [platform, setPlatform] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLinks(await fetchLinks());
    } catch {
      setLinks([]);
      setError('Couldn’t load your links.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const full = (links?.length ?? 0) >= MAX_LINKS;

  async function handleAdd() {
    const trimmed = value.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    setError(null);
    try {
      const created = await addLink(trimmed, platform ?? undefined);
      setLinks((prev) => [...(prev ?? []), created]);
      setValue('');
      setPlatform(null);
    } catch (e) {
      // Server-side validation is the only validation; surface its message
      // verbatim rather than guessing at a friendlier one.
      setError(linkErrorMessage(e));
    }
    // Reached on both paths: the `catch` records the message and stops there.
    // Not a `finally` — React Compiler bails on any component containing one.
    setAdding(false);
  }

  function confirmDelete(link: ProfileLink) {
    Alert.alert(
      'Remove link?',
      `${link.label} will be removed from your profile.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const previous = links;
            setLinks((prev) => (prev ?? []).filter((l) => l.id !== link.id));
            try {
              await deleteLink(link.id);
            } catch {
              setLinks(previous ?? null);
              Alert.alert('Couldn’t remove', 'Please try again.');
            }
          },
        },
      ],
    );
  }

  async function move(index: number, direction: -1 | 1) {
    if (!links) return;
    const target = index + direction;
    if (target < 0 || target >= links.length) return;
    const next = [...links];
    [next[index], next[target]] = [next[target], next[index]];
    setLinks(next);
    try {
      await reorderLinks(next.map((l) => l.id));
    } catch {
      setLinks(links);
      Alert.alert('Couldn’t reorder', 'Please try again.');
    }
  }

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => pressed && styles.pressed}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <IconBack size={22} color={colors.t1} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} accessibilityRole="header">Links</Text>
          <Text style={styles.subtitle}>
            {links === null ? 'Loading…' : `${links.length} of ${MAX_LINKS}`}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {links === null ? (
          <ActivityIndicator color={colors.teal} style={styles.loading} />
        ) : (
          <>
            {links.map((link, index) => {
              const Icon = iconForPlatform(link.platform);
              return (
                <Card key={link.id} style={styles.linkCard}>
                  <View style={styles.linkRow}>
                    <Icon size={18} color={colors.teal} />
                    <View style={styles.linkText}>
                      <Text style={styles.linkLabel} numberOfLines={1}>{link.label}</Text>
                      <Text style={styles.linkHost} numberOfLines={1}>
                        {platformName(link.platform)} · {hostOf(link.url)}
                      </Text>
                    </View>

                    <Pressable
                      onPress={() => move(index, -1)}
                      disabled={index === 0}
                      hitSlop={6}
                      style={({ pressed }) => [styles.moveBtn, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${link.label} up`}
                      accessibilityState={{ disabled: index === 0 }}
                    >
                      <Text style={[styles.moveGlyph, index === 0 && styles.moveDisabled]}>↑</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => move(index, 1)}
                      disabled={index === links.length - 1}
                      hitSlop={6}
                      style={({ pressed }) => [styles.moveBtn, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${link.label} down`}
                      accessibilityState={{ disabled: index === links.length - 1 }}
                    >
                      <Text
                        style={[styles.moveGlyph, index === links.length - 1 && styles.moveDisabled]}
                      >
                        ↓
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => confirmDelete(link)}
                      hitSlop={6}
                      style={({ pressed }) => [styles.moveBtn, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${link.label}`}
                    >
                      <IconClose size={16} color={colors.red} />
                    </Pressable>
                  </View>
                </Card>
              );
            })}

            {links.length === 0 && (
              <Text style={styles.empty}>
                No links yet. Add your Instagram, Spotify, site — anything with an https
                address.
              </Text>
            )}

            {/* ── Add ── */}
            <Text style={styles.sectionLabel}>ADD A LINK</Text>

            <View style={styles.platformRow}>
              {HANDLE_PLATFORMS.map((key) => {
                const Icon = iconForPlatform(key);
                const selected = platform === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setPlatform(selected ? null : key)}
                    style={({ pressed }) => [
                      styles.platformChip,
                      selected && styles.platformChipSelected,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={platformName(key)}
                    accessibilityHint="Lets you enter just a handle instead of a full link"
                  >
                    <Icon size={16} color={selected ? colors.teal : colors.t2} />
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              style={styles.input}
              value={value}
              onChangeText={(t) => { setValue(t); setError(null); }}
              placeholder={platform ? `@handle or full link` : 'https://…'}
              placeholderTextColor={colors.t3}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!full}
              accessibilityLabel={
                platform
                  ? `${platformName(platform)} handle or link`
                  : 'Link address'
              }
              onSubmitEditing={handleAdd}
            />

            {platform && (
              <Text style={styles.hint}>
                {platformName(platform)} selected — you can type just @yourname.
              </Text>
            )}
            {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
            {full && (
              <Text style={styles.hint}>
                You’ve reached the {MAX_LINKS}-link limit. Remove one to add another.
              </Text>
            )}

            <Pressable
              onPress={handleAdd}
              disabled={!value.trim() || adding || full}
              style={({ pressed }) => [
                styles.addBtn,
                (!value.trim() || full) && styles.addBtnDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add link"
              accessibilityState={{ disabled: !value.trim() || adding || full }}
            >
              {adding ? (
                <ActivityIndicator color={colors.bg} size="small" />
              ) : (
                <Text style={styles.addBtnText}>Add link</Text>
              )}
            </Pressable>

            <Text style={styles.footnote}>
              Links are friends-only by default. Change who can see them in
              Privacy &amp; safety.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  loading: { marginTop: 40 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerText: { flex: 1, gap: 2 },
  title: {
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: typography.title,
    color: colors.t1,
  },
  subtitle: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3 },

  linkCard: { padding: 12 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkText: { flex: 1, gap: 2 },
  linkLabel: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: typography.small,
    color: colors.t1,
  },
  linkHost: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t2 },
  moveBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveGlyph: { fontFamily: fonts.body, fontSize: 18, color: colors.t1 },
  moveDisabled: { color: colors.t3, opacity: 0.5 },

  empty: {
    fontFamily: fonts.body,
    fontSize: typography.small,
    lineHeight: typography.small * 1.5,
    color: colors.t2,
    paddingVertical: 12,
  },

  sectionLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
    marginTop: 20,
  },
  platformRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  platformChip: {
    width: 44,
    height: 44,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformChipSelected: { borderColor: colors.tealLine, backgroundColor: colors.tealTint },

  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    fontFamily: fonts.body,
    fontSize: typography.body,
    color: colors.t1,
  },
  hint: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.t3 },
  error: { fontFamily: fonts.body, fontSize: typography.caption, color: colors.red },

  addBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.m,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 4,
  },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: typography.body,
    color: colors.bg,
  },

  footnote: {
    fontFamily: fonts.body,
    fontSize: typography.caption,
    lineHeight: typography.caption * 1.5,
    color: colors.t3,
    marginTop: 12,
  },

  pressed: { opacity: 0.6 },
});
