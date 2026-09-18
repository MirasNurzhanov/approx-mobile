// Config plugin for the theme-following home-screen icon. See ./index.ts for
// the runtime half and why it is a local module.
//
// Android  The launcher entry moves off MainActivity onto two activity-aliases
//          that both open it: `.MainActivityLight` (enabled, Expo's generated
//          `ic_launcher`) and `.MainActivityDark` (disabled, `ic_launcher_dark`,
//          generated here). MainActivity keeps its deep-link filters, and is
//          never itself enabled or disabled at runtime.
// iOS      A second app icon set, `AppIconDark`, in the asset catalog, named in
//          ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES so the build registers
//          it as an alternate icon.
//
// Options (app.json):
//   dark.ios                        1024px opaque icon
//   dark.android.legacy             full square icon for Android 7 and older
//   dark.android.foreground         adaptive-icon foreground (transparent)
//   dark.android.backgroundColor    adaptive-icon background
const {
  AndroidConfig,
  withAndroidColors,
  withAndroidManifest,
  withDangerousMod,
  withXcodeProject,
} = require('expo/config-plugins');
const { generateImageAsync } = require('@expo/image-utils');
const fs = require('fs');
const path = require('path');

const LIGHT_ALIAS = '.MainActivityLight';
const DARK_ALIAS = '.MainActivityDark';
const DARK_ICON = 'ic_launcher_dark';
const DARK_BACKGROUND_COLOR = 'iconBackgroundDark';
const IOS_DARK_ICON_SET = 'AppIconDark';

// Same densities and baselines as Expo's own icon generation.
const DENSITIES = {
  'mipmap-mdpi': 1,
  'mipmap-hdpi': 1.5,
  'mipmap-xhdpi': 2,
  'mipmap-xxhdpi': 3,
  'mipmap-xxxhdpi': 4,
};
const LEGACY_PX = 48;
const ADAPTIVE_PX = 108;

const MAIN = 'android.intent.action.MAIN';
const LAUNCHER = 'android.intent.category.LAUNCHER';

function isLauncherFilter(filter) {
  return (
    !!filter.action?.some((a) => a.$['android:name'] === MAIN) &&
    !!filter.category?.some((c) => c.$['android:name'] === LAUNCHER)
  );
}

function launcherAlias(name, enabled, icon) {
  return {
    $: {
      'android:name': name,
      'android:targetActivity': '.MainActivity',
      'android:enabled': enabled ? 'true' : 'false',
      'android:exported': 'true',
      'android:icon': `@mipmap/${icon}`,
      'android:roundIcon': `@mipmap/${icon}_round`,
    },
    'intent-filter': [
      {
        action: [{ $: { 'android:name': MAIN } }],
        category: [{ $: { 'android:name': LAUNCHER } }],
      },
    ],
  };
}

const withLauncherAliases = (config) =>
  withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);

    // Two launcher entries would be two icons on the home screen.
    mainActivity['intent-filter'] = (mainActivity['intent-filter'] ?? []).filter(
      (filter) => !isLauncherFilter(filter),
    );

    // Appended after the <activity> elements: an alias must follow its target.
    const others = (application['activity-alias'] ?? []).filter(
      (alias) => ![LIGHT_ALIAS, DARK_ALIAS].includes(alias.$['android:name']),
    );
    application['activity-alias'] = [
      ...others,
      launcherAlias(LIGHT_ALIAS, true, 'ic_launcher'),
      launcherAlias(DARK_ALIAS, false, DARK_ICON),
    ];
    return config;
  });

const withDarkIconColor = (config, { backgroundColor }) =>
  withAndroidColors(config, (config) => {
    config.modResults = AndroidConfig.Colors.assignColorValue(config.modResults, {
      name: DARK_BACKGROUND_COLOR,
      value: backgroundColor,
    });
    return config;
  });

async function renderIcon(projectRoot, src, size, cacheType, extra = {}) {
  const { source } = await generateImageAsync(
    { projectRoot, cacheType: `approx-app-icon-${cacheType}` },
    {
      src: path.resolve(projectRoot, src),
      width: size,
      height: size,
      resizeMode: 'cover',
      ...extra,
    },
  );
  return source;
}

