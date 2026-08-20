/**
 * The token that ties visibility to one run of the app.
 *
 * The invariant with teeth: it must never be written anywhere that survives
 * the process. A persisted token is a preference saying you were visible,
 * which is the exact thing App Review's last bullet forbids acting on.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import {
  currentSharingSession,
  forgetSharingSession,
  rememberSharingSession,
} from '../sharingSession';

jest.mock('../api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  BASE_URL: 'https://example.test',
}));

const END = '/api/proximity/sharing-session/end/';
const TOKEN = '11111111-2222-3333-4444-555555555555';

/**
 * A fresh module registry, standing in for a relaunched app.
 *
 * `endStaleSharingSession` fires once per process and the token lives in
 * module scope, so both have to be reset together — that pairing *is* the
 * behaviour under test.
 *
 * The mock and AppState are re-acquired from the new registry rather than
 * closed over. `jest.resetModules()` gives the reloaded module its own copy of
 * every dependency, so a handle taken before the reset belongs to the previous
 * one and would record none of the calls made after it.
 */
function freshProcess(appState: string = 'active') {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports --
     `require` is the point here, not a style lapse: a static `import` is
     hoisted and bound once, so it would keep handing back the module registry
     these three lines exist to have replaced. */
  const RN = require('react-native');
  RN.AppState.currentState = appState;
  const { api } = require('../api');
  api.post.mockResolvedValue({ data: { location_sharing: 'paused' } });
  const mod = require('../sharingSession') as typeof import('../sharingSession');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { mod, api };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  forgetSharingSession();
  jest.clearAllMocks();
  (AppState as any).currentState = 'active';
});

describe('the token is never persisted', () => {
  it('leaves no trace in storage when remembered', async () => {
    rememberSharingSession(TOKEN, true);
    expect(currentSharingSession()).toBe(TOKEN);

    // The load-bearing assertion. Anything that wrote this to disk would make
    // visibility survive a restart, which is the whole thing being prevented.
    const keys = await AsyncStorage.getAllKeys();
    const values = await Promise.all(keys.map((k) => AsyncStorage.getItem(k)));
    expect(values.join('|')).not.toContain(TOKEN);
  });

  it('is gone in a fresh process', () => {
    rememberSharingSession(TOKEN, true);
    const { mod } = freshProcess();
    expect(mod.currentSharingSession()).toBeNull();
  });

  it('is dropped on sign-out', () => {
    rememberSharingSession(TOKEN, true);
    forgetSharingSession();
    expect(currentSharingSession()).toBeNull();
  });

  it('treats a null or absent server value as no session', () => {
    rememberSharingSession(TOKEN, true);
    rememberSharingSession(null);
    expect(currentSharingSession()).toBeNull();

    rememberSharingSession(TOKEN, true);
    rememberSharingSession(undefined);
    expect(currentSharingSession()).toBeNull();
  });
});

describe('endStaleSharingSession', () => {
  it('presents null on a cold launch', async () => {
    const { mod, api } = freshProcess();
    await mod.endStaleSharingSession();
    expect(api.post).toHaveBeenCalledWith(END, { session: null });
  });

  it('presents a token this run minted, so a late call leaves the tap alone', async () => {
    // The race the token exists for: the user taps Live while the startup
    // call is still in flight. Their PATCH response is owned, so the call
    // lands carrying a matching token and the server does nothing.
    const { mod, api } = freshProcess();
    mod.rememberSharingSession(TOKEN, true);
    await mod.endStaleSharingSession();
    expect(api.post).toHaveBeenCalledWith(END, { session: TOKEN });
  });

  it('runs once per process, however many times it is called', async () => {
    // A second mount, a re-render, a fast tab switch — none of them may turn
    // this into something that can pause a user mid-session.
    const { mod, api } = freshProcess();
    await mod.endStaleSharingSession();
    await mod.endStaleSharingSession();
    await mod.endStaleSharingSession();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the app is not in the foreground', async () => {
    // iOS relaunches the app in the background to deliver location updates,
    // and that JS context looks exactly like a cold launch from in here.
    // Ending the session there would make backgrounding a check-out.
    const { mod, api } = freshProcess('background');
    await mod.endStaleSharingSession();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('stays silent while inactive too', async () => {
    const { mod, api } = freshProcess('inactive');
    await mod.endStaleSharingSession();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('never throws, and leaves the attempt open for the next launch', async () => {
    const { mod, api } = freshProcess();
    api.post.mockRejectedValue(new Error('offline'));

    await expect(mod.endStaleSharingSession()).resolves.toBeUndefined();

    // Not retried on a timer — a loop here could pause somebody who has since
    // gone visible. The next launch tries again.
    api.post.mockResolvedValue({ data: { location_sharing: 'paused' } });
    await mod.endStaleSharingSession();
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});

describe('ownership decides which tokens count', () => {
  it('ignores a token merely read back from the server', async () => {
    // The ordering that made this necessary: React runs child effects before
    // parent ones, so a screen's refreshPrivacy() on mount lands before the
    // root layout's startup effect. If that read were allowed to seed the
    // token, the startup call would present the *previous* run's session, the
    // server would match it, and the user would silently stay visible.
    const { mod, api } = freshProcess();

    mod.rememberSharingSession(TOKEN);
    expect(mod.currentSharingSession()).toBeNull();

    await mod.endStaleSharingSession();
    expect(api.post).toHaveBeenCalledWith(END, { session: null });
  });

  it('accepts a token this run minted', () => {
    const { mod } = freshProcess();
    mod.rememberSharingSession(TOKEN, true);
    expect(mod.currentSharingSession()).toBe(TOKEN);
  });

  it('lets an unowned null clear an owned token', () => {
    // Pausing elsewhere, or a refresh finding no session: hiding is never
    // ignored, whoever reports it.
    const { mod } = freshProcess();
    mod.rememberSharingSession(TOKEN, true);
    mod.rememberSharingSession(null);
    expect(mod.currentSharingSession()).toBeNull();
  });

  it('clears the token when the server reports it paused us', async () => {
    const { mod } = freshProcess();
    mod.rememberSharingSession(TOKEN, true);
    await mod.endStaleSharingSession();
    expect(mod.currentSharingSession()).toBeNull();
  });
});
