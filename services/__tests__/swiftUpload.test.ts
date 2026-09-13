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
