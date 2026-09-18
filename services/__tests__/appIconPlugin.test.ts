/**
 * @jest-environment node
 */
// The build-time half of the theme-following icon: what
// modules/approx-app-icon/app.plugin.js does to the Android manifest and the
// Xcode project. The runtime module can only switch between launcher entries
// that exist, and the previous icon library's worst failure — disabling the
// component the running screen belongs to — is ruled out here by construction:
// the entries it toggles are aliases, never MainActivity.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withApproxAppIcon = require('../../modules/approx-app-icon/app.plugin.js');

const PROPS = {
  dark: {
    ios: './assets/images/icon-dark.png',
    android: {
      legacy: './assets/images/icon-android-dark.png',
      foreground: './assets/images/adaptive-icon-dark.png',
      backgroundColor: '#0A0A0B',
    },
  },
};

const MAIN = { $: { 'android:name': 'android.intent.action.MAIN' } };
const LAUNCHER = { $: { 'android:name': 'android.intent.category.LAUNCHER' } };

/** The shape Expo prebuild generates for this app, reduced to what matters. */
function generatedManifest() {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        {
          $: { 'android:name': '.MainApplication', 'android:icon': '@mipmap/ic_launcher' },
          activity: [
            {
              $: { 'android:name': '.MainActivity', 'android:exported': 'true' },
              'intent-filter': [
                { action: [MAIN], category: [LAUNCHER] },
                {
                  action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
                  category: [
                    { $: { 'android:name': 'android.intent.category.DEFAULT' } },
                    { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
                  ],
                  data: [{ $: { 'android:scheme': 'auramobile' } }],
                },
              ],
            },
          ],
          'uses-library': [{ $: { 'android:name': 'org.apache.http.legacy' } }],
        },
      ],
    },
  };
}

function baseConfig() {
  return { name: 'Approx', slug: 'aura-mobile', android: { package: 'com.arcanix.aura' } } as any;
}

async function runManifestMod(manifest: any) {
  const config = withApproxAppIcon(baseConfig(), PROPS);
  const result = await config.mods.android.manifest({
    ...config,
    modResults: manifest,
    modRequest: { platform: 'android', modName: 'manifest', projectRoot: '/', platformProjectRoot: '/android' },
  });
  return result.modResults;
}

const isLauncher = (filter: any) =>
  filter.action?.some((a: any) => a.$['android:name'] === MAIN.$['android:name']) &&
  filter.category?.some((c: any) => c.$['android:name'] === LAUNCHER.$['android:name']);

describe('Android manifest', () => {
  it('moves the launcher entry from MainActivity onto two aliases of it', async () => {
    const manifest = await runManifestMod(generatedManifest());
    const app = manifest.manifest.application[0];
    const main = app.activity[0];

    // MainActivity is no longer a launcher entry, but keeps its deep links.
    expect(main['intent-filter'].some(isLauncher)).toBe(false);
    expect(main['intent-filter']).toHaveLength(1);
    expect(main['intent-filter'][0].data[0].$['android:scheme']).toBe('auramobile');

    const aliases = app['activity-alias'];
    expect(aliases.map((a: any) => a.$)).toEqual([
      expect.objectContaining({
        'android:name': '.MainActivityLight',
        'android:targetActivity': '.MainActivity',
        'android:enabled': 'true',
        'android:exported': 'true',
        'android:icon': '@mipmap/ic_launcher',
        'android:roundIcon': '@mipmap/ic_launcher_round',
      }),
      expect.objectContaining({
        'android:name': '.MainActivityDark',
        'android:targetActivity': '.MainActivity',
        'android:enabled': 'false',
        'android:icon': '@mipmap/ic_launcher_dark',
        'android:roundIcon': '@mipmap/ic_launcher_dark_round',
      }),
    ]);
    expect(aliases.every((a: any) => a['intent-filter'].some(isLauncher))).toBe(true);

    // Exactly one launcher entry is enabled out of the box: one icon.
    const enabledLaunchers = aliases.filter((a: any) => a.$['android:enabled'] === 'true');
    expect(enabledLaunchers).toHaveLength(1);
  });

  it('writes the aliases after the activity they target, as Android requires', async () => {
    const manifest = await runManifestMod(generatedManifest());
    const keys = Object.keys(manifest.manifest.application[0]);
    expect(keys.indexOf('activity-alias')).toBeGreaterThan(keys.indexOf('activity'));
  });

  it('is idempotent across repeated prebuilds and leaves other aliases alone', async () => {
    const manifest = generatedManifest() as any;
    manifest.manifest.application[0]['activity-alias'] = [
      { $: { 'android:name': '.ShareTarget', 'android:targetActivity': '.MainActivity' } },
    ];
    const once = await runManifestMod(manifest);
    const twice = await runManifestMod(once);
    const names = twice.manifest.application[0]['activity-alias'].map((a: any) => a.$['android:name']);
    expect(names).toEqual(['.ShareTarget', '.MainActivityLight', '.MainActivityDark']);
    expect(twice.manifest.application[0].activity[0]['intent-filter']).toHaveLength(1);
  });
});

describe('iOS project', () => {
  it('registers AppIconDark as an alternate icon on the app target only', async () => {
    const configurations: Record<string, any> = {
      appDebug: { buildSettings: { ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon', PRODUCT_NAME: 'Approx' } },
      appRelease: { buildSettings: { ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon', PRODUCT_NAME: 'Approx' } },
      projectDebug: { buildSettings: { SDKROOT: 'iphoneos' } },
      appDebug_comment: 'Debug',
    };
    const config = withApproxAppIcon(baseConfig(), PROPS);
    await config.mods.ios.xcodeproj({
      ...config,
      modResults: { pbxXCBuildConfigurationSection: () => configurations },
      modRequest: { platform: 'ios', modName: 'xcodeproj', projectRoot: '/', platformProjectRoot: '/ios' },
    });
    expect(configurations.appDebug.buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES).toBe('AppIconDark');
    expect(configurations.appRelease.buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES).toBe('AppIconDark');
    expect(configurations.projectDebug.buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES).toBeUndefined();
  });
});

describe('options', () => {
  it('refuses to build without every dark icon source', () => {
    expect(() => withApproxAppIcon(baseConfig(), { dark: { ios: 'x.png' } })).toThrow(/required/);
    expect(() => withApproxAppIcon(baseConfig(), {})).toThrow(/required/);
  });
});
