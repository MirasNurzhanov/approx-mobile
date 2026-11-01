/**
 * "I'm in" / "Nope" on a club meetup card: tapping your answer again takes it
 * back, the proposer gets no buttons, and the faces open the full list.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MeetupResponseBar } from '../../components/clubs/MeetupResponses';
import { mergeBroadcast, NO_RESPONSES, type MeetupResponseSummary } from '../meetupResponses';

jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../constants/theme').lightColors }),
}));
jest.mock('../../components/ui/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));

const answered: MeetupResponseSummary = {
  in_count: 2, out_count: 1, my_answer: 'in',
  preview: [{ id: 1, username: 'amina' }, { id: 2, username: 'dan' }, { id: 3, username: 'sofia' }],
};

let tree: ReactTestRenderer;
const onAnswer = jest.fn();
const onShowAll = jest.fn();
function render(summary: MeetupResponseSummary, canAnswer = true) {
  act(() => {
    tree = create(<MeetupResponseBar summary={summary} canAnswer={canAnswer} busy={false}
      onAnswer={onAnswer} onShowAll={onShowAll} />);
  });
}
const byLabel = (label: string) => tree.root.findByProps({ accessibilityLabel: label });

beforeEach(() => { onAnswer.mockClear(); onShowAll.mockClear(); });
afterEach(() => act(() => tree.unmount()));

it('answers, and tapping the current answer again takes it back', () => {
  render(NO_RESPONSES);
  act(() => byLabel("I'm in").props.onPress());
  expect(onAnswer).toHaveBeenLastCalledWith('in');
  act(() => byLabel('Nope').props.onPress());
  expect(onAnswer).toHaveBeenLastCalledWith('out');
  act(() => tree.update(<MeetupResponseBar summary={answered} canAnswer busy={false}
    onAnswer={onAnswer} onShowAll={onShowAll} />));
  act(() => byLabel("You're in. Tap to take it back.").props.onPress());
  expect(onAnswer).toHaveBeenLastCalledWith(null);
});

it('shows the faces and counts, which open everyone who answered', () => {
  render(answered);
  expect(tree.root.findAllByType('Avatar' as never)).toHaveLength(3);
  act(() => byLabel('2 in, 1 nope. Shows everyone who answered.').props.onPress());
  expect(onShowAll).toHaveBeenCalledTimes(1);
});

it('offers the proposer no buttons, and an unanswered card no summary', () => {
  render(answered, false);
  expect(tree.root.findAllByProps({ accessibilityLabel: "I'm in" })).toHaveLength(0);
  act(() => tree.update(<MeetupResponseBar summary={NO_RESPONSES} canAnswer busy={false}
    onAnswer={onAnswer} onShowAll={onShowAll} />));
  expect(tree.root.findAllByType('Avatar' as never)).toHaveLength(0);
  expect(tree.root.findAll((n) => String(n.props.accessibilityLabel ?? '').includes('Shows everyone'))).toHaveLength(0);
});

it('keeps your own answer when the count changes over the socket', () => {
  const incoming = { in_count: 3, out_count: 1, preview: answered.preview };
  expect(mergeBroadcast(answered, incoming)).toEqual({ ...incoming, my_answer: 'in' });
  expect(mergeBroadcast(undefined, incoming).my_answer).toBeNull();
});
