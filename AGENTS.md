# Which Expo this is

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

This project is on **SDK 57** (React Native 0.86.3, React 19.2.3).

Its history is worth knowing, because it makes stale answers cut both ways.
The tree went 54 → 56 → 57 on 2026-08-20, was deliberately brought back to 54
on 2026-08-21, and was moved forward to 57 again on 2026-09-04. So answers
written against 54 are three majors *behind* this code and will not compile,
and any 54-era source that survived the re-upgrade is a bug. The places the
versions genuinely differ, all of which bit during one hop or the other:

- **react-navigation imports.** From SDK 56 on, expo-router refuses direct
  `@react-navigation/*` imports and throws at bundle time. Import from
  `expo-router/react-navigation` instead. (On 54 the direct import was the
  correct form and the re-export did not exist, which is why stale answers
  reach for it.)
- **`NativeTabs` parts are compound** — `NativeTabs.Trigger.Label`, `.Icon`,
  `.Badge`, `.VectorIcon`. The standalone `Label`/`Icon`/`Badge`/`VectorIcon`
  exports from `expo-router/unstable-native-tabs` are SDK 54 and no longer
  exist; only `NativeTabs` itself is exported now.
- **Tab bar icons.** `Icon` takes `sf` (iOS symbol), `xcasset`, `drawable` (a
  bundled Android resource), **`md`** (a Material Symbols name) and `src`.
  Priority is `sf` > `xcasset` > `src` on iOS and `drawable` > `md` > `src` on
  Android. **There is no `androidSrc` prop** — that was SDK 54, and the
  `androidSrc={<VectorIcon .../>}` bridge it needed is replaced by plain
  `md="map"`.
- **`StyleSheet.absoluteFillObject` is gone** (removed in RN 0.83+). Use
  `StyleSheet.absoluteFill`, which is an object and spreads the same way.
- **`ColorSchemeName` includes `'unspecified'`** from RN 0.86, so narrowing to
  `'light' | 'dark'` needs an explicit check, not just `?? 'light'`.

Two things that are configuration rather than source, both of which cost a
while to find and neither of which is obvious from an error message:

- **`tsconfig.json` must set `"types": ["jest", "node"]`.** TypeScript 6 (which
  SDK 57 pins) no longer picks up `@types/*` automatically here, and without
  the explicit list every test file reports ~1400 phantom errors
  (`Cannot find name 'describe'`, `Cannot use namespace 'jest' as a value`).
- **`expo-modules-core` must end up *hoisted*** to `node_modules/`. When npm
  nests it under `node_modules/expo/` instead, `expo-audio`’s types cannot
  resolve `SharedObject`, and because `skipLibCheck` hides the unresolved
  import the only symptom is `AudioPlayer` silently losing `addListener`.
  Do **not** fix that by adding it to `dependencies` — `expo-doctor` fails the
  project for depending on it directly. A plain `npm install` hoisted it here;
  `npm dedupe` did not.

**`react-native-worklets` must stay mocked in `jest.setup.js`.** From 0.10 it
initialises its native module at *import* time, so merely importing it throws
under Jest. Only `scheduleOnRN` (the app’s whole usage) and
`createSerializable` (which reanimated imports from it) are needed.

What did *not* change and needs no special handling: `expo-file-system` exports
`File` from its root on 54 as well as 57, `expo` exports `useEventListener`,
and `expo-video` emits `sourceLoad`, `statusChange` and `timeUpdate` on both.

# Expo Go cannot run this app

Not "is currently broken" — cannot, at any version. `react-native-maps`,
`@react-native-google-signin/google-signin` and `expo-dev-client` are not in the
Expo Go runtime, `newArchEnabled` is on, and the `app.json` plugins only apply at
prebuild. On top of that `app/_layout.tsx` bare-imports
`@/services/backgroundLocation`, which calls `TaskManager.defineTask()` at module
scope — that throws before first render, so the app closes instantly with no
error screen. If you see "requires a newer version of Expo Go", updating Expo Go
is not the fix.

Use a development build:

    eas build --profile development --platform android   # profile is in eas.json
    npx expo start --dev-client

Rebuild only when native deps change; JS edits hot-reload. Native builds go
through EAS, not this machine.

**Triage tell:** instant close = native/module-init failure. Red error screen =
recoverable JS error.
