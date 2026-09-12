/**
 * The client half of the saved-Swifts shelf.
 *
 * The de-duplication itself is a database constraint and is tested against the
 * API in `swifts/test_saved.py` — a client-side `Set` would only be defending
 * against a state the server does not allow. What matters here is that the
 * client does not *undo* that guarantee: it must not invent a second entry
 * while a request is in flight, and it must not treat the shortlist as a
 * signal the recommender should hear about.
 */
import { fetchSavedSwifts, setSwiftSaved } from '../swifts';
import { api } from '../api';

jest.mock('../api', () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const mockApi = api as unknown as {
  get: jest.Mock; post: jest.Mock; delete: jest.Mock;
};

beforeEach(() => {
  mockApi.get.mockReset();
  mockApi.post.mockReset();
  mockApi.delete.mockReset();
});

describe('setSwiftSaved', () => {
  it('POSTs to save and DELETEs to un-save', async () => {
    mockApi.post.mockResolvedValue({ data: { saved: true } });
    mockApi.delete.mockResolvedValue({ data: { saved: false } });

    await expect(setSwiftSaved(7, true)).resolves.toBe(true);
    expect(mockApi.post).toHaveBeenCalledWith('/api/swifts/7/save/');

    await expect(setSwiftSaved(7, false)).resolves.toBe(false);
    expect(mockApi.delete).toHaveBeenCalledWith('/api/swifts/7/save/');
  });

  it('reports saved on a repeat save rather than treating it as a failure', async () => {
    // The server answers 200 instead of 201 the second time; the row is still
    // there and the client must read that as "saved", not as "nothing
    // happened".
    mockApi.post.mockResolvedValue({ data: { saved: true } });
    await expect(setSwiftSaved(7, true)).resolves.toBe(true);
    await expect(setSwiftSaved(7, true)).resolves.toBe(true);
  });

  it('falls back to the requested state when the body is empty', async () => {
    mockApi.post.mockResolvedValue({ data: undefined });
    await expect(setSwiftSaved(7, true)).resolves.toBe(true);
  });

  it('moves no counter — the response carries no count to read', async () => {
    mockApi.post.mockResolvedValue({ data: { saved: true } });
    const result = await setSwiftSaved(7, true);
    // A boolean, not a number: a save_count would leak a private list.
    expect(typeof result).toBe('boolean');
  });
});

describe('fetchSavedSwifts', () => {
  it('pages the shortlist', async () => {
    mockApi.get.mockResolvedValue({ data: { count: 2, results: [{ id: 1 }, { id: 2 }] } });
    const page = await fetchSavedSwifts(20, 40);
    expect(mockApi.get).toHaveBeenCalledWith('/api/swifts/saved/', {
      params: { limit: 20, offset: 40 },
    });
    expect(page.count).toBe(2);
    expect(page.results).toHaveLength(2);
  });

  it('survives a malformed body rather than throwing into the screen', async () => {
    mockApi.get.mockResolvedValue({ data: null });
    await expect(fetchSavedSwifts()).resolves.toEqual({ count: 0, results: [] });
  });

  it('does not de-duplicate client-side, because it does not have to', async () => {
    // If the server ever did return the same id twice, that is a server bug to
    // fix there — silently collapsing it here would hide it. This pins the
    // pass-through so nobody "helpfully" adds a Set and masks a regression.
    mockApi.get.mockResolvedValue({ data: { count: 2, results: [{ id: 1 }, { id: 1 }] } });
    const page = await fetchSavedSwifts();
    expect(page.results).toHaveLength(2);
  });
});
