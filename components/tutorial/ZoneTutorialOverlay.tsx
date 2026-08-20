import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NAV_ARC_R_OUT } from '@/components/navArc';
import { Button } from '@/components/ui/Button';
import { fonts, lightColors, radius } from '@/constants/theme';

/** Speedometer's own expanded height (see components/Speedometer.tsx:
 *  `SVG_H = R_OUT + 6`) — the panel has to clear this, not just the safe-area
 *  inset, or its buttons sit in the same screen region as the navbar and,
 *  since the navbar draws on top by design (see ZONE_TUTORIAL_Z_INDEX below),
 *  end up hidden behind it. Using the expanded height even though the arc may
 *  be collapsed to a slim bar is deliberate — an overestimate here is a bit
 *  of extra gap, an underestimate is a swallowed tap. */
const NAV_ARC_H = NAV_ARC_R_OUT + 6;

/**
 * Below the Speedometer's own zIndex (100, see components/Speedometer.tsx)
 * so the navbar it is pointing at draws on top of this and stays bright —
 * the scrim only has to darken the screen behind it, not the thing it is
 * teaching. Still "high" against ordinary screen content, which is what the
 * spec means by it.
 */
export const ZONE_TUTORIAL_Z_INDEX = 90;

export function ZoneTutorialOverlay({
  onDismiss,
  onTakeMeThere,
}: {
  onDismiss: () => void;
  onTakeMeThere: () => void;
}) {
  const { top, bottom } = useSafeAreaInsets();

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} accessible accessibilityViewIsModal>
      <View style={[styles.banner, { top: top + 12 }]}>
        <Text style={styles.bannerText}>
          🎵 Manage your music zone and who can see you in Settings
        </Text>
      </View>

      <View style={[styles.panel, { bottom: bottom + NAV_ARC_H + 20 }]}>
        <Text style={styles.text}>Control your zone radius and music in Settings</Text>
        <View style={styles.buttonRow}>
          <Button label="Got it" variant="secondary" onPress={onDismiss} size="lg" />
          <Button label="Take me there" onPress={onTakeMeThere} size="lg" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: ZONE_TUTORIAL_Z_INDEX,
    elevation: 9,
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