const withDarkAndroidIcons = (config, { legacy, foreground }) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const res = path.join(platformProjectRoot, 'app', 'src', 'main', 'res');

      for (const [folder, scale] of Object.entries(DENSITIES)) {
        const dir = path.join(res, folder);
        await fs.promises.mkdir(dir, { recursive: true });
        const legacySize = LEGACY_PX * scale;
        const adaptiveSize = ADAPTIVE_PX * scale;
        await fs.promises.writeFile(
          path.join(dir, `${DARK_ICON}.png`),
          await renderIcon(projectRoot, legacy, legacySize, `square-${legacySize}`),
        );
        await fs.promises.writeFile(
          path.join(dir, `${DARK_ICON}_round.png`),
          await renderIcon(projectRoot, legacy, legacySize, `round-${legacySize}`, {
            borderRadius: legacySize / 2,
          }),
        );
        await fs.promises.writeFile(
          path.join(dir, `${DARK_ICON}_foreground.png`),
          await renderIcon(projectRoot, foreground, adaptiveSize, `foreground-${adaptiveSize}`, {
            backgroundColor: 'transparent',
          }),
        );
      }

      // Themed (Android 13+) icons reuse Expo's monochrome layer when the app
      // has one; referencing it otherwise would fail the resource link.
      const monochrome = config.android?.adaptiveIcon?.monochromeImage
        ? '\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>'
        : '';
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/${DARK_BACKGROUND_COLOR}"/>
    <foreground android:drawable="@mipmap/${DARK_ICON}_foreground"/>${monochrome}
</adaptive-icon>
`;
      const anydpi = path.join(res, 'mipmap-anydpi-v26');
      await fs.promises.mkdir(anydpi, { recursive: true });
      await fs.promises.writeFile(path.join(anydpi, `${DARK_ICON}.xml`), xml);
      await fs.promises.writeFile(path.join(anydpi, `${DARK_ICON}_round.xml`), xml);
      return config;
    },
  ]);

const withDarkIosIconSet = (config, { ios, backgroundColor }) =>
  withDangerousMod(config, [
    'ios',
    async (config) => {
      const { projectRoot, platformProjectRoot, projectName } = config.modRequest;
      const dir = path.join(
        platformProjectRoot,
        projectName,
        'Images.xcassets',
        `${IOS_DARK_ICON_SET}.appiconset`,
      );
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = 'App-Icon-1024x1024@1x.png';
      await fs.promises.writeFile(
        path.join(dir, filename),
        // Opaque, as App Store icons must be.
        await renderIcon(projectRoot, ios, 1024, 'ios-1024', {
          name: filename,
          removeTransparency: true,
          backgroundColor,
        }),
      );
      await fs.promises.writeFile(
        path.join(dir, 'Contents.json'),
        `${JSON.stringify(
          {
            images: [{ filename, idiom: 'universal', platform: 'ios', size: '1024x1024' }],
            info: { version: 1, author: 'expo' },
          },
          null,
          2,
        )}\n`,
      );
      return config;
    },
  ]);

const withAlternateIconBuildSetting = (config) =>
  withXcodeProject(config, (config) => {
    const configurations = config.modResults.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configurations)) {
      const settings = entry && typeof entry === 'object' ? entry.buildSettings : null;
      // Only the app target's configurations name an app icon.
      if (settings && settings.ASSETCATALOG_COMPILER_APPICON_NAME) {
        settings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = IOS_DARK_ICON_SET;
      }
    }
    return config;
  });

module.exports = function withApproxAppIcon(config, props = {}) {
  const dark = props.dark;
  if (!dark?.ios || !dark?.android?.legacy || !dark?.android?.foreground || !dark?.android?.backgroundColor) {
    throw new Error(
      'approx-app-icon: `dark.ios`, `dark.android.legacy`, `dark.android.foreground` and ' +
        '`dark.android.backgroundColor` are all required.',
    );
  }
  config = withLauncherAliases(config);
  config = withDarkIconColor(config, dark.android);
  config = withDarkAndroidIcons(config, dark.android);
  config = withDarkIosIconSet(config, { ios: dark.ios, backgroundColor: dark.android.backgroundColor });
  config = withAlternateIconBuildSetting(config);
  return config;
};
