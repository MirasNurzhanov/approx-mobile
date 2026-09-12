/* eslint-disable @typescript-eslint/no-require-imports -- Jest factories run before imports. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { RefreshControl, Text } from 'react-native';

import SwiftAnalyticsScreen from '../../app/swifts/analytics';
import { AnalyticsChart } from '../../components/swifts/analytics/AnalyticsChart';
import { lightColors } from '../../constants/theme';
import { api } from '../api';
import { fetchSwiftAnalytics, periodChange, type AnalyticsDays, type SwiftAnalytics } from '../swiftAnalytics';

const mockPush = jest.fn();
let mockParams: { swift_id?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => (() => void)) => {
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: require('../../constants/theme').lightColors }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-svg', () => ({
  __esModule: true, default: 'Svg', Circle: 'Circle', Line: 'Line', Path: 'Path', Rect: 'Rect',
}));
jest.mock('../api', () => ({ api: { get: jest.fn() } }));
const get = api.get as jest.Mock;

function report(days: AnalyticsDays = 28, views = 4): SwiftAnalytics {
  const zero = { views: 0, likes: 0, comments: 0, reposts: 0 };
  return {
    days, start_date: '2026-08-13', end_date: '2026-09-09', timezone: 'UTC',
    totals: { videos: 2, views: 20, likes: 2, comments: 1, reposts: 1 },
    period: { ...zero, views }, previous_period: zero,
    series: [
      { ...zero, date: '2026-09-07', views: 1 },
      { ...zero, date: '2026-09-08', views: 0 },
      { ...zero, date: '2026-09-09', views: 3 },
    ],
    top_swifts: [{ id: 42, caption: 'A day at the desk', thumbnail_url: '', created_at: '2026-09-01T23:00:00Z', views }],
    definitions: { views: 'First recorded view per person and Swift.', engagements: 'Retained likes, comments and reposts.' },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let tree: ReactTestRenderer | undefined;
async function render() {
  await act(async () => { tree = create(<SwiftAnalyticsScreen />); });
  return tree!;
}
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  mockParams = {};
  jest.clearAllMocks();
  get.mockReset();
});

it.each([
  [0, 0, '—'], [4, 0, 'New'], [0, 4, '-100%'], [15, 10, '+50%'], [1, 3, '-66.7%'],
])('formats a period comparison %s / %s without inventing a zero-baseline percentage', (current, prior, expected) => {
  expect(periodChange(Number(current), Number(prior))).toBe(expected);
});

it('requests the authorized endpoint with period, optional Swift and cancellation signal', async () => {
  const controller = new AbortController();
  get.mockResolvedValueOnce({ data: report(7) });
  await fetchSwiftAnalytics(7, 42, controller.signal);
  expect(get).toHaveBeenCalledWith('/api/swifts/analytics/', {
    params: { days: 7, swift_id: 42 }, signal: controller.signal,
  });
});

it('keeps a selected owner Swift scoped when switching reporting ranges', async () => {
  mockParams = { swift_id: '42' };
  get.mockResolvedValue({ data: report() });
  const screen = await render();
  expect(get.mock.calls[0][1].params).toEqual({ days: 28, swift_id: 42 });
  expect(screen.root.findAllByType(Text).map(node => node.props.children)).toContain('Video analytics');
  await act(async () => screen.root.findByProps({ testID: 'analytics-range-90' }).props.onPress());
  expect(get.mock.calls[1][1].params).toEqual({ days: 90, swift_id: 42 });
});

it('discards an older range result even when the transport ignores cancellation', async () => {
  const old = deferred<{ data: SwiftAnalytics }>();
  const next = deferred<{ data: SwiftAnalytics }>();
  get.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const screen = await render();
  const oldSignal = get.mock.calls[0][1].signal as AbortSignal;
  await act(async () => screen.root.findByProps({ testID: 'analytics-range-7' }).props.onPress());
  expect(oldSignal.aborted).toBe(true);
  await act(async () => next.resolve({ data: report(7, 77) }));
  expect(screen.root.findByProps({ testID: 'analytics-metric-views' }).props.accessibilityLabel).toContain('77');
  await act(async () => old.resolve({ data: report(28, 28) }));
  expect(screen.root.findByProps({ testID: 'analytics-metric-views' }).props.accessibilityLabel).toContain('77');
  expect(screen.root.findByProps({ testID: 'analytics-range-7' }).props.accessibilityState.selected).toBe(true);
});

it('shows an actionable failure and recovers on retry', async () => {
  get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: report() });
  const screen = await render();
  expect(() => screen.root.findByProps({ testID: 'analytics-metric-views' })).toThrow();
  await act(async () => screen.root.findByProps({ accessibilityLabel: 'Retry analytics' }).props.onPress());
  expect(screen.root.findByProps({ testID: 'analytics-metric-views' }).props.accessibilityLabel).toContain('4');
});

it('preserves loaded figures during a failed pull-to-refresh and labels them as stale', async () => {
  get.mockResolvedValueOnce({ data: report() }).mockRejectedValueOnce(new Error('offline'));
  const screen = await render();
  await act(async () => screen.root.findByType(RefreshControl).props.onRefresh());
  expect(screen.root.findByProps({ testID: 'analytics-metric-views' }).props.accessibilityLabel).toContain('4');
  expect(screen.root.findAllByType(Text).map(node => node.props.children)).toContain('Showing your last loaded figures.');
});

it('shows the real empty state and opens an owned top Swift when data exists', async () => {
  const empty = report();
  empty.totals.videos = 0;
  empty.top_swifts = [];
  get.mockResolvedValueOnce({ data: empty }).mockResolvedValueOnce({ data: report() });
  const screen = await render();
  expect(screen.root.findAllByType(Text).map(node => node.props.children)).toContain('Your story starts here');
  await act(async () => screen.root.findByType(RefreshControl).props.onRefresh());
  await act(async () => screen.root.findByProps({ accessibilityLabel: 'Open Swift 1: A day at the desk, 4 video views' }).props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/swifts/[id]', params: { id: 42 } });
});

it('cancels a pending request when the screen leaves', async () => {
  const pending = deferred<{ data: SwiftAnalytics }>();
  get.mockReturnValueOnce(pending.promise);
  await render();
  const signal = get.mock.calls[0][1].signal as AbortSignal;
  act(() => tree!.unmount());
  tree = undefined;
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ data: report() }));
});

it('switches the chart to the selected engagement metric', async () => {
  const data = report();
  data.period.likes = 2;
  data.series[2].likes = 2;
  get.mockResolvedValueOnce({ data });
  const screen = await render();
  act(() => screen.root.findByProps({ testID: 'analytics-metric-likes' }).props.onPress());
  expect(screen.root.findByProps({ testID: 'analytics-chart' }).props.accessibilityLabel).toContain('2 likes');
  expect(screen.root.findByProps({ testID: 'analytics-metric-likes' }).props.accessibilityState.selected).toBe(true);
});

it('lets a person inspect chart days by touch and accessibility actions', async () => {
  await act(async () => { tree = create(<AnalyticsChart series={report().series} metric="views" colors={lightColors} />); });
  const chart = () => tree!.root.findByProps({ testID: 'analytics-chart' });
  expect(chart().props.accessibilityValue.now).toBe(3);
  act(() => chart().props.onPress({ nativeEvent: { locationX: 16 } }));
  expect(chart().props.accessibilityValue.now).toBe(1);
  expect(chart().props.accessibilityValue.text).toContain('1 views');
  act(() => chart().props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
  expect(chart().props.accessibilityValue.now).toBe(2);
  expect(chart().props.accessibilityValue.text).toContain('0 views');
  act(() => tree!.root.findByProps({ testID: 'chart-bars' }).props.onPress());
  expect(tree!.root.findByProps({ testID: 'chart-bars' }).props.accessibilityState.selected).toBe(true);
});

it('keeps touch selection aligned with graph points after a layout resize', async () => {
  await act(async () => { tree = create(<AnalyticsChart series={report().series} metric="views" colors={lightColors} />); });
  const chart = () => tree!.root.findByProps({ testID: 'analytics-chart' });
  for (const width of [240, 640]) {
    act(() => chart().props.onLayout({ nativeEvent: { layout: { width } } }));
    for (const [x, expectedDay] of [[16, 1], [width / 2, 2], [width - 16, 3]]) {
      act(() => chart().props.onPress({ nativeEvent: { locationX: x } }));
      expect(chart().props.accessibilityValue.now).toBe(expectedDay);
    }
  }
});
