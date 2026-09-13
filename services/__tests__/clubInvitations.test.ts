import { api } from '@/services/api';
import { loadAlerts, requestActionUrl } from '../alerts';

jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('@/services/navBadges', () => ({
  getNavBadges: jest.fn(),
  refreshNavBadges: jest.fn(),
  resetNavBadges: jest.fn(),
  useSharedNavBadges: jest.fn(),
}));

const owner = { id: 2, username: 'owner' };
const waver = { id: 4, username: 'waver' };

describe('club invitations in the alerts feed', () => {
  beforeEach(() => {
    jest.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/api/clubs/invitations/') {
        return {
          data: [{
            id: 7, sender: owner, receiver: { id: 5, username: 'me' }, status: 'pending',
            club: { id: 9, name: 'Runners' }, created_at: '2026-09-13T10:00:00Z',
          }],
        } as never;
      }
      if (url === '/api/friends/requests/') {
        return { data: [{ id: 3, sender: waver, created_at: '2026-09-12T10:00:00Z' }] } as never;
      }
      return { data: [] } as never;
    });
  });

  it('lists a pending invitation as a request that names its club', async () => {
    const { requests } = await loadAlerts();
    expect(requests).toEqual([
      { id: 7, kind: 'club', user: owner, club: { id: 9, name: 'Runners' }, created_at: '2026-09-13T10:00:00Z' },
      { id: 3, kind: 'hi', user: waver, created_at: '2026-09-12T10:00:00Z' },
    ]);
  });

  it('answers each kind of request at its own endpoint', async () => {
    const [club, hi] = (await loadAlerts()).requests;
    expect(requestActionUrl(club, 'accept')).toBe('/api/clubs/invitations/7/accept/');
    expect(requestActionUrl(club, 'decline')).toBe('/api/clubs/invitations/7/decline/');
    expect(requestActionUrl(hi, 'accept')).toBe('/api/friends/hi/3/accept/');
    expect(requestActionUrl({ ...hi, kind: 'friend' }, 'decline')).toBe('/api/friends/request/3/decline/');
  });
});
