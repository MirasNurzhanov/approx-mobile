/**
 * Nothing turns Ghost Mode off except the person it belongs to.
 *
 * This file used to assert the mirror image: that nothing could ever make a
 * user *visible*, because visibility was a per-launch choice made against a
 * consent sheet. App Review's list — app open, login, permission granted, GPS
 * fix, map opened, foreground, background start, location change, zone entry,
 * device restart — was a list of events that must not check anybody in.
 *
 * That product is gone on purpose. Sharing follows the OS location permission
 * now and persists across launches, the way Find My and Snap Map do, so most
 * of those events *are* how somebody ends up on the map and asserting
 * otherwise would be asserting a bug.
 *
 * The danger reversed rather than disappeared, and the shape of the guard
 * survives it. Somebody who has turned themselves off must stay off: no
 * startup effect, no permission grant, no foreground handler may quietly write
 * `ghost_mode: false`. So this still bounds the writes rather than simulating
 * the events, because bounding them covers the handler somebody adds next year
 * that has no test yet.
 *
 * Two things replaced the old assertions and neither is a weakening:
 *
 *   - the disclosure gate, which is what stops a cold install transmitting
 *     anything before its owner has been told what being on the map means
 *     (services/locationDisclosure.ts, pinned in locationSharingDefaults)
 *   - the fuzzing, which is now the server's and per viewer
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SCANNED = ['app', 'services', 'components', 'context', 'hooks'];

/** Files allowed to write `ghost_mode` at all, and why. */
const ALLOWED_WRITERS: Record<string, string> = {
  'app/privacy.tsx':
    'the Ghost Mode switch — the one screen that owns this setting',
};

/** The card that *renders* the switch.
 *
 * Deliberately not in ALLOWED_WRITERS: it reports which way the switch was
 * moved and nothing more. The screen owning it is what writes the field, and
 * keeping the write out of the shared component is what stops a second host
 * embedding the card and turning somebody's visibility on. */
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

/** Lines that put `ghost_mode` in a request payload. */
function writeLines(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => /ghost_mode\s*:/.test(line))
    // The interface declaration in services/privacy.ts is a type, not a write.
    .filter((line) => !/^\s*ghost_mode:\s*boolean;/.test(line))
    .map((line) => line.trim());
}

describe('ghost mode is only ever changed deliberately', () => {
  const files = sourceFiles();

  it('finds the source tree it means to scan', () => {
    // Guards against the walk silently matching nothing and every assertion
    // below passing vacuously.
    expect(files.length).toBeGreaterThan(30);
    expect(files.map(relative)).toContain('services/privacy.ts');
  });

  it('only ever writes the field from the screen that owns it', () => {
    const offenders = files
      .map((file) => ({ file: relative(file), writes: writeLines(fs.readFileSync(file, 'utf8')) }))
      .filter(({ file, writes }) => writes.length > 0 && !(file in ALLOWED_WRITERS));

    expect(offenders).toEqual([]);
  });

  it('never hardcodes leaving ghost mode anywhere', () => {
    // The load-bearing one, and the mirror of what this file used to check. A
    // write of `ghost_mode: false` is the app deciding somebody should be
    // visible — nobody chose it, the literal did. The legitimate write passes
    // a variable carrying which way the switch was moved.
    //
    // `true` is exempt in the other direction and for the same reason: hiding
    // somebody without being asked is always allowed.
    const offenders: string[] = [];
    for (const file of files) {
      for (const line of writeLines(fs.readFileSync(file, 'utf8'))) {
        if (/ghost_mode\s*:\s*false/.test(line)) {
          offenders.push(`${relative(file)}: ${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the control free of the write itself', () => {
    const source = fs.readFileSync(path.join(ROOT, CONTROL_COMPONENT), 'utf8');
    expect(writeLines(source)).toEqual([]);
    expect(source).toContain('onGhostChange');
  });

  it('has no startup, foreground or permission handler that writes the field', () => {
    // Named separately from the blanket check above so a failure says which
    // kind of trigger crept in, rather than only that one did.
    const entryPoints = [
      'app/_layout.tsx',
      'app/(tabs)/map.tsx',
      'services/backgroundLocation.ts',
      'services/location.ts',
      'services/permissions.ts',
      'services/auth.ts',
      'services/socialAuth.ts',
      'services/discovery.ts',
      'services/signOut.ts',
      'context/AuthContext.tsx',
    ];
    for (const rel of entryPoints) {
      const full = path.join(ROOT, rel);
      if (!fs.existsSync(full)) continue;
      expect({ [rel]: writeLines(fs.readFileSync(full, 'utf8')) }).toEqual({ [rel]: [] });
    }
  });

  it('reports no position until the disclosure has been acknowledged', () => {
    // Structural, because the behavioural version lives in
    // locationSharingDefaults and this is the property that replaced
    // paused-by-default: every account arrives at this build not ghosted, so
    // the gate in front of the *transmission* is what stops the migration
    // publishing anybody who has not been told.
    const source = fs.readFileSync(path.join(ROOT, 'services/location.ts'), 'utf8');
    expect(source).toContain('hasAcknowledgedLocationDisclosure');
    // Ahead of the send, not beside it.
    expect(source.indexOf('hasAcknowledgedLocationDisclosure'))
      .toBeLessThan(source.indexOf('api.patch'));
  });
});
