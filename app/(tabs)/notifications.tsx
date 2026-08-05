import { Redirect } from 'expo-router';

// The Alerts tab is gone from the nav arc — its wedge is Swifts now, and the
// feed itself is the first tab inside Chat. This shim only exists so anything
// still pointing at the old tab path lands somewhere real.
export default function NotificationsTabRedirect() {
  return <Redirect href="/(tabs)/chat" />;
}