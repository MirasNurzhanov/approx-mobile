import { buildForm } from '../swiftUpload';
import { EMPTY_DRAFT, type SwiftDraft } from '../swiftDraft';

// swifts/models.py: latitude/longitude are DecimalField(max_digits=9,
// decimal_places=6). A raw GPS fix carries full double precision, and
// FormData.get returns whatever string was appended — so this catches the
// same overflow Django would reject with "Ensure that there are no more than
// 9 digits in total." without needing a live server.
describe('buildForm — location precision', () => {
  const withLocation: SwiftDraft = {
    ...EMPTY_DRAFT,
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
    const form = buildForm({ ...EMPTY_DRAFT, uri: 'file:///swift.mp4' });
    expect(form.get('latitude')).toBeNull();
    expect(form.get('longitude')).toBeNull();
  });
});
