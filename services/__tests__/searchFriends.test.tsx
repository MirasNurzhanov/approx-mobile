/* eslint-disable @typescript-eslint/no-require-imports -- Jest factories run before imports. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import SearchScreen from '../../app/search';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPush = jest.fn();
jest.mock('../api', () => ({ api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) } }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock('../../context/ThemeContext', () => ({ useTheme: () => ({ colors: require('../../constants/theme').lightColors }) }));
jest.mock('../../hooks/useScreenTopInset', () => ({ useScreenTopInset: () => 0 }));
jest.mock('../../components/ui/Avatar', () => ({ Avatar: () => null }));
jest.mock('../../components/ui/Card', () => ({ Card: ({ children }: { children: import('react').ReactNode }) => children }));
jest.mock('../../components/ui/GlassSurface', () => ({ GlassSurface: ({ children }: { children: import('react').ReactNode }) => children }));
jest.mock('../../components/ui/ScreenHeader', () => ({ ScreenHeader: ({ children }: { children: import('react').ReactNode }) => children }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

let tree: ReactTestRenderer;
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockPost.mockResolvedValue({ data: {} }); });
afterEach(() => { if (tree) act(() => tree.unmount()); jest.useRealTimers(); });

async function search(row: object) {
  mockGet.mockResolvedValue({ data: [{ id: 42, username: 'myfriend', ...row }] });
  await act(async () => { tree = create(<SearchScreen />); });
  act(() => tree.root.findByType(TextInput).props.onChangeText('myfriend'));
  await act(async () => { jest.advanceTimersByTime(400); });
  expect(mockGet).toHaveBeenCalledWith('/api/users/search/?q=myfriend');
}
const labels = () => tree.root.findAllByType(Text).map(node => node.props.children);
async function press(label: string) {
  const target = tree.root.findByProps({ accessibilityLabel: label });
  await act(async () => { target.props.onPress(); });
}

it('uses the real search API friends status to show Message and open the existing chat', async () => {
  await search({ relationship_status: 'friends' });
  expect(labels()).toContain('Message');
  expect(labels()).not.toContain('Hi');
  await press('Message');
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/messages/[id]', params: { id: 42, username: 'myfriend' } });
  expect(mockPost).not.toHaveBeenCalled();
});

it('keeps Hi for strangers and changes it to Sent after sending', async () => {
  await search({ relationship_status: 'none' });
  expect(labels()).toContain('Hi');
  await press('Hi');
  expect(mockPost).toHaveBeenCalledWith('/api/friends/hi/42/');
  expect(labels()).toContain('Sent ✓');
  expect(labels()).not.toContain('Hi');
});

it.each(['friend', 'connected'])('preserves Message for existing %s relationship responses', async relationship => {
  await search({ relationship });
  expect(labels()).toContain('Message');
  expect(labels()).not.toContain('Hi');
});
