import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { PinNoteEditor } from '../../components/PinNoteEditor';

jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../constants/theme').lightColors }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('../../components/ui/icons', () => ({ IconClose: 'IconClose' }));

let tree: ReactTestRenderer;
const onSave = jest.fn();
const onClose = jest.fn();
const editor = (placeId = 'pin-a', visible = true, note = 'Saved note') =>
  <PinNoteEditor placeId={placeId} placeTitle="Cafe" visible={visible} note={note} onSave={onSave} onClose={onClose} />;
const field = () => tree.root.findByType(TextInput).props;
beforeEach(() => { jest.clearAllMocks(); act(() => { tree = create(editor()); }); });
afterEach(() => { act(() => tree.unmount()); });

it('discards an abandoned draft on reopening the same pin', () => {
  act(() => field().onChangeText('Abandoned'));
  act(() => tree.update(editor('pin-a', false)));
  act(() => tree.update(editor()));
  expect(field().value).toBe('Saved note');
  expect(onSave).not.toHaveBeenCalled();
});

it('resets for a different pin even when title and saved note match', () => {
  act(() => field().onChangeText('For pin A'));
  act(() => tree.update(editor('pin-b')));
  expect(field().value).toBe('Saved note');
});

it('accepts a changed saved note without copying it through an effect', () => {
  act(() => field().onChangeText('Draft'));
  act(() => tree.update(editor('pin-a', true, 'Updated elsewhere')));
  expect(field().value).toBe('Updated elsewhere');
});
