import { catchUpHistory, failMessage, mergeMessages, type HistoryPage } from '../chatHistory';
import type { DirectMessage } from '../directMessages';

const page = (ids: number[], next: number | null): HistoryPage<{ id: number }> => ({
  results: ids.map(id => ({ id })), next_before: next, has_more: next !== null,
});

it('loads one page initially, then fills reconnect gaps through the last snapshot', async () => {
  const fetch = jest.fn().mockResolvedValueOnce(page([101, 102], 101));
  expect((await catchUpHistory(fetch, null))!.rows).toEqual([{ id: 101 }, { id: 102 }]);
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockReset().mockResolvedValueOnce(page([105, 106], 105))
    .mockResolvedValueOnce(page([103, 104], 103)).mockResolvedValueOnce(page([101, 102], 101));
  const result = await catchUpHistory(fetch, 102);
  expect(result!.rows.map(row => row.id)).toEqual([105, 106, 103, 104, 101, 102]);
  expect(fetch.mock.calls).toEqual([[undefined], [105], [103]]);
});

it('fills a multi-page gap even when the previous snapshot was empty', async () => {
  const fetch = jest.fn().mockResolvedValueOnce(page([3, 4], 3)).mockResolvedValueOnce(page([1, 2], null));
  expect((await catchUpHistory(fetch, 0))!.rows).toHaveLength(4);
});

it('rejects non-advancing cursors and discards responses after disposal', async () => {
  const fetch = jest.fn().mockResolvedValue(page([5, 6], 5));
  await expect(catchUpHistory(fetch, 1)).rejects.toThrow('cursor did not advance');
  let active = true;
  const delayed = async () => { active = false; return page([8], null); };
  expect(await catchUpHistory(delayed, 1, () => active)).toBeNull();
});

const message = (id: string, client_id?: string, sender_id = 1): DirectMessage => ({
  id, client_id, sender_id, text: 'identical', created_at: '2026-09-14T00:00:00Z',
  pending: id.startsWith('pending'),
});

it('reconciles reversed acknowledgements and echoes by client ID and sender, never text', () => {
  const existing = [message('pending-a', 'a'), message('pending-b', 'b')];
  const merged = mergeMessages(existing, [message('12', 'b'), message('11', 'a'), message('12', 'b')]);
  expect(merged.map(row => row.id)).toEqual(['11', '12']);
  expect(mergeMessages([message('pending-a', 'a')], [message('13', 'a', 2)])).toHaveLength(2);
});

it('a late failure cannot change a delivered message or an unrelated pending image', () => {
  const image: DirectMessage = { id: 'temp-img-1', image: 'file://photo', sender_id: 1, created_at: '', pending: true };
  const rows = failMessage([message('11', 'a'), message('pending-b', 'b'), image], 'a');
  expect(rows[0].failed).toBeUndefined();
  const failed = failMessage(rows, 'b');
  expect(failed[1]).toMatchObject({ pending: false, failed: true });
  expect(failed[2]).toBe(image);
});
