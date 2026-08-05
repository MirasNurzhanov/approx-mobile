import { StyleSheet, Text, View } from 'react-native';

import { Speedometer } from '@/components/Speedometer';
import { SwiftsFeed } from '@/components/swifts/SwiftsFeed';
import { fonts } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

export default function SwiftsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.root}>
      <View style={styles.contentArea} pointerEvents="none">
        <SwiftsFeed />
      </View>

      <Speedometer />

      {/* Coming Soon overlay */}
      <View style={styles.overlay} pointerEvents="none">
        <Text style={styles.overlayTitle}>Swifts — Coming Soon 🔒</Text>
        <Text style={styles.overlaySubtitle}>We're working on something exciting</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  contentArea: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg + 'CC',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    gap: 10,
  },
  overlayTitle: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 22,
    color: colors.t1,
    textAlign: 'center',
  },
  overlaySubtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.t2,
    textAlign: 'center',
  },
});
