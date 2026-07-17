import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

const COLOR_TEAL = '#00b4a6';

// Web fallback — react-native-maps is native-only (Android/iOS), so the live
// map is unavailable in the browser. Metro picks this file for web builds.
export default function MapScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.iconRing}>
        <Ionicons name="map-outline" size={36} color={COLOR_TEAL} />
      </View>
      <Text style={styles.title}>Map is mobile-only</Text>
      <Text style={styles.subtitle}>
        The live AURA map needs the iOS or Android app. Open AURA on your phone to see people and
        stories around you.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  iconRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(0,180,166,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,180,166,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  subtitle: { color: '#666', fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 320 },
});
