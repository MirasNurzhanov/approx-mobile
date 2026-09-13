import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import SwiftComposerScreen from '../../app/swifts/compose';
import { CaptureStep } from '../../components/swifts/compose/CaptureStep';
import { PreviewStep } from '../../components/swifts/compose/PreviewStep';
import { AppThemeProvider } from '../../context/ThemeContext';
import type { PublishedSwift } from '../swiftUpload';

const mockPublish = jest.fn();
const mockReplace = jest.fn();

jest.mock('../swiftUpload', () => ({
  ...jest.requireActual('../swiftUpload'),
  publishSwift: (...args: unknown[]) => mockPublish(...args),
  discardTempFile: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../components/swifts/compose/CaptureStep', () => ({ CaptureStep: 'CaptureStep' }));
jest.mock('../../components/swifts/compose/EditStep', () => ({ EditStep: 'EditStep' }));
jest.mock('../../components/swifts/compose/DetailsStep', () => ({ DetailsStep: 'DetailsStep' }));
jest.mock('../../components/swifts/compose/PreviewStep', () => ({ PreviewStep: 'PreviewStep' }));

let tree: ReactTestRenderer;

async function prepareTake() {
  await act(async () => {
    tree = create(<AppThemeProvider><SwiftComposerScreen /></AppThemeProvider>);
  });
  await act(async () => {
    tree.root.findByType(CaptureStep).props.onCaptured({
      uri: 'file:///take.mp4', source: 'camera', durationMs: 5000, width: 720, height: 1280,
    });
  });
  for (let step = 0; step < 2; step += 1) {
    await act(async () => tree.root.findByProps({ accessibilityLabel: 'Next step' }).props.onPress());
  }
}

beforeEach(() => {
  mockPublish.mockReset();
  mockReplace.mockReset();
});
afterEach(async () => { await act(async () => tree?.unmount()); });

it('blocks same-render double presses before upload progress, and stays locked after success', async () => {
  let resolve!: (swift: PublishedSwift) => void;
  mockPublish.mockReturnValue(new Promise<PublishedSwift>((done) => { resolve = done; }));
  await prepareTake();
  const publish = tree.root.findByType(PreviewStep).props.onPublish;
  let active!: Promise<void>;
  await act(async () => {
    active = publish();
    publish();
  });
  expect(mockPublish).toHaveBeenCalledTimes(1);
  expect(tree.root.findByType(PreviewStep).props.progress.stage).toBe('uploading');
  await act(async () => {
    resolve({ id: 42, video_url: '', thumbnail_url: '', status: 'ready', location_available: false });
    await active;
    publish();
  });
  expect(mockPublish).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/swifts/[id]', params: { id: 42 } });
});

it('keeps the key after failure and assigns a different key to a new take', async () => {
  mockPublish.mockRejectedValue(new Error('connection lost'));
  await prepareTake();
  await act(async () => { await tree.root.findByType(PreviewStep).props.onPublish(); });
  await act(async () => { await tree.root.findByType(PreviewStep).props.onRetry(); });
  const firstKey = mockPublish.mock.calls[0][0].idempotencyKey;
  expect(firstKey).toMatch(/^[a-f0-9-]{36}$/);
  expect(mockPublish.mock.calls[1][0].idempotencyKey).toBe(firstKey);
  await act(async () => tree.unmount());
  await prepareTake();
  await act(async () => { await tree.root.findByType(PreviewStep).props.onPublish(); });
  expect(mockPublish.mock.calls[2][0].idempotencyKey).not.toBe(firstKey);
});
