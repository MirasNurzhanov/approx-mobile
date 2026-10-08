import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { api } from '../api';
import { useDirectMessages } from '../../hooks/useDirectMessages';

jest.mock('../api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../hooks/useChatSocket', () => ({ useChatSocket: () => ({ status: 'unavailable' }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

let result: ReturnType<typeof useDirectMessages>;
function Screen() {
  result = useDirectMessages('2', 1, () => {});
  return null;
}

it('keeps archived history readable but prevents new messages and retries', async () => {
  jest.mocked(api.get).mockResolvedValue({ data: {
    results: [{ id: 8, sender_id: 2, content: 'Retained message', created_at: '2026-09-13T00:00:00Z' }],
    has_more: false, next_before: null, can_send: false,
  } });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<Screen />); });
  try {
    expect(result.messages[0].text).toBe('Retained message');
    expect(result.canSend).toBe(false);
    expect(result.sendText('new')).toBe(false);
    await act(async () => { await result.retry({ id: 'pending', sender_id: 1, client_id: 'retry', created_at: '' }); });
    expect(api.post).not.toHaveBeenCalled();
  } finally { act(() => tree.unmount()); }
});
