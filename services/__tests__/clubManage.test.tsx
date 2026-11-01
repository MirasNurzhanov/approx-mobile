/* eslint-disable @typescript-eslint/no-require-imports -- Jest factories run before imports. */
// The owner's controls for the club itself: Manage holds rename, icon and
// delete, the icon is tappable, and there is no delete button on the page.

import { Alert, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockUpdate = jest.fn();
let mockClub: Record<string, unknown>;
let mockMembers: { user: { id: number; username: string }; role: string }[];

jest.mock('../api', () => ({ api: { get: () => Promise.resolve({ data: { id: 1 } }) } }));
jest.mock('../clubs', () => ({
  clubsApi: {
    get: () => Promise.resolve({ data: mockClub }),
    members: () => Promise.resolve({ data: mockMembers }),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '9' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: require('../../constants/theme').lightColors }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../components/ui/Avatar', () => ({ Avatar: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const ClubDetailScreen = require('../../app/clubs/[id]').default;
const me = { id: 1, username: 'owner' };
let tree: ReactTestRenderer;

const texts = () => tree.root.findAllByType(Text).map((n) => [n.props.children].flat().join(''));
const pressable = (label: string) => {
  let node = tree.root.findAllByType(Text).find((t) => [t.props.children].flat().join('') === label) ?? null;
  while (node && typeof node.props.onPress !== 'function') node = node.parent;
  return node;
};

async function render() {
  await act(async () => { tree = create(<ClubDetailScreen />); });
}

beforeEach(() => {
  mockUpdate.mockReset();
  mockClub = { id: 9, name: 'Runners', creator: me, my_role: 'owner', member_count: 1 };
  mockMembers = [{ user: me, role: 'owner' }];
});
afterEach(() => { act(() => tree?.unmount()); jest.restoreAllMocks(); });

it('keeps delete off the page and puts it in Manage with rename and icon', async () => {
  await render();
  expect(texts()).not.toContain('Delete Club');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  act(() => pressable('Manage')!.props.onPress());
  const options = (alert.mock.calls[0][2] as { text: string }[]).map((o) => o.text);
  expect(options).toEqual(['Change icon', 'Rename club', 'Delete club', 'Cancel']);
});

it('lets the owner tap the icon to change it', async () => {
  await render();
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Change the club icon' }).length).toBeGreaterThan(0);
});

it('renames the club from the sheet', async () => {
  mockUpdate.mockResolvedValue({ data: { ...mockClub, name: 'Morning Runners' } });
  await render();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  act(() => pressable('Manage')!.props.onPress());
  const rename = (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[])
    .find((o) => o.text === 'Rename club')!;
  act(() => rename.onPress!());
  const field = tree.root.findByProps({ accessibilityLabel: 'Club name' });
  act(() => field.props.onChangeText('Morning Runners'));
  await act(async () => { pressable('Save')!.props.onPress(); });
  expect(mockUpdate).toHaveBeenCalledWith(9, { name: 'Morning Runners' });
  expect(texts()).toContain('Morning Runners');
});

it('gives plain members neither the icon button nor Manage', async () => {
  mockClub = { ...mockClub, creator: { id: 2, username: 'boss' }, my_role: 'member' };
  mockMembers = [{ user: { id: 2, username: 'boss' }, role: 'owner' }, { user: me, role: 'member' }];
  await render();
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Change the club icon' })).toHaveLength(0);
  expect(pressable('Manage')).toBeNull();
});
