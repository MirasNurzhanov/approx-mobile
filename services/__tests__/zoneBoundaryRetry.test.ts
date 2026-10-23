/**
 * The Retry behind the map's "Showing 500 m around you" notice.
 *
 * It has to make the server fetch the missing city or district boundary —
 * re-reading the zone would only re-read the same empty answer — and report
 * which of the four outcomes happened, because the notice words each one
 * differently.
 */
import { retryZoneBoundary } from '../zone';

jest.mock('../api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  BASE_URL: 'https://example.test',
}));

const { api } = jest.requireMock('../api');

beforeEach(() => {
  api.post.mockReset();
  api.get.mockReset();
});

it('asks the server to fetch, rather than re-reading the zone', async () => {
  api.post.mockResolvedValue({ data: { zone_boundary_missing: false, zone_place_name: 'Almaty' } });
  const result = await retryZoneBoundary();
  expect(api.post).toHaveBeenCalledWith('/api/users/zone/boundary/');
  expect(api.get).not.toHaveBeenCalled();
  expect(result).toEqual({ status: 'landed', zone: { zone_boundary_missing: false, zone_place_name: 'Almaty' } });
});

it('says so when the boundary still did not load', async () => {
  api.post.mockResolvedValue({ data: { zone_boundary_missing: true } });
  await expect(retryZoneBoundary()).resolves.toMatchObject({ status: 'missing' });
});

it('tells a too-early press apart from a failure', async () => {
  api.post.mockRejectedValue({ response: { status: 429 } });
  await expect(retryZoneBoundary()).resolves.toEqual({ status: 'too_soon' });
  api.post.mockRejectedValue(new Error('network'));
  await expect(retryZoneBoundary()).resolves.toEqual({ status: 'failed' });
});
