/**
 * The location report is what tells the app a friend's zone music is playing
 * where it stands — from the map and from the background task alike — so it
 * has to pass the server's answer on, and must never fail because of it.
 */
import { reportLocation } from '../location';
import { acknowledgeLocationDisclosure } from '../locationDisclosure';
import { handleZoneMusic } from '../zoneMusicAuto';

jest.mock('../api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  BASE_URL: 'https://example.test',
}));
jest.mock('../zoneMusicAuto', () => ({ handleZoneMusic: jest.fn(async () => {}) }));

const { api } = jest.requireMock('../api');
const HERE = { latitude: 10.123456, longitude: 20.654321 };

beforeEach(async () => {
  await acknowledgeLocationDisclosure();
  api.patch.mockReset();
  jest.mocked(handleZoneMusic).mockReset();
});

it('hands the zone music in the answer to the player', async () => {
  const zone = { owner_id: 7, url: 'https://example.com/p.m4a' };
  api.patch.mockResolvedValue({ data: { latitude: '10', longitude: '20', zone_music: zone } });
  await expect(reportLocation(HERE)).resolves.toBe(true);
  expect(handleZoneMusic).toHaveBeenCalledWith(zone);
});

it('tells the player when there is none, so it can stop', async () => {
  api.patch.mockResolvedValue({ data: { latitude: '10', longitude: '20', zone_music: null } });
  await reportLocation(HERE);
  expect(handleZoneMusic).toHaveBeenCalledWith(null);
});

it('still reports when the player fails', async () => {
  api.patch.mockResolvedValue({ data: {} });
  jest.mocked(handleZoneMusic).mockRejectedValue(new Error('no audio session'));
  await expect(reportLocation(HERE)).resolves.toBe(true);
});
