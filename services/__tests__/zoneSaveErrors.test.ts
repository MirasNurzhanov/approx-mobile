/**
 * What a failed zone save is allowed to say out loud.
 *
 * Two failure modes with opposite handling, and the split is the whole point:
 *
 *   4xx  a refusal somebody wrote wording for. Show it — the generic shrug is
 *        what hid a 400 on `latitude` behind "Please try again." for every
 *        city and district save.
 *   5xx  an accident. Whatever text rides along is for the logs, not the user:
 *        an exception message, a proxy's boilerplate, a column name. Never
 *        show it.
 */
import { messageFor } from '../zoneArea';

const GENERIC = 'Please try again.';

/** An axios-shaped rejection. */
const err = (status: number, data: unknown) => ({ response: { status, data } });

/** What app/zone-area.tsx passes. */
const AREA = { prefer: ['zone_radius', 'zone_region'] };

describe('messageFor — 4xx bodies are surfaced', () => {
  it('prefers the keys with wording written for this screen', () => {
    expect(messageFor(err(400, {
      zone_region: ['You can only cover a place you are in.'],
      detail: 'something else',
    }), AREA)).toBe('You can only cover a place you are in.');

    expect(messageFor(err(400, {
      zone_radius: ['A zone cannot be smaller than 50m.'],
    }), AREA)).toBe('A zone cannot be smaller than 50m.');
  });

  it('honours the order of `prefer`, not the order of the body', () => {
    const body = {
      zone_region: ['region message'],
      zone_radius: ['radius message'],
    };
    expect(messageFor(err(400, body), AREA)).toBe('radius message');
    expect(messageFor(err(400, body), { prefer: ['zone_region'] })).toBe('region message');
  });

  it('puts `detail` after the preferred keys but ahead of the sweep', () => {
    expect(messageFor(err(400, {
      aardvark: ['alphabetically first, semantically last'],
      detail: 'the summary',
    }), AREA)).toBe('the summary');
  });

  it('surfaces a field error on a field this screen does not know', () => {
    // The precision bug, exactly as it arrived.
    expect(messageFor(err(400, {
      latitude: ['Ensure that there are no more than 11 digits in total.'],
      longitude: ['Ensure that there are no more than 11 digits in total.'],
    }))).toBe('Ensure that there are no more than 11 digits in total.');
  });

  it('surfaces the incomplete-zone refusal', () => {
    expect(messageFor(err(400, {
      zone_region: ['Pick a place before switching to a city zone.'],
      code: ['boundary_not_available'],
    }))).toBe('Pick a place before switching to a city zone.');
  });

  it('falls back to detail, and to the shrug on an empty body', () => {
    expect(messageFor(err(403, { detail: 'Not allowed.' }))).toBe('Not allowed.');
    expect(messageFor(err(400, {}))).toBe(GENERIC);
  });
});

describe('messageFor — server-side failures stay opaque', () => {
  it.each([500, 502, 503, 504])('says nothing internal on a %i', (status) => {
    expect(messageFor(err(status, {
      detail: 'DatabaseError: relation "users_user" does not exist',
    }))).toBe(GENERIC);
  });

  it('ignores an HTML error page', () => {
    expect(messageFor(err(500, '<!DOCTYPE html><title>Server Error</title>'))).toBe(GENERIC);
    // ...including one mislabelled as JSON.
    expect(messageFor(err(400, { detail: '<html><body>nginx</body></html>' }))).toBe(GENERIC);
  });

  it('ignores a body long enough to be a stack trace', () => {
    expect(messageFor(err(400, { detail: 'Traceback:\n' + 'x'.repeat(400) }))).toBe(GENERIC);
  });
});

describe('messageFor — malformed and offline', () => {
  it('handles a network failure with no response at all', () => {
    expect(messageFor({ message: 'Network Error' })).toBe(GENERIC);
    expect(messageFor(undefined)).toBe(GENERIC);
    expect(messageFor(null)).toBe(GENERIC);
  });

  it('handles bodies that are not objects of strings', () => {
    expect(messageFor(err(400, null))).toBe(GENERIC);
    expect(messageFor(err(400, ['a list']))).toBe(GENERIC);
    expect(messageFor(err(400, { field: [{ nested: 'object' }] }))).toBe(GENERIC);
    expect(messageFor(err(400, { field: ['   '] }))).toBe(GENERIC);
  });

  it('does not treat a 3xx as a refusal', () => {
    expect(messageFor(err(304, { detail: 'Not Modified' }))).toBe(GENERIC);
  });
});

describe('messageFor — the other zone screens', () => {
  const UPLOAD = { prefer: ['zone_audio'], fallback: 'Could not upload that file.' };

  it('gives the music screen its radius refusal', () => {
    expect(messageFor(err(400, {
      music_zone_radius: ['A music zone tops out at 5km.'],
    }), { prefer: ['music_zone_radius', 'zone_region'] }))
      .toBe('A music zone tops out at 5km.');
  });

  it('gives the trimmer both loop refusals', () => {
    // Both are keyed `zone_track_end_ms` server-side — `_validate_loop` raises
    // under that one field for a window that ends too early *and* one too
    // short. `zone_track_start_ms` is in `prefer` only for a field-level error
    // on the start itself, which is the case below it.
    const trim = { prefer: ['zone_track_end_ms', 'zone_track_start_ms'] };
    expect(messageFor(err(400, {
      zone_track_end_ms: ['The loop has to end after it starts.'],
    }), trim)).toBe('The loop has to end after it starts.');
    expect(messageFor(err(400, {
      zone_track_end_ms: ['A loop shorter than 3 seconds is a stutter, not a track.'],
    }), trim)).toBe('A loop shorter than 3 seconds is a stutter, not a track.');
    expect(messageFor(err(400, {
      zone_track_start_ms: ['A valid integer is required.'],
    }), trim)).toBe('A valid integer is required.');
  });

  it('uses the upload fallback, including for a proxy 413', () => {
    expect(messageFor(err(400, { zone_audio: ['Unsupported file type.'] }), UPLOAD))
      .toBe('Unsupported file type.');
    // A 413 from the proxy in front of Django: HTML, no JSON.
    expect(messageFor(err(413, '<html>Request Entity Too Large</html>'), UPLOAD))
      .toBe('Could not upload that file.');
    expect(messageFor({ message: 'Network Error' }, UPLOAD))
      .toBe('Could not upload that file.');
    expect(messageFor(err(500, { detail: 'Cloudinary exploded' }), UPLOAD))
      .toBe('Could not upload that file.');
  });

  it('surfaces the incomplete-zone refusal on every screen that can hit it', () => {
    // A music-screen PATCH by a user whose city has no boundary yet used to be
    // refused with a body this screen could not read at all.
    const body = {
      zone_region: ['Pick a place before switching to a city zone.'],
      code: ['boundary_not_available'],
    };
    for (const options of [
      AREA,
      { prefer: ['music_zone_radius', 'zone_region'] },
      { prefer: ['zone_track_end_ms', 'zone_track_start_ms'] },
    ]) {
      expect(messageFor(err(400, body), options))
        .toBe('Pick a place before switching to a city zone.');
    }
  });
});
