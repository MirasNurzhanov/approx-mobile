/* eslint-disable @typescript-eslint/no-require-imports -- Jest factories run before imports. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { PlacePicker } from '../../components/map/PlacePicker';
import type { Venue } from '../venues';

const mockGet = jest.fn();
const mockAnimateToRegion = jest.fn();
const mockAnimateCamera = jest.fn();
let mapProps: Record<string, any> = {};
jest.mock('../api', () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../../context/ThemeContext', () => ({ useTheme: () => ({ colors: require('../../constants/theme').lightColors }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-maps', () => {
  const React = require('react');
  const MapView = React.forwardRef(function MockMapView(props: Record<string, unknown>, ref: unknown) {
    mapProps = props;
    React.useImperativeHandle(ref, () => ({ animateToRegion: mockAnimateToRegion, animateCamera: mockAnimateCamera }));
    return props.children ?? null;
  });
  return { __esModule: true, default: MapView, Marker: 'MockMarker', PROVIDER_GOOGLE: 'google' };
});

const venue = (id: number, name: string, latitude: number, longitude: number, category = 'Restaurant & cafe'): Venue =>
  ({ id, slug: `v-${id}`, name, category, address: 'Dubai Marina, Dubai', description: '', image_url: '', latitude, longitude });
const pier7 = venue(1, 'Pier 7', 25.07623, 55.13883);
const mall = venue(2, 'Dubai Marina Mall', 25.07665, 55.14021, 'Shopping mall');
// 0.004° of longitude across a 400pt-wide map: 1pt = 0.00001°.
const start = { latitude: 25.0762, longitude: 55.1350, latitudeDelta: 0.008, longitudeDelta: 0.004 };
const over = (v: Venue, dxPt = 0) => ({ ...start, latitude: v.latitude, longitude: v.longitude + dxPt * 0.00001 });

let tree: ReactTestRenderer;
const onConfirmPoint = jest.fn();
const onConfirmVenue = jest.fn();
const onRegionChange = jest.fn();
const text = () => tree.root.findAllByType(Text).map(node => node.props.children).flat().join(' ');
const held = () => tree.root.findAll(node => node.props.testID === 'place-picker-held-cursor').length > 0;
const button = (label: string) => tree.root.findAll(node => typeof node.props.onPress === 'function'
  && (node.props.accessibilityLabel === label || node.findAllByType(Text).some(child => [child.props.children].flat().join('') === label)))[0];

async function render() {
  await act(async () => {
    tree = create(<PlacePicker initialRegion={start} top={0} bottom={0} busy={false} onRegionChange={onRegionChange}
      onBack={jest.fn()} onConfirmPoint={onConfirmPoint} onConfirmVenue={onConfirmVenue} />);
  });
  const wrap = tree.root.findAll(node => typeof node.props.onLayout === 'function')[0];
  await act(async () => { wrap.props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }); });
}
const move = (region: typeof start) => act(() => { mapProps.onRegionChange(region); });
const settle = (region: typeof start) => act(() => { mapProps.onRegionChangeComplete(region); });

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: { results: [pier7, mall], next: null } });
});
afterEach(() => { if (tree) act(() => tree.unmount()); jest.useRealTimers(); });

it('is a plain cursor that confirms a point away from venues', async () => {
  await render();
  expect(held()).toBe(false);
  expect(text()).toContain('Confirm Location');
  act(() => { button('Confirm Location').props.onPress(); });
  expect(onConfirmPoint).toHaveBeenCalled();
  expect(onConfirmVenue).not.toHaveBeenCalled();
});

it('becomes the venue when the map brings it under the cursor, and confirms it', async () => {
  await render();
  move(over(pier7, 10));
  expect(held()).toBe(true);
  expect(button('Meet at Pier 7')).toBeDefined();
  // Settling a little off the venue pulls it exactly under the cursor, at the
  // same zoom.
  settle(over(pier7, 10));
  expect(mockAnimateCamera).toHaveBeenCalledWith({ center: { latitude: pier7.latitude, longitude: pier7.longitude } }, expect.anything());
  act(() => { button('Meet at Pier 7').props.onPress(); });
  expect(onConfirmVenue).toHaveBeenCalledWith(pier7);
});

it('lets go when dragged off, and cancelling goes back to a cursor until the venue is left', async () => {
  await render();
  move(over(pier7));
  expect(held()).toBe(true);
  move(over(pier7, 60));
  expect(held()).toBe(false);

  move(over(pier7));
  expect(held()).toBe(true);
  act(() => { button('Not Pier 7, drop a pin instead').props.onPress(); });
  expect(held()).toBe(false);
  // Still on it: stays a cursor, so a pin can be dropped right there.
  move(over(pier7, 2));
  expect(held()).toBe(false);
  expect(text()).toContain('Confirm Location');
  // Leave and come back: it is offered again.
  move(over(pier7, 60));
  move(over(pier7));
  expect(held()).toBe(true);
});

it('finds a venue by name and flies the cursor onto it', async () => {
  await render();
  const input = tree.root.findByType(TextInput);
  act(() => { input.props.onFocus(); });
  act(() => { input.props.onChangeText('mall'); });
  const results = tree.root.findAll(node => typeof node.props.onPress === 'function'
    && /, (Shopping mall|Restaurant & cafe), /.test(node.props.accessibilityLabel ?? ''))
    .map(node => node.props.accessibilityLabel);
  expect(results).toEqual(['Dubai Marina Mall, Shopping mall, Dubai Marina, Dubai']);
  act(() => { button('Dubai Marina Mall, Shopping mall, Dubai Marina, Dubai').props.onPress(); });
  expect(mockAnimateToRegion).toHaveBeenCalledWith(expect.objectContaining({ latitude: mall.latitude, longitude: mall.longitude }), expect.any(Number));
  expect(held()).toBe(true);
  // Frames of the flight pass far from the venue without letting go of it.
  move(start);
  expect(held()).toBe(true);
  settle(over(mall));
  expect(button('Meet at Dubai Marina Mall')).toBeDefined();
});
