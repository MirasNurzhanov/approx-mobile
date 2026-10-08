import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { Alert } from 'react-native';

import SwiftComposerScreen from '../../app/swifts/compose';
import { CaptureStep } from '../../components/swifts/compose/CaptureStep';
import { DetailsStep } from '../../components/swifts/compose/DetailsStep';
import { PreviewStep } from '../../components/swifts/compose/PreviewStep';
import { AppThemeProvider } from '../../context/ThemeContext';
import type { PublishedSwift } from '../swiftUpload';

const mockPublish = jest.fn();
const mockReplace = jest.fn();
const mockVenue = jest.fn();
const mockPin = jest.fn();
/** Route params, as `venueSwiftRoute` sets them. Named for Jest's rule that
 *  only `mock*` variables may be reached from a module factory. */
let mockParams: Record<string, string> = {};

jest.mock('../swiftUpload', () => ({
  ...jest.requireActual('../swiftUpload'),
  publishSwift: (...args: unknown[]) => mockPublish(...args),
  discardTempFile: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: jest.fn(),
}));
jest.mock('../venues', () => ({ venuesApi: { get: (...args: unknown[]) => mockVenue(...args) } }));
jest.mock('../pinnedPlaces', () => ({
  ...jest.requireActual('../pinnedPlaces'),
  pinSwiftLocation: (...args: unknown[]) => mockPin(...args),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../components/swifts/compose/CaptureStep', () => ({ CaptureStep: 'CaptureStep' }));
jest.mock('../../components/swifts/compose/EditStep', () => ({ EditStep: 'EditStep' }));
jest.mock('../../components/swifts/compose/DetailsStep', () => ({ DetailsStep: 'DetailsStep' }));
jest.mock('../../components/swifts/compose/PreviewStep', () => ({ PreviewStep: 'PreviewStep' }));

let tree: ReactTestRenderer;

async function prepareCapture() {
  await act(async () => {
    tree = create(<AppThemeProvider><SwiftComposerScreen /></AppThemeProvider>);
  });
  await act(async () => {
    tree.root.findByType(CaptureStep).props.onCaptured({
      uri: 'file:///take.mp4', source: 'camera', durationMs: 5000, width: 720, height: 1280,
    });
  });
}

async function prepareTake() {
  await prepareCapture();
  for (let step = 0; step < 2; step += 1) {
    await act(async () => tree.root.findByProps({ accessibilityLabel: 'Next step' }).props.onPress());
  }
}

/** The café on the map, as the server places it. */
const cafe = { id: 7, name: 'Coffee Boom', latitude: 43.238949, longitude: 76.889709 };

/** One step forward, for tests that need to stop on Details. */
async function goNext() {
  await act(async () => tree.root.findByProps({ accessibilityLabel: 'Next step' }).props.onPress());
}

beforeEach(() => {
  mockParams = {};
  mockPublish.mockReset();
  mockReplace.mockReset();
  mockVenue.mockReset().mockResolvedValue({ data: cafe });
  mockPin.mockReset().mockResolvedValue({ ok: true, place: {} });
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

describe('a Swift made at a venue', () => {
  const published = { id: 31 } as PublishedSwift;

  it('attaches the venue the server placed, publishes with it, and pins it', async () => {
    mockParams = { venueId: '7' };
    mockPublish.mockResolvedValue(published);
    await prepareTake();

    // Asked for by id; the route carried no coordinates to trust.
    expect(mockVenue).toHaveBeenCalledWith(7);
    expect(tree.root.findByType(PreviewStep).props.draft).toMatchObject({
      shareLocation: true,
      latitude: cafe.latitude,
      longitude: cafe.longitude,
      placeName: 'Coffee Boom',
    });

    await act(async () => tree.root.findByType(PreviewStep).props.onPublish());
    expect(mockPublish.mock.calls[0][0]).toMatchObject({
      shareLocation: true, latitude: cafe.latitude, longitude: cafe.longitude, placeName: 'Coffee Boom',
    });
    expect(mockPin).toHaveBeenCalledWith({
      swiftId: 31,
      latitude: cafe.latitude,
      longitude: cafe.longitude,
      placeName: 'Coffee Boom',
      precision: 'exact',
    });
    // And it lands on the Swift itself, in the Swifts section.
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/swifts/[id]', params: { id: 31 } });
  });

  it('pins nothing when the creator removed the location before publishing', async () => {
    mockParams = { venueId: '7' };
    mockPublish.mockResolvedValue(published);
    await prepareCapture();
    await goNext();
    // On Details, where the creator takes the venue off the Swift.
    await act(async () => tree.root.findByType(DetailsStep).props.onChange({
      shareLocation: false, latitude: null, longitude: null, placeName: '',
    }));
    await goNext();

    await act(async () => tree.root.findByType(PreviewStep).props.onPublish());
    expect(mockPublish.mock.calls[0][0]).toMatchObject({ shareLocation: false, latitude: null });
    expect(mockPin).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalled();
  });

  it('says so when the map is full, and still publishes', async () => {
    mockParams = { venueId: '7' };
    mockPublish.mockResolvedValue(published);
    mockPin.mockResolvedValue({ ok: false, reason: 'limit' });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await prepareTake();

    await act(async () => tree.root.findByType(PreviewStep).props.onPublish());
    expect(alert).toHaveBeenCalledWith('Your map is full', expect.stringContaining('Coffee Boom'));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/swifts/[id]', params: { id: 31 } });
    alert.mockRestore();
  });

  it('still publishes when the pin cannot be saved at all', async () => {
    mockParams = { venueId: '7' };
    mockPublish.mockResolvedValue(published);
    mockPin.mockRejectedValue(new Error('storage unavailable'));
    await prepareTake();
    await act(async () => tree.root.findByType(PreviewStep).props.onPublish());
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/swifts/[id]', params: { id: 31 } });
  });

  it('leaves an ordinary Swift alone: no venue asked for, nothing pinned', async () => {
    mockPublish.mockResolvedValue(published);
    await prepareTake();
    expect(mockVenue).not.toHaveBeenCalled();
    expect(tree.root.findByType(PreviewStep).props.draft).toMatchObject({
      shareLocation: false, latitude: null, placeName: '',
    });
    await act(async () => tree.root.findByType(PreviewStep).props.onPublish());
    expect(mockPin).not.toHaveBeenCalled();
  });

  it('carries on without a location when the venue cannot be fetched', async () => {
    mockParams = { venueId: '7' };
    mockVenue.mockRejectedValue(new Error('offline'));
    mockPublish.mockResolvedValue(published);
    await prepareTake();
    expect(tree.root.findByType(PreviewStep).props.draft).toMatchObject({ shareLocation: false });
    await act(async () => tree.root.findByType(PreviewStep).props.onPublish());
    expect(mockPin).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalled();
  });
});
