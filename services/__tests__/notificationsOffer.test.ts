/**
 * When the map asks for notification permission.
 *
 * Nothing in the normal flow used to ask, so a new install never registered for
 * push and never received a Hi, a friend request or club chat. The map now asks
 * once per install — but only when iOS can still show its dialog, and never at
 * the same moment as the location question, since both use one explainer sheet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { markNotificationsOffered, shouldOfferNotifications } from '../notifications';
import { check } from '../permissions';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2 },
}));
jest.mock('../api', () => ({ api: { patch: jest.fn(), post: jest.fn(), get: jest.fn() } }));
jest.mock('../device', () => ({ registerDevice: jest.fn() }));
jest.mock('../permissions', () => ({ check: jest.fn() }));

function states(notifications: string, location: string) {
  jest.mocked(check).mockImplementation(async (key) => ({
    key, state: (key === 'notifications' ? notifications : location) as any, caveat: null,
  }));
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('offers on a fresh install once location has been answered', async () => {
  states('undetermined', 'granted');
  await expect(shouldOfferNotifications()).resolves.toBe(true);
});

it('waits while the location question is still open', async () => {
  states('undetermined', 'undetermined');
  await expect(shouldOfferNotifications()).resolves.toBe(false);
});

it('offers only once per install', async () => {
  states('undetermined', 'granted');
  await markNotificationsOffered();
  await expect(shouldOfferNotifications()).resolves.toBe(false);
});

it('never nags someone who already answered iOS', async () => {
  for (const answered of ['granted', 'denied', 'blocked']) {
    states(answered, 'granted');
    await expect(shouldOfferNotifications()).resolves.toBe(false);
  }
});
