/**
 * The Swift comments sheet lifts its composer by exactly this height on iOS,
 * where the sheet's bottom edge is the screen's — measuring the sheet instead
 * caught it mid-slide and hid the composer entirely.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Dimensions, Keyboard, LayoutAnimation } from 'react-native';

import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

let height = -1;
function Harness() { height = useKeyboardHeight(); return null; }

it('follows the keyboard up and back down', () => {
  const listeners: Record<string, (e: object) => void> = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, fn: (e: object) => void) => {
    listeners[event] = fn;
    return { remove: jest.fn() };
  }) as never);
  jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<Harness />); });
  expect(height).toBe(0);
  const show = listeners.keyboardWillShow ?? listeners.keyboardDidShow;
  const hide = listeners.keyboardWillHide ?? listeners.keyboardDidHide;
  act(() => show({ duration: 250, endCoordinates: { height: 336, screenY: 516 } }));
  expect(height).toBe(336);
  act(() => hide({ duration: 250, endCoordinates: { height: 0, screenY: 852 } }));
  expect(height).toBe(0);
  act(() => tree.unmount());
});

it('catches a keyboard that comes back with only a frame change', () => {
  const listeners: Record<string, (e: object) => void> = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, fn: (e: object) => void) => {
    listeners[event] = fn;
    return { remove: jest.fn() };
  }) as never);
  jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
  const screen = Dimensions.get('screen').height;
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<Harness />); });
  const change = listeners.keyboardWillChangeFrame;
  if (!change) { act(() => tree.unmount()); return; } // Android: show/hide only
  act(() => listeners.keyboardWillHide({ duration: 250, endCoordinates: { height: 336, screenY: screen } }));
  act(() => change({ duration: 250, endCoordinates: { height: 336, screenY: screen - 336 } }));
  expect(height).toBe(336);
  act(() => change({ duration: 250, endCoordinates: { height: 336, screenY: screen } }));
  expect(height).toBe(0);
  act(() => tree.unmount());
});
