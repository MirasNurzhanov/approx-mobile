import { Redirect } from 'expo-router';

// There is no notifications screen any more: alerts are the first tab of Chat,
// where they sit alongside the requests they used to be separated from. This
// shim keeps anything still pointing at the old path (a saved deep link, a push
// payload) landing somewhere real.
export default function NotificationsRedirect() {
  return <Redirect href="/(tabs)/chat" />;
}
