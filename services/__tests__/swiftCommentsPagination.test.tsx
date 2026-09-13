import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList } from 'react-native';
import { SwiftCommentsSheet } from '../../components/swifts/SwiftCommentsSheet';
import { fetchSwiftComments, postSwiftComment, type SwiftComment, type SwiftCommentPage } from '../swifts';

jest.mock('../swifts', () => ({
  fetchSwiftComments: jest.fn(), postSwiftComment: jest.fn(), deleteSwiftComment: jest.fn(),
  formatCount: (count: number) => String(count),
}));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../constants/theme').lightColors }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../components/ContentActions', () => ({ useContentActions: () => ({ present: jest.fn(), sheets: null }) }));
jest.mock('../../components/ui/Avatar', () => ({ Avatar: () => null }));
jest.mock('../../components/ui/icons', () => ({ IconClose: 'IconClose', IconMore: 'IconMore', IconTrash: 'IconTrash' }));
jest.mock('../../components/swifts/icons', () => ({ SwiftCommentIcon: 'SwiftCommentIcon' }));

const comment = (id: number): SwiftComment => ({
  id, author: { id: 2, username: 'reader' }, text: `Comment ${id}`, parent: null,
  reply_count: 0, is_mine: true, created_at: '2026-09-12T00:00:00Z',
});
const fetchMock = jest.mocked(fetchSwiftComments);
let tree: ReactTestRenderer;
const onCountChange = jest.fn();
const list = () => tree.root.findByType(FlatList).props;

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockResolvedValueOnce({ count: 3, results: [comment(1)] });
});
afterEach(() => { if (tree) act(() => tree.unmount()); });

async function mount() {
  await act(async () => {
    tree = create(<StrictMode><SwiftCommentsSheet visible swiftId={7} allowComments
      onClose={() => {}} onCountChange={onCountChange} /></StrictMode>);
  });
}

it('appends pages and stops fetching when the thread is exhausted', async () => {
  // Strict Mode can replay mount effects; both loads see the same first page.
  fetchMock.mockResolvedValue({ count: 3, results: [comment(1)] });
  await mount();
  fetchMock.mockResolvedValueOnce({ count: 3, results: [comment(2), comment(3)] });
  await act(async () => { list().onEndReached(); });
  expect(list().data.map((item: SwiftComment) => item.id)).toEqual([1, 2, 3]);
  const calls = fetchMock.mock.calls.length;
  await act(async () => { list().onEndReached(); });
  expect(fetchMock).toHaveBeenCalledTimes(calls);
  expect(onCountChange).not.toHaveBeenCalled();
});

it('keeps a comment posted while the next page is in flight', async () => {
  fetchMock.mockResolvedValue({ count: 3, results: [comment(1)] });
  await mount();
  let resolvePage!: (page: SwiftCommentPage) => void;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolvePage = resolve; }));
  act(() => { list().onEndReached(); });
  jest.mocked(postSwiftComment).mockResolvedValueOnce(comment(4));
  act(() => { tree.root.findByProps({ accessibilityLabel: 'Add a comment' }).props.onChangeText('A new comment'); });
  await act(async () => { await tree.root.findByProps({ accessibilityLabel: 'Post comment' }).props.onPress(); });
  await act(async () => { resolvePage({ count: 4, results: [comment(2), comment(3)] }); });
  expect(list().data.map((item: SwiftComment) => item.id)).toEqual([4, 1, 2, 3]);
  expect(onCountChange).toHaveBeenCalledTimes(1);
  expect(onCountChange).toHaveBeenCalledWith(7, 1);
});
