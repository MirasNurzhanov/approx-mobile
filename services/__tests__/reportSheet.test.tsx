import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, TextInput } from 'react-native';
import { ReportSheet } from '../../components/ReportSheet';
import { REPORT_REASONS, reportContent } from '../reporting';

jest.mock('../api', () => ({ api: { post: jest.fn() } }));
jest.mock('../reporting', () => ({ ...jest.requireActual('../reporting'), reportContent: jest.fn() }));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../constants/theme').lightColors }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('../../components/ui/icons', () => ({ IconClose: 'IconClose' }));
jest.mock('../../components/ui/useSheetDrag', () => ({ useSheetDrag: () => ({}) }));
jest.mock('react-native-gesture-handler', () => ({ GestureDetector: 'GestureDetector' }));

let tree: ReactTestRenderer;
const onReported = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(reportContent).mockResolvedValue(undefined);
  act(() => { tree = create(<ReportSheet visible target="swift" targetId={7}
    subject="this Swift" onClose={() => {}} onReported={onReported} />); });
});
afterEach(() => { act(() => tree.unmount()); });

it('selects a virtualized reason and submits the footer note', async () => {
  expect(tree.root.findByType(FlatList).props.data).toEqual(REPORT_REASONS);
  act(() => tree.root.findByProps({ accessibilityLabel: 'Spam or a scam' }).props.onPress());
  expect(tree.root.findByProps({ accessibilityLabel: 'Spam or a scam' }).props.accessibilityState.selected).toBe(true);
  act(() => tree.root.findByType(TextInput).props.onChangeText('Details'));
  await act(async () => { await tree.root.findByProps({ accessibilityLabel: 'Send report' }).props.onPress(); });
  expect(reportContent).toHaveBeenCalledWith('swift', 7, 'spam', 'Details');
  expect(onReported).toHaveBeenCalledTimes(1);
  expect(tree.root.findByProps({ accessibilityLabel: 'Done' })).toBeDefined();
});

it('keeps the selected reason and note available for retry after failure', async () => {
  jest.mocked(reportContent).mockRejectedValueOnce(new Error('offline'));
  act(() => tree.root.findByProps({ accessibilityLabel: 'Something else' }).props.onPress());
  act(() => tree.root.findByType(TextInput).props.onChangeText('Keep this'));
  await act(async () => { await tree.root.findByProps({ accessibilityLabel: 'Send report' }).props.onPress(); });
  expect(tree.root.findByType(TextInput).props.value).toBe('Keep this');
  expect(tree.root.findByProps({ accessibilityLabel: 'Something else' }).props.accessibilityState.selected).toBe(true);
  expect(tree.root.findByProps({ accessibilityLabel: 'Send report' }).props.disabled).toBe(false);
  expect(onReported).not.toHaveBeenCalled();
});
