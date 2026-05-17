import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';

import { useAuth } from '@/context/AuthContext';

export default function Index() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.root}>
        <ActivityIndicator color="#00b4a6" size="large" />
      </View>
    );
  }

  return <Redirect href={isAuthenticated ? '/(tabs)/map' : '/welcome'} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
});
