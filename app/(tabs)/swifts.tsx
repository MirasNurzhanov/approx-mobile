import { StyleSheet, View } from 'react-native';

import { ApproxNav } from '@/components/ApproxNav';
import { SwiftsFeed } from '@/components/swifts/SwiftsFeed';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

/**
 * The Swifts tab.
 *
 * This screen carried a "Coming Soon" scrim and `pointerEvents="none"` over the
 * feed while the section was a shell. Both are gone now that the feed, the
 * composer and the location reveal are real — the scrim in particular had to
 * go with them, since a feed nobody can touch cannot have a button pressed on
 * it.
 */
export default function SwiftsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.root}>
      <View style={styles.contentArea}>
        <SwiftsFeed />
      </View>

      <ApproxNav />
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  contentArea: { flex: 1 },
});
