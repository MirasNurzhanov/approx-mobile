/**
 * Nothing makes a user visible except a deliberate tap.
 *
 * App Review's list of things that must NOT check somebody in:
 *
 *     the application opens          location permission is granted
 *     the user logs in               a GPS position is obtained
 *     the map screen opens           returning to the foreground
 *     background location starts     the user's location changes
 *     the user enters a zone         the device restarts
 *
 * Every one of those is an *event*, and the way to be sure none of them can
 * check anyone in is not to check each event but to bound the writes: if the
 * only code that can set a visible sharing mode sits behind the consent sheet,
 * then no event can reach it however the app grows.
 *
 * So this scans the source rather than exercising behaviour. Behavioural tests
 * prove the paths that exist today; this one is about the path somebody adds
 * next year in a foreground handler, which by definition has no test yet.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SCANNED = ['app', 'services', 'components', 'context', 'hooks'];

/** Files allowed to write `location_sharing` at all, and why. */
const ALLOWED_WRITERS: Record<string, string> = {
  'app/privacy.tsx':
    'the check in / check out card, with the consent sheet in front of every check-in',
  'app/(tabs)/settings.tsx':
    'the same card, same consent sheet',
  'services/signOut.ts':
    'sets paused on the way out — the safe direction, and never a visible mode',
};

/** The card that *renders* the check in / check out control.
 *
 * Deliberately not in ALLOWED_WRITERS: it reports which button was pressed and
 * nothing more. The screen owning it is what puts the consent sheet in front of
 * a check-in and then writes the field, and keeping the write out of the shared
 * component is what stops a second host embedding the card and checking people
 * in without a sheet. */
const CONTROL_COMPONENT = 'components/LocationVisibilityCard.tsx';

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        found.push(full);
      }
    }
  };
  for (const dir of SCANNED) walk(path.join(ROOT, dir));
  return found;
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

/** Lines that put `location_sharing` in a request payload. */
function writeLines(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => /location_sharing\s*:/.test(line))
    // The interface declaration in services/privacy.ts is a type, not a write.
    .filter((line) => !/^\s*location_sharing:\s*LocationSharing;/.test(line))
    .map((line) => line.trim());
}

describe('no automatic visibility', () => {
  const files = sourceFiles();

  it('finds the source tree it means to scan', () => {
    // Guards against the walk silently matching nothing and every assertion
    // below passing vacuously.
    expect(files.length).toBeGreaterThan(30);
    expect(files.map(relative)).toContain('services/privacy.ts');
  });

  it('only ever writes the sharing mode from the consent-gated screens', () => {
    const offenders = files
      .map((file) => ({ file: relative(file), writes: writeLines(fs.readFileSync(file, 'utf8')) }))
      .filter(({ file, writes }) => writes.length > 0 && !(file in ALLOWED_WRITERS));

    expect(offenders).toEqual([]);
  });

  it('never hardcodes a *visible* mode anywhere', () => {
    // The load-bearing one. A write of `location_sharing: 'live'` is, by
    // construction, the app deciding somebody should be visible — nobody
    // chose it, the literal did. Every legitimate visible write passes a
    // variable the user selected from the three buttons.
    //
    // `'paused'` is exempt in the other direction and for the same reason:
    // hiding somebody without being asked is always allowed.
    const offenders: string[] = [];
    for (const file of files) {
      for (const line of writeLines(fs.readFileSync(file, 'utf8'))) {
        if (/location_sharing\s*:\s*['"](live|approximate)['"]/.test(line)) {
          offenders.push(`${relative(file)}: ${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the check-in control free of the write itself', () => {
    // The card renders "Check In" / "Check Out" and reports which was pressed.
    // If it ever grows the write, the consent sheet stops being unavoidable —
    // any screen embedding the card would be able to check somebody in.
    const source = fs.readFileSync(path.join(ROOT, CONTROL_COMPONENT), 'utf8');
    expect(writeLines(source)).toEqual([]);
    expect(source).toContain('onCheckIn');
  });

  it('offers no control that checks in without being pressed', () => {
    // A Switch bound to visibility is the specific shape App Review objected
    // to: it restores its own state from a stored preference, so the app ends
    // up visible because it was visible last time. The card has a button, and
    // a button only ever fires from a press.
    const source = fs.readFileSync(path.join(ROOT, CONTROL_COMPONENT), 'utf8');
    expect(source).not.toMatch(/<Switch/);
  });

  it('keeps sign-out writing paused and nothing else', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services/signOut.ts'), 'utf8');
    const writes = writeLines(source);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("'paused'");
  });

  it('has no startup, foreground or permission handler that writes the mode', () => {
    // Named separately from the blanket check above so a failure says which of
    // App Review's bullets was broken, rather than only that one was.
    const entryPoints = [
      'app/_layout.tsx',
      'app/(tabs)/map.tsx',
      'services/backgroundLocation.ts',
      'services/location.ts',
      'services/permissions.ts',
      'services/auth.ts',
      'services/socialAuth.ts',
      'services/discovery.ts',
      'context/AuthContext.tsx',
    ];
    for (const rel of entryPoints) {
      const full = path.join(ROOT, rel);
      if (!fs.existsSync(full)) continue;
      expect({ [rel]: writeLines(fs.readFileSync(full, 'utf8')) }).toEqual({ [rel]: [] });
    }
  });
});
