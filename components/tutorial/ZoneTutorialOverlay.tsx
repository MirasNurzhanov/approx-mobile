import { Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { useNavHeight } from '@/hooks/useNavMetrics';
import { fonts, lightColors, radius } from '@/constants/theme';

/**
 * Above the nav's own zIndex — 100, which the wheel uses — so the scrim covers
 * the navbar rather than being cut through by it.
 *
 * This alone is not enough, which is why the overlay is a `Modal`. On the
 * default nav style the bar is the *navigator's* native tab bar, drawn by
 * UIKit / Android outside this screen's view tree entirely; no zIndex set from
 * inside a screen can reach over it. A modal gets its own window, so it clears
 * both navs. The zIndex stays correct for the wheel in case the overlay is
 * ever rendered inline again.
 */
export const ZONE_TUTORIAL_Z_INDEX = 110;

export function ZoneTutorialOverlay({
  onDismiss,
  onTakeMeThere,
}: {
  onDismiss: () => void;
  onTakeMeThere: () => void;
}) {
  const { top, bottom } = useSafeAreaInsets();
  // The panel still clears the nav even though the scrim now covers it: the
  // navbar is what the copy is naming, so the buttons should sit above it
  // rather than on top of it. Measured against the nav at full height even
  // though the wheel may be collapsed to a slim bar — an overestimate here is
  // a bit of extra gap, an underestimate is a panel sitting on the thing it is
  // pointing at.
  const navHeight = useNavHeight();

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={[StyleSheet.absoluteFill, styles.root]} accessible accessibilityViewIsModal>
        <View style={[styles.banner, { top: top + 12 }]}>
          <Text style={styles.bannerText}>
            🎵 Manage your music zone and who can see you in Settings
          </Text>
        </View>

        <View style={[styles.panel, { bottom: bottom + navHeight + 20 }]}>
          <Text style={styles.text}>Control your zone radius and music in Settings</Text>
          <View style={styles.buttonRow}>
            <Button label="Got it" variant="secondary" onPress={onDismiss} size="lg" />
            <Button label="Take me there" onPress={onTakeMeThere} size="lg" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: ZONE_TUTORIAL_Z_INDEX,
    // Android orders siblings by elevation before zIndex, so this has to clear
    // the wheel's 10 as well.
    elevation: 11,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.l,
    backgroundColor: lightColors.coral,
  },
  bannerText: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    // The banner itself is coral, not the scrim — its own text needs the
    // light palette's background colour for the same reason the panel text
    // below needs it against the scrim: guaranteed contrast whatever theme
    // the app is in.
    color: lightColors.bg,
  },
  panel: {
    position: 'absolute',
    left: 24,
    right: 24,
    gap: 16,
    alignItems: 'center',
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
    color: lightColors.bg,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
});
