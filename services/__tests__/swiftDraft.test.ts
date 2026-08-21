import {
  EMPTY_DRAFT,
  MAX_CAPTION,
  MAX_OVERLAY,
  MAX_SWIFT_MS,
  MIN_SWIFT_MS,
  keptDurationMs,
  validateDraft,
  type SwiftDraft,
} from '../swiftDraft';
import { clampTrackOffset, formatTrackDuration } from '../swiftTracks';

/**
 * The composer's pure logic.
 *
 * Everything asserted here is a rule the server also enforces — these exist so
 * a creator finds out before spending a two-minute upload on mobile data, not
 * because the client is trusted with any of it.
 */

function draft(overrides: Partial<SwiftDraft> = {}): SwiftDraft {
  return {
    ...EMPTY_DRAFT,
    uri: 'file:///tmp/take.mp4',
    durationMs: 20_000,
    ...overrides,
  };
}

describe('keptDurationMs', () => {
  it('is the whole source when nothing is trimmed', () => {
    expect(keptDurationMs(draft())).toBe(20_000);
  });

  it('honours both handles', () => {
    expect(keptDurationMs(draft({ trimStartMs: 4_000, trimEndMs: 12_000 }))).toBe(8_000);
  });

  it('treats a null end as the end of the source', () => {
    expect(keptDurationMs(draft({ trimStartMs: 5_000, trimEndMs: null }))).toBe(15_000);
  });

  it('never goes negative', () => {
    expect(keptDurationMs(draft({ trimStartMs: 30_000, trimEndMs: 5_000 }))).toBe(0);
  });
});

describe('validateDraft', () => {
  it('needs a video before anything else', () => {
    const problems = validateDraft({ ...EMPTY_DRAFT, uri: null });
    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe('uri');
  });

  it('accepts an ordinary draft', () => {
    expect(validateDraft(draft())).toEqual([]);
  });

  it('rejects a trim under the floor', () => {
    const problems = validateDraft(draft({ trimStartMs: 0, trimEndMs: MIN_SWIFT_MS - 1 }));
    expect(problems.map((p) => p.field)).toContain('trim');
  });

  it('rejects a Swift over the ceiling', () => {
    const problems = validateDraft(
      draft({ durationMs: MAX_SWIFT_MS + 5_000, trimEndMs: null }),
    );
    expect(problems.map((p) => p.field)).toContain('trim');
  });

  it('accepts exactly the ceiling', () => {
    expect(validateDraft(draft({ durationMs: MAX_SWIFT_MS }))).toEqual([]);
  });

  it('rejects an over-long caption', () => {
    const problems = validateDraft(draft({ caption: 'x'.repeat(MAX_CAPTION + 1) }));
    expect(problems.map((p) => p.field)).toContain('caption');
  });

  it('rejects an over-long overlay', () => {
    const problems = validateDraft(draft({ overlayText: 'x'.repeat(MAX_OVERLAY + 1) }));
    expect(problems.map((p) => p.field)).toContain('overlayText');
  });

  it('refuses to share a location it does not have', () => {
    const problems = validateDraft(
      draft({ shareLocation: true, latitude: null, longitude: null }),
    );
    expect(problems.map((p) => p.field)).toContain('location');
  });

  it('is happy once the location is actually attached', () => {
    expect(validateDraft(
      draft({ shareLocation: true, latitude: 43.2, longitude: 76.9 }),
    )).toEqual([]);
  });

  it('reports every problem rather than only the first', () => {
    const problems = validateDraft(draft({
      caption: 'x'.repeat(MAX_CAPTION + 1),
      overlayText: 'y'.repeat(MAX_OVERLAY + 1),
    }));
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the default draft', () => {
  it('does not attach a location', () => {
    // The default that matters most. A Swift is permanent where the map is
    // session-scoped, so a place has to be a decision rather than an opt-out.
    expect(EMPTY_DRAFT.shareLocation).toBe(false);
    expect(EMPTY_DRAFT.latitude).toBeNull();
    expect(EMPTY_DRAFT.longitude).toBeNull();
    expect(EMPTY_DRAFT.placeName).toBe('');
  });

  it('starts with the original sound audible and no track', () => {
    expect(EMPTY_DRAFT.originalVolume).toBe(100);
    expect(EMPTY_DRAFT.track).toBeNull();
  });
});

describe('clampTrackOffset', () => {
  it('leaves a workable offset alone', () => {
    expect(clampTrackOffset(30_000, 180_000, 15_000)).toBe(30_000);
  });

  it('stops the song starting so late that the Swift runs past its end', () => {
    // 180s track, 15s Swift — the latest usable start is 165s.
    expect(clampTrackOffset(179_000, 180_000, 15_000)).toBe(165_000);
  });

  it('floors at zero', () => {
    expect(clampTrackOffset(-5_000, 180_000, 15_000)).toBe(0);
  });

  it('collapses to zero when the track is shorter than the Swift', () => {
    expect(clampTrackOffset(4_000, 10_000, 15_000)).toBe(0);
  });

  it('survives a track with no known duration', () => {
    expect(clampTrackOffset(4_000, 0, 15_000)).toBe(0);
  });
});

describe('formatTrackDuration', () => {
  it.each([
    [0, '0:00'],
    [9_000, '0:09'],
    [65_000, '1:05'],
    [187_000, '3:07'],
    [600_000, '10:00'],
  ])('%dms is %s', (ms, expected) => {
    expect(formatTrackDuration(ms)).toBe(expected);
  });
});
