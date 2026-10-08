/* eslint-disable @typescript-eslint/no-require-imports -- Jest factories run before imports. */
// Inviting someone to a club, from the owner's side.
//
// The sheet sits at the bottom of the screen with its search field focused, and
// it used to have nothing between it and the keyboard: the field and every
// result were hidden under it, so an owner could type a name and never reach
// an Invite button. A one-letter search also read as "No users found" because
// the server does not search below two characters.

import { Alert, KeyboardAvoidingView, Modal, Text, TextInput } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const mockSearch = jest.fn();
const mockInvite = jest.fn();
let mockClub: Record<string, unknown>;
let mockMembers: { user: { id: number; username: string }; role: string }[];

jest.mock('../api', () => ({
  api: {
    get: (url: string) => url.startsWith('/api/users/search/')
      ? mockSearch(url)
      : Promise.resolve({ data: { id: 1 } }),
  },
}));
jest.mock('../clubs', () => ({
  clubsApi: {
    get: () => Promise.resolve({ data: mockClub }),
    members: () => Promise.resolve({ data: mockMembers }),
    invite: (...args: unknown[]) => mockInvite(...args),
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
const miras = { id: 5, username: 'miras' };
const mira = { id: 6, username: 'mira' };

let tree: ReactTestRenderer;

const texts = () => tree.root.findAllByType(Text).map((n) => [n.props.children].flat().join(''));
/** The nearest pressable ancestor of the first text reading `label` under `within`. */
const pressableWithText = (label: string, within?: ReactTestInstance): ReactTestInstance | undefined => {
  const text = (within ?? tree.root).findAllByType(Text).find((t) => [t.props.children].flat().join('') === label);
  let node: ReactTestInstance | null = text ?? null;
  while (node && typeof node.props.onPress !== 'function') node = node.parent;
  return node ?? undefined;
};
/** A result row's Invite button, inside the sheet — not the section header's. */
const rowInviteButton = () => pressableWithText('Invite', tree.root.findByType(Modal));
const searchField = () => tree.root.findAllByType(TextInput).find((n) => n.props.placeholder === 'Search by username…')!;

async function renderClub() {
  await act(async () => { tree = create(<ClubDetailScreen />); });
}

async function openInvite() {
  const button = pressableWithText('Invite');
  expect(button).toBeDefined();
  await act(async () => { button!.props.onPress(); });
}

async function type(text: string) {
  await act(async () => { searchField().props.onChangeText(text); });
  await act(async () => { jest.advanceTimersByTime(350); });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSearch.mockReset();
  mockInvite.mockReset();
  mockClub = { id: 9, name: 'Runners', creator: me, my_role: 'owner', member_count: 1 };
  mockMembers = [{ user: me, role: 'owner' }];
});

afterEach(() => {
  act(() => tree?.unmount());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('lifts the sheet above the keyboard', async () => {
  await renderClub();
  await openInvite();
  const modal = tree.root.findByType(Modal);
  expect(modal.props.visible).toBe(true);
  const avoider = modal.findByType(KeyboardAvoidingView);
  expect(avoider.props.behavior).toBeDefined();
  // The search field is inside what moves, not beside it.
  expect(avoider.findAllByType(TextInput)).toHaveLength(1);
});

it('explains a too-short query instead of claiming nobody exists', async () => {
  await renderClub();
  await openInvite();
  await type('m');
  expect(mockSearch).not.toHaveBeenCalled();
  expect(texts()).toContain('Type at least 2 characters.');
  expect(texts()).not.toContain('No users found.');
});

it('finds a person and invites them', async () => {
  mockSearch.mockResolvedValue({ data: [me, miras] });
  mockInvite.mockResolvedValue({ status: 201, data: {} });
  await renderClub();
  await openInvite();
  await type('mi');

  expect(mockSearch).toHaveBeenCalledWith('/api/users/search/?q=mi');
  // Members are left out of the results.
  expect(texts()).toContain('@miras');
  expect(texts()).not.toContain('@owner');

  await act(async () => { rowInviteButton()!.props.onPress(); });
  expect(mockInvite).toHaveBeenCalledWith(9, 5);
  expect(texts()).toContain('Invited');
});

it('keeps the newest results when an older search answers last', async () => {
  let answerOld!: (value: unknown) => void;
  mockSearch
    .mockImplementationOnce(() => new Promise((resolve) => { answerOld = resolve; }))
    .mockResolvedValueOnce({ data: [miras] });
  await renderClub();
  await openInvite();
  await type('mi');
  await type('mir');
  await act(async () => { answerOld({ data: [mira] }); });
  expect(texts()).toContain('@miras');
  expect(texts()).not.toContain('@mira');
});

it('says when the search itself failed', async () => {
  mockSearch.mockRejectedValue(new Error('offline'));
  await renderClub();
  await openInvite();
  await type('mi');
  expect(texts().some((t) => t.startsWith('Couldn’t search right now'))).toBe(true);
});

it('tells the owner why an invitation was refused', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockSearch.mockResolvedValue({ data: [miras] });
  mockInvite.mockRejectedValue({ response: { status: 429, data: { detail: 'Request was throttled.' } } });
  await renderClub();
  await openInvite();
  await type('mi');
  await act(async () => { rowInviteButton()!.props.onPress(); });
  expect(alert).toHaveBeenCalledWith('Could not invite', expect.stringContaining('Try again later'));
  expect(texts()).not.toContain('Invited');
});

it('offers Invite to an owner who did not create the club', async () => {
  mockClub = { ...mockClub, creator: { id: 2, username: 'founder' }, my_role: 'owner' };
  mockMembers = [{ user: { id: 2, username: 'founder' }, role: 'owner' }, { user: me, role: 'owner' }];
  await renderClub();
  expect(pressableWithText('Invite')).toBeDefined();
});

it('does not offer Invite to a plain member', async () => {
  mockClub = { ...mockClub, creator: { id: 2, username: 'founder' }, my_role: 'member' };
  mockMembers = [{ user: { id: 2, username: 'founder' }, role: 'owner' }, { user: me, role: 'member' }];
  await renderClub();
  expect(pressableWithText('Invite')).toBeUndefined();
});
