import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { api, beginSessionEnd, resumeSession, setOnAuthFailure } from '../api';
import { tokenStore } from '../tokenStore';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('expo-application', () => ({ nativeBuildVersion: '33' }));
jest.mock('../presence', () => ({ isForeground: () => false }));
jest.mock('../tokenStore', () => ({ tokenStore: {
  getItem: jest.fn(), rotateSession: jest.fn(), clearSession: jest.fn(),
} }));

function unauthorized(config: InternalAxiosRequestConfig) {
  return new AxiosError('raw transport access-secret', 'ERR_BAD_REQUEST', config, { secret: 'native-secret' }, {
    status: 401, statusText: 'Unauthorized', headers: {}, config, data: { detail: 'Unauthorized' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resumeSession();
  jest.mocked(tokenStore.getItem).mockImplementation(async key => key === 'access_token' ? 'access-secret' : 'refresh-secret');
  jest.mocked(tokenStore.rotateSession).mockResolvedValue(true);
  jest.mocked(tokenStore.clearSession).mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test('concurrent 401s share a single refresh and retry using securely saved tokens', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { access: 'new-access', refresh: 'new-refresh' } });
  jest.mocked(tokenStore.rotateSession).mockImplementation(async () => {
    jest.mocked(tokenStore.getItem).mockResolvedValue('new-access');
    return true;
  });
  api.defaults.adapter = async config => {
    if (config.headers.Authorization !== 'Bearer new-access') throw unauthorized(config);
    return { status: 200, statusText: 'OK', headers: {}, config, data: 'ok' };
  };
  const result = await Promise.all([api.get('/one'), api.get('/two')]);
  expect(result.map(response => response.data)).toEqual(['ok', 'ok']);
  expect(post).toHaveBeenCalledTimes(1);
  expect(tokenStore.rotateSession).toHaveBeenCalledWith('refresh-secret', 'new-access', 'new-refresh');
});

test('failed refresh closes the session even when secure deletion needs retry', async () => {
  const failure = jest.fn();
  setOnAuthFailure(failure);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(axios, 'post').mockRejectedValue(new Error('refresh-secret'));
  jest.mocked(tokenStore.clearSession).mockRejectedValue(new Error('storage unavailable'));
  api.defaults.adapter = async config => { throw unauthorized(config); };
  const error = await api.get('/private').catch(error => error);
  expect(failure).toHaveBeenCalledTimes(1);
  expect(error.response.status).toBe(401);
  expect(error.config).toBeUndefined();
  expect(error.request).toBeUndefined();
  expect(JSON.stringify(error) + error.message).not.toContain('access-secret');
  expect(JSON.stringify(jest.mocked(console.log).mock.calls)).not.toContain('refresh-secret');
});

test('logout during credential lookup prevents dispatch of the waiting request', async () => {
  let resolve!: (token: string) => void;
  jest.mocked(tokenStore.getItem).mockImplementation(() => new Promise(done => { resolve = done; }));
  const adapter = jest.fn();
  api.defaults.adapter = adapter;
  const request = api.get('/private').catch(error => error);
  await Promise.resolve();
  beginSessionEnd();
  resolve('access-secret');
  await request;
  expect(adapter).not.toHaveBeenCalled();
});
