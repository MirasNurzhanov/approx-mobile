import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ZonePlayer } from '../../components/ZonePlayer';

const mockMode = jest.fn();
const mockCreate = jest.fn();
jest.mock('expo-audio', () => ({
  setAudioModeAsync: (...args: unknown[]) => mockMode(...args),
  createAudioPlayer: (...args: unknown[]) => mockCreate(...args),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../constants/theme').lightColors }),
}));
jest.mock('../../components/ui/icons', () => ({
  IconMusic: 'IconMusic', IconPlay: 'IconPlay', IconPause: 'IconPause', IconRestart: 'IconRestart',
}));

let tree: ReactTestRenderer;
const onPosition = jest.fn();
const player = (url = 'https://example.test/a.mp3', blockedReason?: string, startMs = 0) =>
  <ZonePlayer url={url} title="Track" blockedReason={blockedReason} startMs={startMs} onPosition={onPosition} />;
const play = () => tree.root.findByProps({ accessibilityLabel: 'Play Track' }).props.onPress();
const sound = () => ({
  play: jest.fn(), pause: jest.fn(), remove: jest.fn(),
  seekTo: jest.fn().mockResolvedValue(undefined),
  addListener: jest.fn().mockReturnValue({ remove: jest.fn() }), loop: false,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockMode.mockResolvedValue(undefined);
  mockCreate.mockImplementation(sound);
  act(() => { tree = create(player()); });
});
afterEach(() => { act(() => tree.unmount()); });

it('releases a loaded track and starts the next track idle', async () => {
  await act(async () => { await play(); });
  const first = mockCreate.mock.results[0].value;
  expect(first.play).toHaveBeenCalledTimes(1);
  act(() => tree.update(player('https://example.test/b.mp3')));
  expect(first.pause).toHaveBeenCalled();
  expect(first.remove).toHaveBeenCalledTimes(1);
  expect(onPosition).toHaveBeenLastCalledWith(null);
  expect(tree.root.findByProps({ accessibilityLabel: 'Play Track' }).props.disabled).toBe(false);
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

it.each(['track changes', 'access is lost'])('cancels a pending load when %s', async (change) => {
  let resolveMode!: () => void;
  mockMode.mockReturnValueOnce(new Promise<void>((resolve) => { resolveMode = resolve; }));
  let pending!: Promise<void>;
  act(() => { pending = play(); });
  act(() => tree.update(change === 'track changes'
    ? player('https://example.test/b.mp3') : player(undefined, 'Out of range')));
  await act(async () => { resolveMode(); await pending; });
  expect(mockCreate).not.toHaveBeenCalled();
});

it('does not resume an unloaded player after its initial seek resolves', async () => {
  const first = sound();
  let resolveSeek!: () => void;
  first.seekTo.mockReturnValueOnce(new Promise<void>((resolve) => { resolveSeek = resolve; }));
  mockCreate.mockReturnValueOnce(first);
  act(() => tree.update(player(undefined, undefined, 1000)));
  let pending!: Promise<void>;
  await act(async () => { pending = play(); });
  act(() => tree.update(player(undefined, 'Out of range', 1000)));
  await act(async () => { resolveSeek(); await pending; });
  expect(first.remove).toHaveBeenCalledTimes(1);
  expect(first.play).not.toHaveBeenCalled();
});

it('keeps the current player when the trim window changes', async () => {
  await act(async () => { await play(); });
  const first = mockCreate.mock.results[0].value;
  act(() => tree.update(player(undefined, undefined, 2000)));
  expect(first.remove).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledTimes(1);
});
