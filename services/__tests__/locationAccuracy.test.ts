import { api } from '../api';
import { reportLocation } from '../location';
import { getCachedGhostMode } from '../privacy';
import { hasAcknowledgedLocationDisclosure } from '../locationDisclosure';

jest.mock('../api', () => ({ api: { patch: jest.fn(async () => ({})) } }));
jest.mock('../privacy', () => ({ getCachedGhostMode: jest.fn(async () => false) }));
jest.mock('../locationDisclosure', () => ({ hasAcknowledgedLocationDisclosure: jest.fn(async () => true) }));
const point = { latitude: 10, longitude: 20 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCachedGhostMode).mockResolvedValue(false);
  jest.mocked(hasAcknowledgedLocationDisclosure).mockResolvedValue(true);
});

it.each([0, 12, 500])('sends valid accuracy %s without changing the location contract', async accuracy => {
  await reportLocation(point, 2, accuracy);
  expect(api.patch).toHaveBeenLastCalledWith('/api/proximity/location/', { ...point, speed: 2, accuracy });
});

it('distinguishes omitted accuracy from explicit unknown', async () => {
  await reportLocation(point);
  expect(api.patch).toHaveBeenLastCalledWith('/api/proximity/location/', point);
  for (const accuracy of [null, -1, NaN, Infinity]) {
    await reportLocation(point, null, accuracy);
    expect(api.patch).toHaveBeenLastCalledWith('/api/proximity/location/', { ...point, accuracy: null });
  }
});

it('never sends accuracy or coordinates through a closed privacy gate', async () => {
  jest.mocked(getCachedGhostMode).mockResolvedValue(true);
  expect(await reportLocation(point, 2, 12)).toBe(false);
  jest.mocked(getCachedGhostMode).mockResolvedValue(false);
  jest.mocked(hasAcknowledgedLocationDisclosure).mockResolvedValue(false);
  expect(await reportLocation(point, 2, 12)).toBe(false);
  expect(api.patch).not.toHaveBeenCalled();
});
