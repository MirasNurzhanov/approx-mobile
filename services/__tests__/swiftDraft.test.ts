import {
  EMPTY_DRAFT,
  MAX_CAPTION,
  MAX_HASHTAGS,
  MAX_MENTIONS,
  MAX_OVERLAY,
  MAX_SPEED_PERCENT,
  MAX_STICKERS,
  MAX_SWIFT_MS,
  MIN_SPEED_PERCENT,
  MIN_SWIFT_MS,
  SPEED_CHOICES,
  effectiveHashtags,
  effectiveMentions,
  keptDurationMs,
  keptSourceMs,
  normaliseTag,
  parseHashtags,
  parseMentions,
  playedMs,
  recordLimitMs,
  recordedMs,
  validateDraft,
  type SwiftDraft,
} from '../swiftDraft';
import { SWIFT_EFFECTS, effectFor, hasEffect } from '../../constants/swiftEffects';

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

  it('starts with the original sound audible', () => {
    expect(EMPTY_DRAFT.originalVolume).toBe(100);
  });

  it('starts with the microphone on and no capture settings applied', () => {
    expect(EMPTY_DRAFT.micEnabled).toBe(true);
    expect(EMPTY_DRAFT.speedPercent).toBe(100);
    expect(EMPTY_DRAFT.rotationDeg).toBe(0);
    expect(EMPTY_DRAFT.effect).toBe('');
    expect(EMPTY_DRAFT.stickers).toEqual([]);
    expect(EMPTY_DRAFT.track).toBeNull();
  });
});

// ── Speed ────────────────────────────────────────────────────────────────────
// Speed is the only parameter that changes what "duration" means, and the
// sixty-second ceiling is on *played* time. These are the cases that would
// silently publish a two-minute Swift, or refuse a legal one, if the two
// conversions ever disagreed. They mirror `swifts/capture.py` exactly.

describe('speed and duration', () => {
  it('leaves everything alone at 1x', () => {
    expect(playedMs(20_000, 100)).toBe(20_000);
    expect(recordedMs(20_000, 100)).toBe(20_000);
  });

  it('shortens the played length when sped up', () => {
    expect(playedMs(60_000, 200)).toBe(30_000);
  });

  it('lengthens it when slowed down', () => {
    expect(playedMs(30_000, 50)).toBe(60_000);
  });

  it('round-trips through both directions at every offered speed', () => {
    for (const speed of SPEED_CHOICES) {
      expect(recordedMs(playedMs(45_000, speed), speed)).toBe(45_000);
    }
  });

  it('clamps a speed outside the range rather than producing nonsense', () => {
    expect(playedMs(10_000, 0)).toBe(playedMs(10_000, MIN_SPEED_PERCENT));
    expect(playedMs(10_000, 9_999)).toBe(playedMs(10_000, MAX_SPEED_PERCENT));
  });

  it('measures the kept length in played time', () => {
    // 30 seconds of source at half speed is a minute on screen.
    expect(keptDurationMs(draft({ durationMs: 30_000, speedPercent: 50 }))).toBe(60_000);
  });

  it('keeps the source length available separately', () => {
    expect(keptSourceMs(draft({ durationMs: 30_000, speedPercent: 50 }))).toBe(30_000);
  });
});

describe('validateDraft, once speed is involved', () => {
  it('accepts 90 seconds of source at 150%', () => {
    expect(validateDraft(draft({
      durationMs: 90_000, trimEndMs: 90_000, speedPercent: 150,
    }))).toEqual([]);
  });

  it('rejects 45 seconds of source at half speed', () => {
    const problems = validateDraft(draft({
      durationMs: 45_000, trimEndMs: 45_000, speedPercent: 50,
    }));
    expect(problems.map((p) => p.field)).toContain('trim');
  });

  it('rejects a take too short to be a second once sped up', () => {
    // 2 seconds of source at 3x is two-thirds of a second on screen.
    const problems = validateDraft(draft({
      durationMs: 2_000, trimEndMs: 2_000, speedPercent: 300,
    }));
    expect(problems.map((p) => p.field)).toContain('trim');
  });
});

