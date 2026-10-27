import { buildForm, publishSwift } from '../swiftUpload';
import { createTakeKey, EMPTY_DRAFT, type SwiftDraft } from '../swiftDraft';

// swifts/models.py: latitude/longitude are DecimalField(max_digits=9,
// decimal_places=6). A raw GPS fix carries full double precision, and
// FormData.get returns whatever string was appended — so this catches the
// same overflow Django would reject with "Ensure that there are no more than
// 9 digits in total." without needing a live server.
describe('buildForm — location precision', () => {
  const withLocation: SwiftDraft = {
    ...EMPTY_DRAFT,
    idempotencyKey: createTakeKey(),
    uri: 'file:///swift.mp4',
    shareLocation: true,
    latitude: 43.23809753598762,
    longitude: 76.91234567890123,
    placeName: 'Kok-Tobe Park',
  };

  it('rounds latitude/longitude to 6 decimal places', () => {
    const form = buildForm(withLocation);
    expect(form.get('latitude')).toBe('43.238098');
    expect(form.get('longitude')).toBe('76.912346');
  });

  it('never sends more than 9 total digits, matching the backend DecimalField', () => {
    const form = buildForm(withLocation);
    const totalDigits = (value: FormDataEntryValue | null) =>
      String(value).replace(/[^0-9]/g, '').length;
    expect(totalDigits(form.get('latitude'))).toBeLessThanOrEqual(9);
    expect(totalDigits(form.get('longitude'))).toBeLessThanOrEqual(9);
  });

  it('sends no location fields when shareLocation is off', () => {
    const form = buildForm({ ...EMPTY_DRAFT, idempotencyKey: createTakeKey(), uri: 'file:///swift.mp4' });
    expect(form.get('latitude')).toBeNull();
    expect(form.get('longitude')).toBeNull();
  });
});

