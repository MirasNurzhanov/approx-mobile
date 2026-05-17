import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={() => null}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="map" />
      <Tabs.Screen name="profile" />
      <Tabs.Screen name="chat" />
      <Tabs.Screen name="notifications" />
      <Tabs.Screen name="quests" />
      <Tabs.Screen name="settings" />
      <Tabs.Screen name="index"   options={{ href: null }} />
      <Tabs.Screen name="explore" options={{ href: null }} />
    </Tabs>
  );
}
