const mockPush = jest.fn();

jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(),
}));

import { routeFromNotification } from '../notificationRouting';

/**
 * Where a tapped notification lands.
 *
 * The failure this guards against is quiet in the worst way: a payload the
 * switch does not know falls through to `default` and returns false, so the
 * app stays exactly where it was. Nothing errors, nothing is logged, and the
 * only symptom is that tapping an alert appears to do nothing — which reads as
 * a dead notification rather than as a missing case.
 *
 * Every `type` the server can send therefore gets an assertion here, and the
 * list is meant to be kept level with `notifications/utils.py`.
 */

describe('routeFromNotification', () => {
  beforeEach(() => mockPush.mockClear());

  it('does nothing at all with an empty payload', () => {
    expect(routeFromNotification(undefined)).toBe(false);
    expect(routeFromNotification(null)).toBe(false);
    expect(routeFromNotification({})).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens a conversation for a direct message', () => {
    expect(routeFromNotification({ type: 'message', user_id: 4, username: 'aisha' })).toBe(true);
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/messages/[id]',
      params: { id: '4', username: 'aisha' },
    }));
  });

  it('opens a profile', () => {
    expect(routeFromNotification({ type: 'profile', user_id: 9 })).toBe(true);
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/profile/[id]',
      params: { id: '9' },
    }));
  });

  // The four Swift alerts — like, comment, repost, and being mentioned — all
  // arrive under one `type` with the subject in `swift_id`. They differ in what
  // they say, not in where they go.
  describe('Swift alerts', () => {
    it('opens the Swift itself', () => {
      expect(routeFromNotification({ type: 'swift', swift_id: 42, user_id: 7 })).toBe(true);
      expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({
        pathname: '/swifts/[id]',
        params: { id: '42' },
      }));
    });

    it('takes the id as a string, which is how one platform delivers it', () => {
      // APNs and FCM disagree about whether a number survives as a number.
      expect(routeFromNotification({ type: 'swift', swift_id: '42' })).toBe(true);
      expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({
        params: { id: '42' },
      }));
    });

    it('stays put rather than opening a broken route when the id is missing', () => {
      expect(routeFromNotification({ type: 'swift', user_id: 7 })).toBe(false);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('is not fooled by a literal "undefined" arriving as a string', () => {
      expect(routeFromNotification({ type: 'swift', swift_id: 'undefined' })).toBe(false);
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  it('sends story activity and requests to the alerts feed', () => {
    for (const type of ['story', 'request']) {
      mockPush.mockClear();
      expect(routeFromNotification({ type })).toBe(true);
      expect(mockPush).toHaveBeenCalledWith('/(tabs)/chat');
    }
  });

  it('reports an unknown type as unhandled rather than bouncing to a default screen', () => {
    // A payload from a server newer than this build. Leaving the user where
    // they were is the honest outcome; teleporting them to a tab that has
    // nothing to do with the alert is not.
    expect(routeFromNotification({ type: 'something_new', user_id: 1 })).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
