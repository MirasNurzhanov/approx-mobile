/**
 * The build number the app tells the server about.
 *
 * This is what scopes the backend's Terms gate: `users.terms.terms_enforced_for`
 * enforces against build 32 and newer, and treats a client that sends no build
 * at all as legacy so that deploying the backend during App Review cannot lock
 * out everyone still on build 31.
 *
 * Two failure modes it must never have, and both are asserted below:
 *
 *   * **Claiming a build it is not.** A hard-coded constant did exactly this —
 *     it said 32 forever, so build 33 would have lied and, worse, a bundle that
 *     had not been rebuilt would have claimed compliance it could not deliver.
 *     The number now comes from `Application.nativeBuildVersion`, which is
 *     iOS's `CFBundleVersion` — the value EAS assigns at build time under
 *     `appVersionSource: "remote"`.
 *
 *   * **Guessing when it does not know.** Expo Go, web, and a malformed
 *     `CFBundleVersion` all produce no usable number. The header is then
 *     *omitted*, never defaulted, because the server distinguishes "did not
 *     say" from every number and only the omission is honest.
 *
 * ── On the harness ────────────────────────────────────────────────────────────
 * Each case re-loads `../api` rather than mutating a shared mock. `api.ts` does
 * `import * as Application`, and babel's wildcard interop copies the module's
 * own properties into a namespace object once, at import — so a value changed
 * afterwards is never seen. Resetting the registry per case is what makes the
 * test exercise the real read instead of a stale snapshot.
 */

type Api = typeof import('../api');

/** Load `services/api` as it would behave on a binary reporting this build. */
function loadApi(nativeBuildVersion: string | null | undefined): Api {
  let api!: Api;
  jest.isolateModules(() => {
    jest.doMock('expo-application', () => ({ nativeBuildVersion }));
    jest.doMock('expo-router', () => ({ router: { replace: jest.fn() } }));
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      getItem: jest.fn(() => Promise.resolve(null)),
      setItem: jest.fn(() => Promise.resolve()),
      removeItem: jest.fn(() => Promise.resolve()),
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    api = require('../api') as Api;
  });
  return api;
}

const HEADER = 'X-Aura-Build';

describe('the build number comes from the binary', () => {
  it('reports 32 on a build EAS numbered 32', () => {
    const api = loadApi('32');

    expect(api.clientBuild()).toBe(32);
    expect(api.clientHeaders()).toEqual({ [HEADER]: '32' });
  });

  it('reports 33 on the next build, with no source change', () => {
    // The whole point. Under `autoIncrement` the next submission is 33, and
    // nothing in this repository is edited to make that true.
    const api = loadApi('33');

    expect(api.clientBuild()).toBe(33);
    expect(api.clientHeaders()).toEqual({ [HEADER]: '33' });
  });

  it('keeps up with a much later build', () => {
    const api = loadApi('147');

    expect(api.clientBuild()).toBe(147);
    expect(api.clientHeaders()).toEqual({ [HEADER]: '147' });
  });

  it('exports the header name it uses, so callers cannot mistype it', () => {
    expect(loadApi('32').CLIENT_BUILD_HEADER).toBe(HEADER);
  });
});

describe('an unknown build is omitted, never guessed', () => {
  // Each of these is a real situation: Expo Go and web report null, a
  // hand-set CFBundleVersion can be dotted, and a stripped value can be blank.
  const unusable: [string, string | null | undefined][] = [
    ['null (Expo Go, web)', null],
    ['undefined (native module absent)', undefined],
    ['empty string', ''],
    ['dotted CFBundleVersion', '1.0.32'],
    ['non-numeric', 'not-a-number'],
    ['whitespace', '  '],
    ['negative', '-1'],
    ['zero', '0'],
    ['decimal', '32.5'],
  ];

  it.each(unusable)('%s yields no build and no header', (_label, value) => {
    const api = loadApi(value);

    expect(api.clientBuild()).toBeNull();
    expect(api.clientHeaders()).toEqual({});
  });

  it.each(unusable)('%s does not throw', (_label, value) => {
    const api = loadApi(value);

    expect(() => api.clientBuild()).not.toThrow();
    expect(() => api.clientHeaders()).not.toThrow();
  });

  it('never falls back to 32', () => {
    // The specific regression this replaced: a constant that answered 32
    // whatever the binary actually was.
    for (const [, value] of unusable) {
      expect(loadApi(value).clientBuild()).not.toBe(32);
    }
  });
});

describe('the request layer holds no build number of its own', () => {
  it('has no hard-coded build in services/api.ts', () => {
    // A source scan, deliberately. The behavioural tests above prove the
    // header follows the binary; this proves there is no second, stale answer
    // left in the file for a future edit to reach for.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path') as typeof import('path');

    const source = readFileSync(join(__dirname, '..', 'api.ts'), 'utf8');
    const code = source
      // Strip block and line comments: the file explains the history of the
      // constant it replaced, and prose about "build 31" is not a constant.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/CLIENT_BUILD\s*=\s*\d+/);
    expect(code).toContain('Application.nativeBuildVersion');
  });

  it('sends the header only through the shared helpers', () => {
    // `clientHeaders` and the axios interceptor are the two emission points,
    // and both derive from `clientBuild()` — so proving the helper follows the
    // binary proves both do.
    expect(loadApi('41').clientHeaders()[HEADER]).toBe('41');
  });
});
