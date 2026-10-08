/**
 * "Delete for everyone" in the overflow menu.
 *
 * Two properties matter more than the rest, and both are the kind that fail
 * silently rather than loudly:
 *
 *   1. It is offered only for your own content. The server is what actually
 *      enforces authorship — it answers 404 to anyone else — but an app that
 *      offers a button which always fails is its own bug.
 *   2. Nothing is deleted without a confirmation. An overflow menu is exactly
 *      where a mis-tap happens, and this action cannot be undone.
 */
import { act, create } from 'react-test-renderer';

import { useContentActions, type ContentActionTarget } from '@/components/ContentActions';

let mockPlatform = 'android';
const mockAlert = jest.fn();
const mockActionSheet = jest.fn();

// Hoisted above the imports by babel-plugin-jest-hoist. Each factory only
// builds accessors — the `mock*` bindings are read when a test calls them, long
// after initialisation — so the apparent order is not a use-before-init.
jest.mock('react-native', () => ({
  get Platform() { return { OS: mockPlatform }; },
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
  ActionSheetIOS: {
    showActionSheetWithOptions: (...args: unknown[]) => mockActionSheet(...args),
  },
}));
jest.mock('@/components/ReportSheet', () => ({ ReportSheet: () => null }));
jest.mock('@/services/blocked', () => ({ blockUser: jest.fn() }));

type Present = (item: ContentActionTarget) => void;

function mountMenu(): Present {
  let present!: Present;
  function Probe() {
    ({ present } = useContentActions());
    return null;
  }
  act(() => { create(<Probe />); });
  return present;
}

const MINE: ContentActionTarget = {
  target: 'swift',
  targetId: 7,
  subject: '@me',
  authorId: 1,
  authorUsername: 'me',
  deleteNoun: 'Swift',
  onDelete: jest.fn().mockResolvedValue(undefined),
};

const SOMEONE_ELSES: ContentActionTarget = {
  target: 'swift',
  targetId: 8,
  subject: '@ada',
  authorId: 2,
  authorUsername: 'ada',
};

/** The buttons from the last Alert.alert call. */
const lastButtons = () => (mockAlert.mock.calls.at(-1)?.[2] ?? []) as {
  text: string; style?: string; onPress?: () => unknown;
}[];
const press = (label: string) => lastButtons().find((b) => b.text === label)?.onPress?.();

beforeEach(() => {
  mockPlatform = 'android';
  mockAlert.mockReset();
  mockActionSheet.mockReset();
  (MINE.onDelete as jest.Mock).mockReset().mockResolvedValue(undefined);
});

describe('who is offered the delete', () => {
  it('offers it on your own content', () => {
    mountMenu()(MINE);
    expect(lastButtons().map((b) => b.text)).toEqual(['Delete Swift', 'Cancel']);
  });

  it('never offers it on someone else\'s', () => {
    mountMenu()(SOMEONE_ELSES);
    const labels = lastButtons().map((b) => b.text);
    expect(labels).toEqual(['Report', 'Block user', 'Cancel']);
    expect(labels.some((l) => l.startsWith('Delete'))).toBe(false);
  });

  it('replaces Report rather than sitting beside it', () => {
    // Reporting your own video to a moderator is not a thing anyone wants.
    mountMenu()(MINE);
    expect(lastButtons().map((b) => b.text)).not.toContain('Report');
  });

  it('marks it destructive so it does not read as an ordinary row', () => {
    mountMenu()(MINE);
    expect(lastButtons().find((b) => b.text === 'Delete Swift')?.style).toBe('destructive');
  });
});

describe('nothing goes without a confirmation', () => {
  it('does not delete on the menu tap alone', () => {
    const present = mountMenu();
    present(MINE);
    press('Delete Swift');
    // The second Alert is the confirmation — the request has not gone yet.
    expect(MINE.onDelete).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledTimes(2);
  });

  it('says "everyone" and "cannot be undone" in the confirmation', () => {
    const present = mountMenu();
    present(MINE);
    press('Delete Swift');
    const [title, body] = mockAlert.mock.calls.at(-1) as [string, string];
    expect(title).toContain('Swift');
    expect(body).toContain('everyone');
    expect(body).toContain('cannot be undone');
  });

  it('deletes once confirmed', async () => {
    const present = mountMenu();
    present(MINE);
    press('Delete Swift');
    await act(async () => { await press('Delete'); });
    expect(MINE.onDelete).toHaveBeenCalledTimes(1);
  });

  it('does nothing when cancelled', () => {
    const present = mountMenu();
    present(MINE);
    press('Delete Swift');
    press('Cancel');
    expect(MINE.onDelete).not.toHaveBeenCalled();
  });

  it('says so when the delete fails, rather than looking like it worked', async () => {
    (MINE.onDelete as jest.Mock).mockRejectedValue(new Error('offline'));
    const present = mountMenu();
    present(MINE);
    press('Delete Swift');
    await act(async () => { await press('Delete'); });
    const [title, body] = mockAlert.mock.calls.at(-1) as [string, string];
    expect(title).toBe('Could not delete');
    expect(body).toContain('still up');
  });
});

describe('iOS action sheet', () => {
  beforeEach(() => { mockPlatform = 'ios'; });

  it('runs the action the index actually names', () => {
    // The failure mode of a hand-numbered sheet is "Cancel deletes your
    // video", so the mapping is worth pinning.
    const present = mountMenu();
    present(MINE);
    const [config, handler] = mockActionSheet.mock.calls.at(-1) as [
      { options: string[]; cancelButtonIndex: number; destructiveButtonIndex?: number },
      (index: number) => void,
    ];
    expect(config.options).toEqual(['Delete Swift', 'Cancel']);
    expect(config.destructiveButtonIndex).toBe(0);

    // Cancel must do nothing at all.
    handler(config.cancelButtonIndex);
    expect(mockAlert).not.toHaveBeenCalled();

    // The delete row opens the confirmation, not the deletion.
    handler(0);
    expect(MINE.onDelete).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  it('keeps Report and Block for other people\'s content', () => {
    const present = mountMenu();
    present(SOMEONE_ELSES);
    const [config] = mockActionSheet.mock.calls.at(-1) as [{ options: string[] }];
    expect(config.options).toEqual(['Report', 'Block user', 'Cancel']);
  });
});