describe('recordLimitMs', () => {
  it('is the full minute of source at 1x', () => {
    expect(recordLimitMs(draft())).toBe(MAX_SWIFT_MS);
  });

  it('lets the camera roll longer when the take will be sped up', () => {
    expect(recordLimitMs(draft({ speedPercent: 200 }))).toBe(120_000);
  });

  it('stops it sooner when the take will be slowed down', () => {
    expect(recordLimitMs(draft({ speedPercent: 50 }))).toBe(30_000);
  });

  it('honours the creator-set ceiling', () => {
    expect(recordLimitMs(draft({ limitMs: 15_000 }))).toBe(15_000);
  });

  it('applies speed to that ceiling too', () => {
    // 15 played seconds at 2x needs 30 seconds of filming.
    expect(recordLimitMs(draft({ limitMs: 15_000, speedPercent: 200 }))).toBe(30_000);
  });

  it('never lets a chosen ceiling exceed the hard maximum', () => {
    expect(recordLimitMs(draft({ limitMs: 999_000 }))).toBe(MAX_SWIFT_MS);
  });
});

// ── Stickers, hashtags and mentions ──────────────────────────────────────────

describe('validateDraft, stickers and tags', () => {
  const stickerList = (count: number) => Array.from({ length: count }, (_, i) => ({
    id: `s${i}`, emoji: '*', x: 0.5, y: 0.5, scale: 1, rotation: 0,
  }));

  it('rejects more stickers than the limit', () => {
    expect(validateDraft(draft({ stickers: stickerList(MAX_STICKERS + 1) }))
      .map((p) => p.field)).toContain('stickers');
  });

  it('accepts exactly the limit', () => {
    expect(validateDraft(draft({ stickers: stickerList(MAX_STICKERS) }))).toEqual([]);
  });

  it('rejects too many hashtags', () => {
    const hashtags = Array.from({ length: MAX_HASHTAGS + 1 }, (_, i) => `tag${i}`);
    expect(validateDraft(draft({ hashtags })).map((p) => p.field)).toContain('hashtags');
  });

  it('rejects too many mentions', () => {
    const mentions = Array.from({ length: MAX_MENTIONS + 1 }, (_, i) => `person${i}`);
    expect(validateDraft(draft({ mentions })).map((p) => p.field)).toContain('mentions');
  });
});

// These have to agree with `swifts/tagging.py`, which parses the caption again
// on publish. A disagreement shows up as the composer promising one set of tags
// and the published Swift carrying another.
describe('parseHashtags', () => {
  it('finds tags in running text, in order', () => {
    expect(parseHashtags('sunset at #KokTobe with #friends'))
      .toEqual(['koktobe', 'friends']);
  });

  it('folds case together', () => {
    expect(parseHashtags('#Astana #ASTANA #astana')).toEqual(['astana']);
  });

  it('ignores a hash in the middle of a word', () => {
    expect(parseHashtags('ab#cd')).toEqual([]);
  });

  it('ignores a tag of digits alone', () => {
    expect(parseHashtags('in #2024 I went')).toEqual([]);
  });

  it('keeps a tag that merely contains digits', () => {
    expect(parseHashtags('#top10')).toEqual(['top10']);
  });

  it('reads non-Latin scripts', () => {
    expect(parseHashtags('#almaty2')).toEqual(['almaty2']);
  });
});

describe('parseMentions', () => {
  it('finds handles in order and lowercases them', () => {
    expect(parseMentions('with @Aisha and @dias')).toEqual(['aisha', 'dias']);
  });

  it('ignores an at-sign inside a word', () => {
    expect(parseMentions('mail me at name@example.com')).toEqual([]);
  });

  it('drops a trailing full stop', () => {
    expect(parseMentions('thanks @aisha.')).toEqual(['aisha']);
  });
});