// Every parameter the player applies has to survive the wire, and the field
// names have to match `SwiftCreateSerializer`. A mismatch here does not fail
// the publish — DRF ignores an unknown key — it silently publishes a Swift
// missing the edit the creator made, which is the failure mode worth a test.
describe('buildForm — the edit parameters', () => {
  const base = (overrides: Partial<SwiftDraft> = {}): SwiftDraft => ({
    ...EMPTY_DRAFT,
    idempotencyKey: createTakeKey(),
    uri: 'file:///swift.mp4',
    durationMs: 20_000,
    ...overrides,
  });

  it('sends the capture settings', () => {
    const form = buildForm(base({
      speedPercent: 200, rotationDeg: 90, effect: 'noir', effectIntensity: 65,
    }));
    expect(form.get('speed_percent')).toBe('200');
    expect(form.get('rotation_deg')).toBe('90');
    expect(form.get('effect')).toBe('noir');
    expect(form.get('effect_intensity')).toBe('65');
  });

  it('sends duration as played time, not as source time', () => {
    // 20 seconds of source at 2x is a 10-second Swift, and the server's
    // sixty-second ceiling is on that number.
    expect(buildForm(base({ speedPercent: 200 })).get('duration_ms')).toBe('10000');
  });

  it('strips the local sticker id and keeps the five fields the server reads', () => {
    const form = buildForm(base({
      stickers: [{ id: 'local-1', emoji: '*', x: 0.25, y: 0.75, scale: 1.5, rotation: 30 }],
    }));
    expect(JSON.parse(String(form.get('stickers')))).toEqual([
      { emoji: '*', x: 0.25, y: 0.75, scale: 1.5, rotation: 30 },
    ]);
  });

  it('sends an empty sticker list rather than omitting the field', () => {
    // Omitting it would leave a previously-set list in place on a retry that
    // reuses the idempotency key.
    expect(buildForm(base()).get('stickers')).toBe('[]');
  });

  const withTrack = () => base({
    track: {
      id: 7, title: 'x', artist: 'y', artworkUrl: '', audioUrl: 'https://a/1.mp3',
      durationMs: 180_000,
    },
    musicVolume: 40,
    musicStartMs: 30_000,
  });

  it('sends the track and its mix only when one is attached', () => {
    // With Swift music switched back on — the path is kept for when it is.
    let buildWithMusic: typeof buildForm = buildForm;
    jest.isolateModules(() => {
      jest.doMock('../swiftComposer', () => ({ SWIFT_MUSIC_ENABLED: true }));
      buildWithMusic = require('../swiftUpload').buildForm;
    });
    const form = buildWithMusic(withTrack());
    expect(form.get('track')).toBe('7');
    expect(form.get('music_volume')).toBe('40');
    expect(form.get('music_start_ms')).toBe('30000');
  });

  it('sends no track while Swift music is switched off', () => {
    const form = buildForm(withTrack());
    expect(form.get('track')).toBeNull();
    expect(form.get('music_start_ms')).toBeNull();
  });

  it('omits the music fields when there is no track', () => {
    const form = buildForm(base({ musicStartMs: 5_000 }));
    expect(form.get('track')).toBeNull();
    // Deliberate: the server refuses an offset with no track, and sending one
    // would turn a client bug into a failed publish.
    expect(form.get('music_start_ms')).toBeNull();
  });

  it('reports no original audio when the mic was off, whatever the volume says', () => {
    const form = buildForm(base({ micEnabled: false, originalVolume: 100 }));
    expect(form.get('uses_original_audio')).toBe('false');
  });

  it('reports no original audio when it was muted', () => {
    expect(buildForm(base({ originalVolume: 0 })).get('uses_original_audio')).toBe('false');
  });

  it('reports original audio for an ordinary take', () => {
    expect(buildForm(base()).get('uses_original_audio')).toBe('true');
  });

  it('sends each tag and mention as its own entry, as a list field expects', () => {
    const form = buildForm(base({
      hashtags: ['koktobe', 'sunset'],
      mentions: ['aisha'],
    }));
    expect(form.getAll('hashtags')).toEqual(['koktobe', 'sunset']);
    expect(form.getAll('mentions')).toEqual(['aisha']);
  });

  it('sends no tag fields when the creator added none outside the caption', () => {
    const form = buildForm(base({ caption: 'at #koktobe with @aisha' }));
    // The caption's own tags are parsed server-side — sending them again would
    // be the client asserting a parse the server is about to do anyway.
    expect(form.getAll('hashtags')).toEqual([]);
    expect(form.getAll('mentions')).toEqual([]);
  });
});

describe('publish retry identity', () => {
  it('sends the same take key on automatic and manual retries, and a new key for a new take', async () => {
    jest.useFakeTimers();
    const forms: FormData[] = [];
    let fail = true;
    class MockXHR {
      upload = {};
      status = 0;
      responseText = '';
      onload?: () => void;
      open() {}
      setRequestHeader() {}
      send(form: FormData) {
        forms.push(form);
        this.status = fail ? 503 : 200;
        this.responseText = fail ? '{}' : '{"id":42}';
        fail = false;
        this.onload?.();
      }
    }
    const originalXHR = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
    Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, value: MockXHR });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const take = { ...EMPTY_DRAFT, uri: 'file:///swift.mp4', idempotencyKey: createTakeKey() };
      const automatic = publishSwift(take);
      await jest.runAllTimersAsync();
      await expect(automatic).resolves.toMatchObject({ id: 42 });
      await publishSwift({ ...take, caption: 'edited after uncertain result' });
      const nextTake = { ...take, idempotencyKey: createTakeKey() };
      await publishSwift(nextTake);
      expect(forms.map((form) => form.get('idempotency_key'))).toEqual([
        take.idempotencyKey, take.idempotencyKey, take.idempotencyKey, nextTake.idempotencyKey,
      ]);
      expect(nextTake.idempotencyKey).not.toBe(take.idempotencyKey);
    } finally {
      if (originalXHR) Object.defineProperty(globalThis, 'XMLHttpRequest', originalXHR);
      else Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
      warn.mockRestore();
      jest.useRealTimers();
    }
  });

  it('refuses to publish a take without a key', async () => {
    await expect(publishSwift({ ...EMPTY_DRAFT, uri: 'file:///swift.mp4' }))
      .rejects.toMatchObject({ retryable: false });
  });
});
