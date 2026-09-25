import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconCheck } from '@/components/ui/icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import {
  fonts,
  getTheme,
  radius,
  type ColorPalette,
  type ThemeId,
  type ThemeOption,
} from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { contentColumn, useLayoutSize } from '@/hooks/useLayout';
import { useScreenTopInset } from '@/hooks/useScreenTopInset';

// Settings → Theme.
//
// A choice applies the moment it is tapped, and this screen is itself drawn in
// the active theme — so the screen is the preview, and each tile only has to
// show its palette, not a mock-up of the app wearing it.

const GROUPS: { label: string; ids: ThemeId[] }[] = [
  { label: 'CLASSIC', ids: ['light', 'dark'] },
  { label: 'PALETTES', ids: ['sage', 'lagoon', 'orchid', 'porcelain'] },
];

/** Two to a row. Explicit rows rather than a wrapping row of percentage-wide
 *  tiles, whose widths stop adding up once a gap is taken out of them. */
function pairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

function ThemeTile({ theme, selected, onPress }: {
  theme: ThemeOption;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${theme.name}. ${theme.description}`}
      style={({ pressed }) => [styles.tile, selected && styles.tileSelected, pressed && styles.pressed]}
    >
      <View style={styles.swatches}>
        {theme.swatches.map((hex) => (
          <View key={hex} style={[styles.swatch, { backgroundColor: hex }]} />
        ))}
      </View>
      <View style={styles.tileText}>
        <View style={styles.tileTitleRow}>
          <Text style={styles.tileName}>{theme.name}</Text>
          {selected && (
            <View style={styles.check}>
              <IconCheck size={14} color={colors.bg} />
            </View>
          )}
        </View>
        <Text style={styles.tileDescription}>{theme.description}</Text>
      </View>
    </Pressable>
  );
}

export default function AppearanceScreen() {
  const { colors, themeId, setTheme } = useTheme();
  const styles = makeStyles(colors);
  const { bottom } = useSafeAreaInsets();
  const top = useScreenTopInset();
  const layout = useLayoutSize();

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <ScreenHeader title="Theme" subtitle="Changes the whole app, straight away" />

      <ScrollView
        contentContainerStyle={[
          contentColumn(layout),
          { paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {GROUPS.map((group) => (
          <View key={group.label} style={styles.section}>
            <Text style={styles.sectionLabel}>{group.label}</Text>
            <View style={styles.grid}>
              {pairs(group.ids.map((id) => getTheme(id))).map((row) => (
                <View key={row.map((theme) => theme.id).join('-')} style={styles.row}>
                  {row.map((theme) => (
                    <ThemeTile
                      key={theme.id}
                      theme={theme}
                      selected={theme.id === themeId}
                      onPress={() => setTheme(theme.id)}
                    />
                  ))}
                  {row.length === 1 && <View style={styles.spacer} />}
                </View>
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.note}>
          The palette themes are all light ones: the map, the keyboard and the
          home-screen icon use their light versions.
        </Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.7 },

  section: { marginBottom: 28 },
  sectionLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.t3,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  grid: { gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  spacer: { flex: 1 },

  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    // The same width selected or not, so choosing a theme does not nudge the
    // tile's contents by a point.
    borderWidth: 2,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tileSelected: { borderColor: colors.teal },
  swatches: {
    flexDirection: 'row',
    height: 56,
    // Every palette ends in a near-white, which would otherwise run straight
    // into a white tile with no edge between them.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  swatch: { flex: 1 },
  tileText: { padding: 12, gap: 4 },
  tileTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tileName: {
    flexShrink: 1,
    fontFamily: fonts.display,
    fontWeight: '600',
    fontSize: 16,
    color: colors.t1,
  },
  tileDescription: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.t2,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },

  note: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.t3,
  },
});
