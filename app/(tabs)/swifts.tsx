import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

import { Speedometer } from '@/components/Speedometer';
import { SwiftsFeed } from '@/components/swifts/SwiftsFeed';

export default function SwiftsScreen() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <View style={styles.contentArea} pointerEvents="none">
        <SwiftsFeed />
      </View>

      <Speedometer />

      {/* Coming Soon overlay */}
      <View style={styles.comingSoonOverlay} pointerEvents="none">
        <Text style={styles.comingSoonTitle}>Swifts — Coming Soon 🔒</Text>
        <Text style={styles.comingSoonSubtitle}>We're working on something exciting</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  contentArea: { flex: 1 },
  comingSoonOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 10, 10, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    gap: 10,
  },
  comingSoonTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  comingSoonSubtitle: {
    color: '#555',
    fontSize: 14,
    textAlign: 'center',
  },
});
