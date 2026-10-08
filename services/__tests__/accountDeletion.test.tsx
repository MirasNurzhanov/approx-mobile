import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, TextInput } from 'react-native';
import DeleteAccountScreen from '../../app/delete-account';
import { api } from '../api';
import { requestAccountDeletion } from '../accountDeletion';
import { getDeletionIdentity, SocialSignInCancelled } from '../socialAuth';

const mockLogout = jest.fn();
jest.mock('../api', () => ({ api: { get: jest.fn(), delete: jest.fn() } }));
jest.mock('../socialAuth', () => ({
  getDeletionIdentity: jest.fn(),
  SocialSignInCancelled: class extends Error {},
  SocialSignInError: class extends Error {},
}));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ logout: mockLogout }) }));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../constants/theme').lightColors }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.get).mockResolvedValue({ data: { has_password: true, providers: ['google'], grace_days: 30 } });
  jest.mocked(api.delete).mockResolvedValue({ status: 202, data: { status: 'pending_deletion', delete_after: '2026-10-14T00:00:00Z' } });
  jest.mocked(getDeletionIdentity).mockResolvedValue('provider-proof');
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it('sends the current password in the request body', async () => {
  await requestAccountDeletion({ password: 'current' });
  expect(api.delete).toHaveBeenCalledWith('/api/users/delete/', { data: { password: 'current' } });
  expect(getDeletionIdentity).not.toHaveBeenCalled();
});

it('obtains provider proof without exchanging the current app session', async () => {
  await requestAccountDeletion({ provider: 'google' });
  expect(getDeletionIdentity).toHaveBeenCalledWith('google');
  expect(api.delete).toHaveBeenCalledWith('/api/users/delete/', {
    data: { provider: 'google', id_token: 'provider-proof' },
  });
});

it('provider cancellation never submits deletion', async () => {
  jest.mocked(getDeletionIdentity).mockRejectedValueOnce(new SocialSignInCancelled());
  await expect(requestAccountDeletion({ provider: 'apple' })).rejects.toBeInstanceOf(SocialSignInCancelled);
  expect(api.delete).not.toHaveBeenCalled();
});

it('requires explicit server acceptance', async () => {
  jest.mocked(api.delete).mockResolvedValueOnce({ status: 200, data: {} });
  await expect(requestAccountDeletion({ password: 'current' })).rejects.toThrow('not confirmed');
});

async function openScreen() {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<DeleteAccountScreen />); });
  act(() => tree.root.findByType(TextInput).props.onChangeText('current'));
  return tree;
}

async function confirm(tree: ReactTestRenderer) {
  act(() => tree.root.findByProps({ label: 'Confirm password and delete' }).props.onPress());
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  await act(async () => { buttons?.find(button => button.text === 'Request deletion')?.onPress?.(); });
}

it('failed requests leave the screen signed in and available for retry', async () => {
  jest.mocked(api.delete).mockRejectedValueOnce(new Error('offline'));
  const tree = await openScreen();
  try {
    await confirm(tree);
    expect(mockLogout).not.toHaveBeenCalled();
    expect(tree.root.findByType(TextInput).props.value).toBe('current');
    expect(tree.root.findByProps({ label: 'Confirm password and delete' }).props.disabled).toBe(false);
    await confirm(tree);
    expect(mockLogout).toHaveBeenCalledTimes(1);
  } finally { act(() => tree.unmount()); }
});

it('confirmation cancellation does not submit or log out', async () => {
  const tree = await openScreen();
  try {
    act(() => tree.root.findByProps({ label: 'Confirm password and delete' }).props.onPress());
    expect(api.delete).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  } finally { act(() => tree.unmount()); }
});
