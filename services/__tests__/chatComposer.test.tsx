/**
 * The message bar shared by direct messages and club chat.
 *
 * Pinned here because the two screens had drifted into copies with the same
 * faults: the send button's accent fill hidden under its own glass, so only its
 * outline changed colour, and home-indicator padding kept while the keyboard
 * covered the home indicator.
 */
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Keyboard, StyleSheet } from 'react-native';

import { ChatComposer, onColour } from '../../components/chat/ChatComposer';

const colors = jest.requireActual('../../constants/theme').lightColors;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../constants/theme').lightColors, mode: 'light' }),
}));
jest.mock('../../components/ui/GlassSurface', () => {
  const { View } = jest.requireActual('react-native');
  return { GlassSurface: (props: object) => <View {...props} /> };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let tree: ReactTestRenderer;
const onSend = jest.fn();

function render(canSend: boolean) {
  act(() => {
    tree = create(
      <ChatComposer text={canSend ? 'hi' : ''} canSend={canSend} bottom={34}
        onChangeText={() => {}} onSend={onSend} actions={[]} />,
    );
  });
}
const send = () => tree.root.findByProps({ accessibilityLabel: 'Send message' });
const styleOf = (node: ReactTestInstance) =>
  StyleSheet.flatten(typeof node.props.style === 'function'
    ? (node.props.style as (s: { pressed: boolean }) => unknown)({ pressed: false })
    : node.props.style) as Record<string, unknown>;

beforeEach(() => onSend.mockClear());
afterEach(() => act(() => tree.unmount()));

it('sends on a single press', () => {
  render(true);
  act(() => send().props.onPress());
  expect(onSend).toHaveBeenCalledTimes(1);
});

it('fills the whole button with the theme accent once there is something to send', () => {
  render(true);
  expect(styleOf(send()).backgroundColor).toBe(colors.teal);
});

it('is disabled and quiet while the field is empty', () => {
  render(false);
  expect(send().props.disabled).toBe(true);
  expect(styleOf(send()).backgroundColor).toBe(colors.surface2);
});

it('drops the home-indicator padding while the keyboard is up', () => {
  const listeners: Record<string, () => void> = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, fn: () => void) => {
    listeners[event] = fn;
    return { remove: jest.fn() };
  }) as never);
  render(true);
  const bar = () => tree.root.findAll((n) => n.props.style && n.props.children && Array.isArray(n.props.children))[0];
  expect(StyleSheet.flatten(bar().props.style).paddingBottom).toBe(40);
  act(() => (listeners.keyboardWillShow ?? listeners.keyboardDidShow)());
  expect(StyleSheet.flatten(bar().props.style).paddingBottom).toBe(8);
});

it('picks a readable icon colour on every theme accent', () => {
  expect(onColour('#1FC7B6')).toBe('#04211D'); // light turquoise
  expect(onColour('#E8714A')).toBe('#FFFFFF'); // coral
  expect(onColour('#0B3D91')).toBe('#FFFFFF'); // navy
});