describe('effectiveHashtags', () => {
  it('merges the caption tags with the field tags, caption first', () => {
    expect(effectiveHashtags(draft({ caption: 'at #koktobe', hashtags: ['sunset'] })))
      .toEqual(['koktobe', 'sunset']);
  });

  it('does not double up a tag that is in both', () => {
    expect(effectiveHashtags(draft({ caption: 'at #koktobe', hashtags: ['koktobe'] })))
      .toEqual(['koktobe']);
  });

  it('caps the merged list', () => {
    const hashtags = Array.from({ length: MAX_HASHTAGS + 5 }, (_, i) => `tag${i}`);
    expect(effectiveHashtags(draft({ hashtags })).length).toBe(MAX_HASHTAGS);
  });
});

describe('effectiveMentions', () => {
  it('merges and normalises', () => {
    expect(effectiveMentions(draft({ caption: 'hey @Aisha', mentions: ['@Dias'] })))
      .toEqual(['aisha', 'dias']);
  });
});

describe('normaliseTag', () => {
  it('strips a leading hash and folds case', () => {
    expect(normaliseTag('#Astana')).toBe('astana');
  });

  it('refuses something that is not a tag', () => {
    expect(normaliseTag('#2024')).toBe('');
    expect(normaliseTag('#!!!')).toBe('');
    expect(normaliseTag('')).toBe('');
  });
});

// ── The effect catalogue ─────────────────────────────────────────────────────
// The server refuses an `effect` key it does not know (`swifts.capture`), so a
// key shipped here and absent there is a publish that fails with a validation
// error the creator can do nothing about.

describe('the effect catalogue', () => {
  it('starts with the untouched original', () => {
    expect(SWIFT_EFFECTS[0].key).toBe('');
    expect(SWIFT_EFFECTS[0].layers).toEqual([]);
  });

  it('has no duplicate keys', () => {
    const keys = SWIFT_EFFECTS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('matches the keys the server accepts', () => {
    // Mirrors `EFFECT_KEYS` in swifts/capture.py. Written out rather than
    // derived, so changing one side and not the other fails here.
    expect(SWIFT_EFFECTS.filter((e) => e.key !== '').map((e) => e.key).sort())
      .toEqual([
        'cool', 'dream', 'fade', 'mono', 'night', 'noir', 'sepia', 'vivid', 'warm',
      ].sort());
  });

  it('gives every treatment at least one drawable layer', () => {
    for (const effect of SWIFT_EFFECTS.filter((e) => e.key !== '')) {
      expect(effect.layers.length).toBeGreaterThan(0);
      for (const layer of effect.layers) {
        expect(layer.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(layer.opacity).toBeGreaterThan(0);
        // Opaque would hide the video entirely rather than tint it.
        expect(layer.opacity).toBeLessThan(1);
      }
    }
  });

  it('uses no blend modes at all', () => {
    // Load-bearing rather than stylistic. `mixBlendMode` needs an
    // `isolation: 'isolate'` stacking context, that context forces the subtree
    // to composite offscreen, and a camera or video surface underneath an
    // offscreen layer renders one frame and then freezes. This shipped once
    // and froze the camera preview; the assertion is here so it cannot come
    // back without somebody reading `constants/swiftEffects` first.
    for (const effect of SWIFT_EFFECTS) {
      for (const layer of effect.layers) {
        expect(layer).not.toHaveProperty('blend');
      }
    }
  });

  it('knows which keys actually draw something', () => {
    expect(hasEffect('')).toBe(false);
    expect(hasEffect(null)).toBe(false);
    expect(hasEffect('no-such-effect')).toBe(false);
    expect(hasEffect('noir')).toBe(true);
  });

  it('resolves an unknown key to the original rather than throwing', () => {
    expect(effectFor('no-such-effect').key).toBe('');
    expect(effectFor(null).key).toBe('');
  });
});
