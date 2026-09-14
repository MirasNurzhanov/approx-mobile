// TermsGate: a blocking agreement that keeps a screen reader on itself, and
// never without a way forward.
import { Modal } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { TermsGate } from '../../components/TermsGate';
import { acceptTerms } from '../terms';

jest.mock('../terms', () => ({
  acceptTerms: jest.fn(),
  openDocument: jest.fn(),
  useTerms: () => ({
    documents: {
      terms_url: 'https://example.test/terms',
      guidelines_url: 'https://example.test/guidelines',
      privacy_url: 'https://example.test/privacy',
    },
  }),
}));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../constants/theme').lightColors }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));

let tree: ReactTestRenderer | undefined;
const onAccepted = jest.fn();
const onSignOut = jest.fn();

function render(visible = true) {
  act(() => { tree = create(<TermsGate visible={visible} onAccepted={onAccepted} onSignOut={onSignOut} />); });
  return tree!;
}
const byLabel = (root: ReactTestInstance, label: string) =>
  root.findAll((node) => node.props.accessibilityLabel === label)[0];

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
});

it('keeps a screen reader inside the gate, with every way forward inside it', () => {
  const modal = render().root.findByType(Modal);
  // Searched from the Modal down: a trapped view beside the Modal would not count.
  const trapped = modal.findAll((node) => node.props.accessibilityViewIsModal === true);
  expect(trapped.length).toBeGreaterThan(0);
  const region = trapped[0];
  expect(byLabel(region, 'I agree to the terms')).toBeDefined();
  expect(byLabel(region, 'Sign out instead')).toBeDefined();
  for (const document of ['Terms of Use', 'Community Guidelines', 'Privacy Policy']) {
    expect(byLabel(region, `Read the ${document}`)).toBeDefined();
  }
});

it('is not dismissed by the Android back button', () => {
  const gate = render();
  act(() => { gate.root.findByType(Modal).props.onRequestClose(); });
  expect(onSignOut).not.toHaveBeenCalled();
  expect(onAccepted).not.toHaveBeenCalled();
  expect(gate.root.findAllByType(Modal)).toHaveLength(1);
});

it('signs out from inside the gate', () => {
  const gate = render();
  act(() => { byLabel(gate.root, 'Sign out instead').props.onPress(); });
  expect(onSignOut).toHaveBeenCalledTimes(1);
});

it('records the agreement and then hands off', async () => {
  (acceptTerms as jest.Mock).mockResolvedValue(undefined);
  const gate = render();
  await act(async () => { await byLabel(gate.root, 'I agree to the terms').props.onPress(); });
  expect(acceptTerms).toHaveBeenCalledTimes(1);
  expect(onAccepted).toHaveBeenCalledTimes(1);
});

it('renders nothing while hidden', () => {
  expect(render(false).toJSON()).toBeNull();
});
