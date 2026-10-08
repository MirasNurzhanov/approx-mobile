import { safeApiError } from '../safeApiError';

test('removes credential-bearing transport objects while retaining useful validation errors', () => {
  const error = safeApiError({
    isAxiosError: true, message: 'raw access-secret', stack: 'raw refresh-secret',
    config: { headers: { Authorization: 'Bearer access-secret' }, data: JSON.stringify({ refresh: 'refresh-secret', password: 'password-secret' }) },
    request: { responseURL: 'https://example.test/?ticket=opaque-secret' },
    response: { status: 400, data: { detail: 'Rejected access-secret and refresh-secret', email: ['Invalid address'], tokens: { access: 'nested-secret' } } },
  });
  const serialized = JSON.stringify(error);
  for (const secret of ['access-secret', 'refresh-secret', 'password-secret', 'opaque-secret', 'nested-secret']) {
    expect(serialized + error.message + error.stack).not.toContain(secret);
  }
  expect(error).toMatchObject({ isAxiosError: true, response: { status: 400, data: { email: ['Invalid address'] } } });
  expect(error).not.toHaveProperty('config');
  expect(error).not.toHaveProperty('request');
});

test('transport errors never propagate native text; cancellation remains identifiable', () => {
  expect(safeApiError(new Error('Bearer native-secret')).message).toBe('Request could not be completed.');
  expect(safeApiError({ code: 'ERR_CANCELED', __CANCEL__: true })).toMatchObject({ code: 'ERR_CANCELED', __CANCEL__: true });
});
