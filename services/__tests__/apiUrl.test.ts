import { PRODUCTION_API_URL, resolveApiUrl } from '../apiUrl';

type ApiUrlModule = typeof import('../apiUrl');

function loadWith(value: string | undefined): ApiUrlModule {
  let mod!: ApiUrlModule;
  jest.isolateModules(() => {
    const previous = process.env.EXPO_PUBLIC_API_URL;
    try {
      if (value === undefined) delete process.env.EXPO_PUBLIC_API_URL;
      else process.env.EXPO_PUBLIC_API_URL = value;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../apiUrl');
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_API_URL;
      else process.env.EXPO_PUBLIC_API_URL = previous;
    }
  });
  return mod;
}

describe('API URL', () => {
  it('defaults every build to production, which is https and not a local host', () => {
    expect(resolveApiUrl(undefined, false)).toBe(PRODUCTION_API_URL);
    expect(resolveApiUrl(undefined, true)).toBe(PRODUCTION_API_URL);
    expect(resolveApiUrl('   ', false)).toBe(PRODUCTION_API_URL);
    // Passes the release checks itself: the committed default can never be a laptop.
    expect(resolveApiUrl(PRODUCTION_API_URL, false)).toBe(PRODUCTION_API_URL);
  });

  it('accepts a staging backend in a release build, normalised', () => {
    expect(resolveApiUrl('https://Staging.Example.test/', false)).toBe('https://staging.example.test');
    expect(resolveApiUrl(' https://api.example.test:8443/approx/ ', false)).toBe('https://api.example.test:8443/approx');
  });

  it('lets a development build reach a local server over http', () => {
    expect(resolveApiUrl('http://192.168.1.20:8000', true)).toBe('http://192.168.1.20:8000');
    expect(resolveApiUrl('http://10.0.2.2:8000/', true)).toBe('http://10.0.2.2:8000');
    expect(resolveApiUrl('http://localhost:8000', true)).toBe('http://localhost:8000');
  });

  it.each([
    'http://api.example.test',
    'http://192.168.1.20:8000',
    'https://localhost:8000',
    'https://127.0.0.1',
    'https://10.0.2.2:8000',
    'https://172.20.0.5',
    'https://192.168.1.20',
    'https://laptop.local',
  ])('refuses %s in a release build', value => {
    expect(() => resolveApiUrl(value, false)).toThrow(/release build/);
  });

  it.each([
    'api.example.test',
    'ftp://api.example.test',
    'https://user:secret@api.example.test',
    'https://api.example.test/?next=1',
    'https://api.example.test/#top',
    'https://api example.test',
    'https://api..example.test',
    'https://api.example.test:70000',
  ])('refuses the malformed value %s in any build', value => {
    expect(() => resolveApiUrl(value, true)).toThrow(/EXPO_PUBLIC_API_URL must be an http\(s\) address/);
    expect(() => resolveApiUrl(value, false)).toThrow(/EXPO_PUBLIC_API_URL must be an http\(s\) address/);
  });

  it('reads EXPO_PUBLIC_API_URL when the module loads', () => {
    expect(loadWith(undefined).API_URL).toBe(PRODUCTION_API_URL);
    expect(loadWith('https://staging.example.test/').API_URL).toBe('https://staging.example.test');
  });

  it('pins the production build profile to production, and no profile to a local host', () => {
    const eas = require('../../eas.json') as { build: Record<string, { env?: Record<string, string> }> };
    expect(eas.build.production.env?.EXPO_PUBLIC_API_URL).toBe(PRODUCTION_API_URL);
    for (const profile of Object.values(eas.build)) {
      const value = profile.env?.EXPO_PUBLIC_API_URL;
      if (value !== undefined) expect(() => resolveApiUrl(value, false)).not.toThrow();
    }
  });
});
