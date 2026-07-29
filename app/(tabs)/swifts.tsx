import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { Speedometer } from '@/components/Speedometer';
import { SwiftsFeed } from '@/components/swifts/SwiftsFeed';

// Swifts occupies the nav wedge that used to be Alerts. The feed draws edge to
// edge behind the status bar, so this screen is only the frame: content, then
// the nav arc on top of it.
export default function SwiftsScreen() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SwiftsFeed />
      <Speedometer />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
});
