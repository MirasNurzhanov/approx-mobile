/* eslint-disable @typescript-eslint/no-require-imports -- Jest factories run before imports. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Modal, Platform, Text } from 'react-native';
import { VenueSheet } from '../../components/map/VenueSheet';
import { VenueLayer } from '../../components/map/VenueMarker';
import { useMapVenues } from '../../hooks/useMapVenues';
import { useMeetupProposal } from '../../app/clubs/[id]/chat';
import { venueProposalRoute, venueSwiftRoute, type Venue } from '../venues';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockMyClubs = jest.fn();
const mockPush = jest.fn();
const mockClose = jest.fn();
jest.mock('../api', () => ({ api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) } }));
jest.mock('../clubs', () => ({ clubsApi: { myList: () => mockMyClubs() } }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../../context/ThemeContext', () => ({ useTheme: () => ({ colors: require('../../constants/theme').lightColors }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: 'MockMarker' }));
jest.mock('../../components/ContentActions', () => ({ useContentActions: jest.fn() }));
jest.mock('../../components/PermissionPrimer', () => ({ usePermissionPrimer: jest.fn() }));
jest.mock('../../components/ui/GlassSurface', () => ({ GlassIconButton: () => null, GlassSurface: () => null }));
jest.mock('../../components/ui/Avatar', () => ({ Avatar: () => null }));

const venue: Venue = { id: 7, slug: 'dostyk-plaza', name: 'Dostyk Plaza', category: 'Shopping mall',
  address: 'Samal-2, 111, Almaty', description: 'Meet here.', image_url: '', latitude: 43.233139, longitude: 76.956562 };
const clubs = [{ id: 2, name: 'Book club' }, { id: 3, name: 'Friends' }];
let tree: ReactTestRenderer;
let proposal: ReturnType<typeof useMeetupProposal>;
let mapVenues: ReturnType<typeof useMapVenues>;
const ensure = jest.fn();
function Proposal({ id = '7', request = 'first' }: { id?: string; request?: string }) {
  proposal = useMeetupProposal(2, ensure, id, request);
  return null;
}
function MapHarness() { mapVenues = useMapVenues(); return null; }
const text = () => tree.root.findAllByType(Text).map(node => node.props.children).flat().join(' ');
async function press(label: string) {
  const button = tree.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function').find(node =>
    node.props.accessibilityLabel === label || node.findAllByType(Text).some(child => child.props.children === label));
  expect(button).toBeDefined();
  await act(async () => { button!.props.onPress(); });
}
beforeEach(() => {
  jest.clearAllMocks(); mockGet.mockReset().mockResolvedValue({ data: venue });
  mockPost.mockReset().mockResolvedValue({ data: {} }); mockMyClubs.mockReset().mockResolvedValue({ data: clubs });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { if (tree) act(() => tree.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

it('shows the venue and both actions, and opens the composer for this venue', async () => {
  await act(async () => { tree = create(<VenueSheet venue={venue} onClose={mockClose} />); });
  expect(text()).toContain('Dostyk Plaza'); expect(text()).toContain('Samal-2');
  expect(mockMyClubs).not.toHaveBeenCalled();
  await press('Propose a meetup');
  expect(mockMyClubs).toHaveBeenCalledTimes(1);
  expect(text()).toContain('Book club'); expect(text()).toContain('Friends');
  await press('Propose a meetup with Book club');
  expect(mockClose).toHaveBeenCalledTimes(1);
  if (Platform.OS === 'ios') {
    expect(mockPush).not.toHaveBeenCalled();
    act(() => { tree.root.findByType(Modal).props.onDismiss(); });
  }
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/clubs/[id]/chat', params: {
    id: '2', venueId: '7', venueRequest: expect.any(String), name: 'Book club',
  } });
});

it('sends the composer this venue by id, and never its coordinates', async () => {
  // Same rule as the meetup proposal: the composer asks the server where the
  // venue is. A coordinate carried in navigation state is one anybody can
  // edit, and it would end up attached to a published Swift.
  await act(async () => { tree = create(<VenueSheet venue={venue} onClose={mockClose} />); });
  await press('Make a swift at Dostyk Plaza');
  expect(mockClose).toHaveBeenCalled();
  const route = venueSwiftRoute(venue.id);
  expect(route).toEqual({ pathname: '/swifts/compose', params: { venueId: '7' } });
  expect(JSON.stringify(route)).not.toContain(String(venue.latitude));
  // iOS routes after the sheet finishes dismissing; both platforms end up here.
  if (mockPush.mock.calls.length === 0) {
    act(() => { tree.root.findByType(Modal).props.onDismiss(); });
  }
  expect(mockPush).toHaveBeenCalledWith(route);
});

it('keeps the club choice explicit even with one club', async () => {
  mockMyClubs.mockResolvedValue({ data: [clubs[0]] });
  await act(async () => { tree = create(<VenueSheet venue={venue} onClose={mockClose} />); });
  await press('Propose a meetup');
  expect(text()).toContain('Book club'); expect(mockPush).not.toHaveBeenCalled();
});

it('handles no clubs without creating or submitting a meetup', async () => {
  mockMyClubs.mockResolvedValue({ data: [] });
  await act(async () => { tree = create(<VenueSheet venue={venue} onClose={mockClose} />); });
  await press('Propose a meetup');
  expect(text()).toContain('Join or create a club');
  await press('Create a club');
  if (Platform.OS === 'ios') act(() => { tree.root.findByType(Modal).props.onDismiss(); });
  expect(mockPush).toHaveBeenCalledWith('/create-club'); expect(mockPost).not.toHaveBeenCalled();
});

it('offers a retry on club-fetch failure, distinct from an empty list', async () => {
  mockMyClubs.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { tree = create(<VenueSheet venue={venue} onClose={mockClose} />); });
  await press('Propose a meetup');
  expect(text()).toContain('Could not load your clubs');
  expect(text()).not.toContain('Join or create');
  await press('Try again'); expect(text()).toContain('Book club');
});

it('ignores stale club responses after closing and reopening a venue', async () => {
  let resolve!: (value: unknown) => void;
  mockMyClubs.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  await act(async () => { tree = create(<VenueSheet venue={venue} onClose={mockClose} />); });
  await press('Propose a meetup');
  await act(async () => { tree.update(<VenueSheet venue={null} onClose={mockClose} />); });
  await act(async () => { tree.update(<VenueSheet venue={venue} onClose={mockClose} />); });
  await act(async () => { resolve({ data: clubs }); });
  expect(text()).toContain('Propose a meetup'); expect(text()).not.toContain('Book club');
});

it('loads venues independently and retries a failed map request', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { tree = create(<MapHarness />); });
  expect(mapVenues.error).toBe(true); expect(mapVenues.venues).toEqual([]);
  mockGet.mockResolvedValueOnce({ data: { results: [venue], next: null } });
  await act(async () => { mapVenues.retry(); });
  expect(mapVenues.error).toBe(false); expect(mapVenues.venues).toEqual([venue]);
  expect(mockGet).toHaveBeenLastCalledWith('/api/venues/');
});

it('prefills the existing proposal from server data and posts the venue link and meeting point', async () => {
  await act(async () => { tree = create(<Proposal />); });
  expect(mockGet).toHaveBeenCalledWith('/api/venues/7/');
  expect(proposal.modalProps.modalView).toBe('proposal');
  expect(proposal.modalProps.propLocation).toEqual({ name: venue.name, lat: venue.latitude, lng: venue.longitude, venue_id: 7 });
  act(() => { proposal.modalProps.onTitleChange('Coffee'); proposal.modalProps.onMeetingPointChange(' Main entrance '); });
  await act(async () => { await proposal.modalProps.onSubmit(); });
  expect(mockPost).toHaveBeenCalledWith('/api/clubs/2/events/', expect.objectContaining({ title: 'Coffee', venue_id: 7, meeting_point: 'Main entrance' }));
  expect(proposal.modalProps.modalView).toBe(null);
  expect(proposal.modalProps.meetingPoint).toBe('');
});

it('clearing the venue removes its association and meeting point', async () => {
  await act(async () => { tree = create(<Proposal />); });
  act(() => { proposal.modalProps.onTitleChange('Anywhere'); proposal.modalProps.onMeetingPointChange('Entrance'); });
  act(() => { proposal.modalProps.onClearLocation(); });
  await act(async () => { await proposal.modalProps.onSubmit(); });
  expect(mockPost.mock.calls[0][1]).toEqual(expect.objectContaining({ venue_id: undefined, meeting_point: '' }));
});

it('keeps a failed submission draft, blocks duplicate taps, and does not reopen after dismissal', async () => {
  let reject!: (reason: Error) => void;
  mockPost.mockReturnValueOnce(new Promise((_resolve, r) => { reject = r; }));
  await act(async () => { tree = create(<Proposal />); });
  act(() => { proposal.modalProps.onTitleChange('Coffee'); });
  act(() => { void proposal.modalProps.onSubmit(); void proposal.modalProps.onSubmit(); });
  expect(mockPost).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('offline')); });
  expect(proposal.modalProps.propTitle).toBe('Coffee');
  expect(proposal.modalProps.modalView).toBe('proposal');
  act(() => { proposal.modalProps.onDismiss(); });
  await act(async () => { tree.update(<Proposal />); });
  expect(proposal.modalProps.modalView).toBe(null);
});

it('does not open a blank proposal when venue lookup fails', async () => {
  mockGet.mockRejectedValueOnce(new Error('not found'));
  await act(async () => { tree = create(<Proposal />); });
  expect(proposal.modalProps.modalView).toBe(null);
  expect(Alert.alert).toHaveBeenCalledWith('Venue unavailable', expect.any(String));
});

it('rejects malformed route ids without making a request', async () => {
  await act(async () => { tree = create(<Proposal id="../../admin" />); });
  expect(mockGet).not.toHaveBeenCalled(); expect(proposal.modalProps.modalView).toBe(null);
});

it('opens a fresh proposal when the same venue is selected again', async () => {
  await act(async () => { tree = create(<Proposal />); });
  act(() => { proposal.modalProps.onTitleChange('Old draft'); proposal.modalProps.onDismiss(); });
  await act(async () => { tree.update(<Proposal request="second" />); });
  expect(proposal.modalProps.modalView).toBe('proposal'); expect(proposal.modalProps.propTitle).toBe('');
});

it('routes ids only, never trusts client-supplied venue coordinates', () => {
  expect(venueProposalRoute(2, 7).params).toEqual({ id: '2', venueId: '7', venueRequest: expect.any(String) });
});

it('draws the venue at its actual coordinates and parks removed native pins', async () => {
  jest.useFakeTimers();
  const onOpen = jest.fn();
  const parkedAt = { latitude: 43, longitude: 76 };
  await act(async () => { tree = create(<VenueLayer venues={[venue]} parkedAt={parkedAt} onOpen={onOpen} />); });
  const marker = () => tree.root.findAll(node => node.type === 'MockMarker')[0];
  expect(marker().props.coordinate).toEqual({ latitude: venue.latitude, longitude: venue.longitude });
  act(() => { marker().props.onPress(); });
  expect(onOpen).toHaveBeenCalledWith(venue);
  act(() => { jest.advanceTimersByTime(800); });
  expect(marker().props.tracksViewChanges).toBe(false);
  await act(async () => { tree.update(<VenueLayer venues={[]} parkedAt={parkedAt} onOpen={onOpen} />); });
  expect(marker().props.opacity).toBe(0);
  expect(marker().props.tappable).toBe(false);
  expect(marker().props.tracksViewChanges).toBe(true);
  act(() => { marker().props.onPress(); });
  expect(onOpen).toHaveBeenCalledTimes(1);
});

it('draws a venue as a small disc with its name in the shared caption plate', async () => {
  // It was a filled, name-inside pill about 200pt wide, which made a few
  // venues the loudest thing on the map. The colour is a dot the size of a
  // person's now, and the name sits in the same plate every marker uses.
  const { StyleSheet } = require('react-native');
  const { venueAppearance } = require('../venueAppearance');
  const appearance = venueAppearance(venue);

  await act(async () => { tree = create(<VenueLayer venues={[venue]} parkedAt={{ latitude: 43, longitude: 76 }} onOpen={jest.fn()} />); });

  const styles = tree.root.findAll(node => typeof node.type === 'string')
    .map(node => StyleSheet.flatten(node.props.style) ?? {});
  const disc = styles.find(style => style.backgroundColor === appearance.color);
  expect(disc).toBeDefined();
  expect(disc.width).toBeLessThanOrEqual(32);
  expect(disc.height).toBeLessThanOrEqual(32);
  // Nothing else on the marker is painted in the venue's colour: no pill.
  expect(styles.filter(style => style.backgroundColor === appearance.color)).toHaveLength(1);

  // The name is still there, one line, in the caption plate's width budget.
  expect(text()).toContain('Dostyk Plaza');
  const caption = tree.root.findAllByType(Text).find(node => node.props.children === 'Dostyk Plaza');
  expect(caption!.props.numberOfLines).toBe(1);
  const plate = StyleSheet.flatten(caption!.parent!.props.style) ?? {};
  expect(plate.maxWidth).toBeLessThanOrEqual(108);

  // The tail still points at the venue rather than the middle of the box.
  const marker = tree.root.findAll(node => node.type === 'MockMarker')[0];
  expect(marker.props.anchor.y).toBeGreaterThan(0.5);
  expect(marker.props.anchor.y).toBeLessThan(0.75);
});

it('does not draw non-finite venue coordinates', async () => {
  await act(async () => { tree = create(<VenueLayer venues={[{ ...venue, latitude: NaN }]}
    parkedAt={{ latitude: 43, longitude: 76 }} onOpen={jest.fn()} />); });
  expect(tree.root.findAll(node => node.type === 'MockMarker')).toHaveLength(0);
});

it('a venue picked on the map replaces a dropped pin and posts as that venue', async () => {
  await act(async () => { tree = create(<Proposal id={undefined} />); });
  act(() => { proposal.open(); proposal.modalProps.onOpenMap(); });
  expect(proposal.modalProps.modalView).toBe('map');
  act(() => { proposal.modalProps.onConfirmVenue(venue); });
  expect(proposal.modalProps.modalView).toBe('proposal');
  expect(proposal.modalProps.propLocation).toEqual({ name: venue.name, lat: venue.latitude, lng: venue.longitude, venue_id: 7 });
  act(() => { proposal.modalProps.onTitleChange('Coffee'); });
  await act(async () => { await proposal.modalProps.onSubmit(); });
  expect(mockPost).toHaveBeenCalledWith('/api/clubs/2/events/', expect.objectContaining({ venue_id: 7, location_name: 'Dostyk Plaza' }));
});
