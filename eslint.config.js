// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Build-time scripts run in Node, not on a device. Without this the Expo
    // config — which assumes a React Native environment everywhere — flags
    // `__dirname`, `Buffer` and friends as undefined.
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        module: 'writable',
        process: 'readonly',
        require: 'readonly',
      },
    },
  },
  {
    // Jest injects its own globals, which the Expo config does not know about.
    files: ['jest.setup.js', '**/__tests__/**', '**/*.test.{ts,tsx,js}'],
    languageOptions: {
      globals: {
        afterAll: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        jest: 'readonly',
        require: 'readonly',
        test: 'readonly',
      },
    },
  },
  {
    // `react/no-unescaped-entities` exists to stop quotes and apostrophes
    // creating ambiguity in *HTML*. These screens render through React
    // Native's <Text>, where that ambiguity does not arise, and every one of
    // the handful of places it fires is ordinary English prose — "Don't have
    // an account?", `No results for "…"`. Escaping would work (Babel decodes
    // entities in JSX text) but it buys nothing here and makes the copy
    // materially harder to read and to translate.
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    rules: {
      'react/no-unescaped-entities': 'off',
    },
  },
]);
