import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { api } from '../api';
import { BACKGROUND_LOCATION_TASK, reportLocationNow } from '../backgroundLocation';
import { reportLocation } from '../location';
import { getCachedGhostMode } from '../privacy';

jest.mock('expo-constants', () => ({ appOwnership: null }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-location', () => ({
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
jest.mock('expo-notifications', () => ({ scheduleNotificationAsync: jest.fn() }));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(),
}));
jest.mock('../api', () => ({ api: { get: jest.fn() } }));
jest.mock('../location', () => ({ reportLocation: jest.fn() }));
jest.mock('../privacy', () => ({ getCachedGhostMode: jest.fn() }));

const task = jest.mocked(TaskManager.defineTask).mock.calls[0][1];
const location: Location.LocationObject = {
  coords: {
    latitude: 43.25, longitude: 76.9, accuracy: 10, speed: 1,
    altitude: null, altitudeAccuracy: null, heading: null,
  },
  timestamp: 1_000,
};

function deliver(error: TaskManager.TaskManagerError | null, locations = [location]) {
  return task({
    data: { locations },
    error,
    executionInfo: { eventId: 'test-event', taskName: BACKGROUND_LOCATION_TASK },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  location.timestamp = Date.now();
  Platform.OS = 'ios';
  jest.mocked(getCachedGhostMode).mockResolvedValue(false);
  jest.mocked(reportLocation).mockResolvedValue(true);
  jest.mocked(api.get).mockResolvedValue({ data: [] });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('background location task errors', () => {
  it('does not infer entry from cached nearby users after an upload failure', async () => {
    jest.mocked(reportLocation).mockRejectedValueOnce(new Error('offline'));
    jest.mocked(api.get).mockResolvedValue({ data: [
      { username: 'friend', distance_km: 0, music_zone_radius: 50, zone_audio_url: 'track' },
    ] });
    await deliver(null);
    expect(api.get).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('uses the newest measured fix even when the batch is out of order', async () => {
    await deliver(null, [location, { ...location, timestamp: location.timestamp - 60_000 }]);
    expect(reportLocation).toHaveBeenCalledWith(
      { latitude: 43.25, longitude: 76.9 }, 1, 10, location.timestamp,
    );
  });

  it('ignores batches without a valid measurement timestamp', async () => {
    await deliver(null, [{ ...location, timestamp: NaN }]);
    expect(reportLocation).not.toHaveBeenCalled();
  });

  it.each([0, '0'])('handles iOS location-unknown code %p without a LogBox', async (code) => {
    await deliver({ code, message: 'Error Domain=kCLErrorDomain Code=0 "(null)"' });

    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(reportLocation).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('processes the next valid fix after a temporary failure', async () => {
    await deliver({ code: 0, message: 'Error Domain=kCLErrorDomain Code=0 "(null)"' }, []);
    await deliver(null);

    expect(console.error).not.toHaveBeenCalled();
    expect(reportLocation).toHaveBeenCalledTimes(1);
    expect(reportLocation).toHaveBeenCalledWith(
      { latitude: 43.25, longitude: 76.9 }, 1, 10, location.timestamp,
    );
    expect(api.get).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it.each([
    { code: 1, message: 'Error Domain=kCLErrorDomain Code=1 "denied"' },
    { code: 2, message: 'Error Domain=kCLErrorDomain Code=2 "network"' },
    { code: 0, message: 'Error Domain=OtherDomain Code=0 "failure"' },
    { code: 0, message: 'Error Domain=OtherDomain Code=0 UserInfo={Error Domain=kCLErrorDomain Code=0}' },
    { code: 0, message: 'Error Domain=kCLErrorDomain Code=01 "failure"' },
    { code: 0, message: 'Unexpected task failure' },
  ])('keeps other failures visible: $message', async (error) => {
    await deliver(error);

    expect(console.error).toHaveBeenCalledWith('[BG Location] task error:', error.message);
    expect(reportLocation).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('does not apply the iOS exception on Android', async () => {
    Platform.OS = 'android';
    const error = { code: 0, message: 'Error Domain=kCLErrorDomain Code=0 "(null)"' };
    await deliver(error);

    expect(console.error).toHaveBeenCalledWith('[BG Location] task error:', error.message);
  });
});

// A phone locked straight after opening the app, before the map's first report,
// used to stay silent about a friend's music zone it was standing in: the
// background task only reports after the phone has moved.
describe('reportLocationNow — one report on leaving the app', () => {
  beforeEach(() => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
  });

  it('reports a recent fix without waiting for a new one', async () => {
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(location);
    await expect(reportLocationNow()).resolves.toBe(true);
    expect(reportLocation).toHaveBeenCalledWith(
      { latitude: 43.25, longitude: 76.9 }, 1, 10, location.timestamp,
    );
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('asks for a fresh fix when the last one is too old', async () => {
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(null);
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue(location);
    await expect(reportLocationNow()).resolves.toBe(true);
    expect(Location.getLastKnownPositionAsync).toHaveBeenCalledWith({ maxAge: 60_000 });
    expect(reportLocation).toHaveBeenCalled();
  });

  it('sends nothing without location permission or a fix', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'denied' } as never);
    await expect(reportLocationNow()).resolves.toBe(false);
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(null);
    jest.mocked(Location.getCurrentPositionAsync).mockRejectedValue(new Error('no fix'));
    await expect(reportLocationNow()).resolves.toBe(false);
    expect(reportLocation).not.toHaveBeenCalled();
  });
});
