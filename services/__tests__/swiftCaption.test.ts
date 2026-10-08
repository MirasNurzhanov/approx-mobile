jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import { splitCaption } from '../../components/swifts/SwiftCaption';
import type { SwiftMention } from '../swifts';

/**
 * Turning a caption into pressable runs.
 *
 * The claim worth pinning is the one about mentions: a handle is only a link
 * when the *server* resolved it to an account. Guessing from the text would
 * send a reader to whoever holds that name today, who may be a stranger — so
 * an unresolved `@someone` has to come back as plain text, not as a link to
 * nowhere and not as a link to the wrong person.
 */

const mention = (username: string, user_id: number): SwiftMention => ({ username, user_id });

/** The runs, flattened to `kind:text` pairs, which is what assertions read. */
function runs(caption: string, mentions: SwiftMention[] = []) {
  return splitCaption(caption, mentions).map((s) => `${s.kind}:${s.text}`);
}

describe('splitCaption', () => {
  it('returns nothing for an empty caption', () => {
    expect(splitCaption('', [])).toEqual([]);
  });

  it('leaves a caption with no tags or mentions as one run', () => {
    expect(runs('just a sunset')).toEqual(['text:just a sunset']);
  });

  it('pulls a hashtag out of the middle', () => {
    expect(runs('sunset at #koktobe today'))
      .toEqual(['text:sunset at ', 'tag:#koktobe', 'text: today']);
  });

  it('handles a caption that is only a hashtag', () => {
    expect(runs('#koktobe')).toEqual(['tag:#koktobe']);
  });

  it('finds several hashtags in order', () => {
    expect(runs('#one and #two'))
      .toEqual(['tag:#one', 'text: and ', 'tag:#two']);
  });

  it('does not treat a hash inside a word as a tag', () => {
    expect(runs('ab#cd')).toEqual(['text:ab#cd']);
  });

  it('does not treat a run of digits as a tag', () => {
    // Matches the pattern's shape, is not a tag — and the composer and the
    // server agree, so highlighting it here would be the only place it looked
    // like one.
    expect(runs('back in #2024')).toEqual(['text:back in #2024']);
  });

  describe('mentions', () => {
    it('links a handle the server resolved', () => {
      expect(runs('thanks @aisha', [mention('aisha', 7)]))
        .toEqual(['text:thanks ', 'mention:@aisha']);
    });

    it('carries the id to open', () => {
      const [, link] = splitCaption('hi @aisha', [mention('aisha', 7)]);
      expect(link).toEqual({ kind: 'mention', text: '@aisha', userId: 7 });
    });

    it('matches whatever case the caption used', () => {
      expect(runs('hi @Aisha', [mention('aisha', 7)]))
        .toEqual(['text:hi ', 'mention:@Aisha']);
    });

    it('leaves an unresolved handle as plain text', () => {
      // Nobody by that name, or somebody who blocked the author. Either way
      // there is no account to open.
      expect(runs('hi @nobody', [])).toEqual(['text:hi @nobody']);
    });

    it('does not link an email address', () => {
      expect(runs('mail me at name@example.com', [mention('example', 3)]))
        .toEqual(['text:mail me at name@example.com']);
    });

    it('keeps a trailing full stop outside the link', () => {
      expect(runs('thanks @aisha.', [mention('aisha', 7)]))
        .toEqual(['text:thanks ', 'mention:@aisha', 'text:.']);
    });
  });

  it('interleaves tags and mentions in the order they appear', () => {
    expect(runs('#sunset with @aisha at #koktobe', [mention('aisha', 7)]))
      .toEqual([
        'tag:#sunset',
        'text: with ',
        'mention:@aisha',
        'text: at ',
        'tag:#koktobe',
      ]);
  });

  it('reconstructs the original caption exactly', () => {
    // The property that matters most and is easiest to break: a split that
    // drops or duplicates a character silently rewrites what somebody wrote.
    const caption = '#sunset with @aisha at #koktobe. #2024 ab#cd name@example.com';
    const rebuilt = splitCaption(caption, [mention('aisha', 7)])
      .map((s) => s.text)
      .join('');
    expect(rebuilt).toBe(caption);
  });

  it('reconstructs a caption made only of punctuation and symbols', () => {
    const caption = '!!! ### @@@ #';
    expect(splitCaption(caption, []).map((s) => s.text).join('')).toBe(caption);
  });
});
