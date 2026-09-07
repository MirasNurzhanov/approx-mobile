# Which Expo this is

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

This project is on **SDK 54** (React Native 0.81.5, React 19.1.0).

It has been to 57 and back **twice**: 54 → 56 → 57 on 2026-08-20, back to 54 on
2026-08-21; forward to 57 again on 2026-09-04 (`a7e645f`), and back to 54 on
2026-09-07 (`633e2e1`, "iOS cannot build on it yet"). `backup/pre-sdk57` tags a
pre-upgrade `main`.

So there is a real hazard in both directions: answers written against 56/57 are
two majors *ahead* of this code and will not compile, and any 57-era source that
survives a revert is a bug. The five places the versions genuinely differ, all
of which have bitten during one hop or another:

- **react-navigation imports.** On 54, import `@react-navigation/native`
  directly — that is correct and works. `expo-router/react-navigation` does not
  exist in expo-router 6 and will not resolve. (It is the *required* form from
  SDK 56 on, which is why stale answers reach for it.)
- **`NativeTabs` parts are standalone exports** — `Label`, `Icon`, `Badge`,
  `VectorIcon`, imported from `expo-router/unstable-native-tabs`. The compound
  `NativeTabs.Trigger.Label` spelling is SDK 56+ and does not resolve here.
- **Tab bar icons.** `Icon` takes `sf` (iOS symbol), `drawable` (a bundled
  Android resource), `androidSrc` or `src` (image sources). There is **no `md`
  prop** — that is SDK 56+. To reach Android with an @expo/vector-icons glyph,
  wrap it: `androidSrc={<VectorIcon family={MaterialIcons} name="map" />}`.
- **`StyleSheet.absoluteFillObject` exists here and is the one you spread.**
  `absoluteFill` on RN 0.81 is a *registered style* — an opaque handle. It is
  valid inside a style array (`style={[StyleSheet.absoluteFill, x]}`, which is
  how most of this codebase uses it) but spreading it is a TS2698, "Spread types
  may only be created from object types". RN 0.83+ removes `absoluteFillObject`
  and makes `absoluteFill` a plain object, which is why stale answers say to
  swap them. Do not swap them here.
- **`ColorSchemeName` is `'light' | 'dark' | null | undefined`.** No
  `'unspecified'` member — that arrives in RN 0.86. So `?? 'light'` narrows
  correctly on 54 and needs no explicit check.

What did *not* change and needs no special handling: `expo-file-system` exports
`File` from its root on 54 as well as 57, `expo` exports `useEventListener`,
and `expo-video` emits `sourceLoad`, `statusChange` and `timeUpdate` on both.

Two things that are **57-only and must not be added here**, because both look
like reasonable hardening and both are pure noise on 54:

- **`"types": ["jest", "node"]` in `tsconfig.json`.** TypeScript 6 needs it;
  the 5.9 this SDK pins auto-includes `@types/*`, and the error count is
  identical with and without it (25 either way, all pre-existing and test-only).
- **A `react-native-worklets` mock in `jest.setup.js`.** Worklets 0.10
  initialises its native module at import time and throws under Jest; the 0.5.1
  here imports cleanly, and all 31 suites pass with no mock at all.

# Check declared vs installed before debugging anything

`git checkout` and `git revert` rewrite `package.json`. Neither touches
`node_modules`. After any branch switch or SDK revert the tree can be SDK 54
*source* against SDK 57 *node_modules*, and *every tool lies* in that state:
`tsc` reported 1427 errors, `jest` failed 3 suites, and each one looked like a
genuine bug with a documented fix in this file. All of them evaporated on a
plain `npm install`. Hours went into "fixing" problems that did not exist.

So before believing any error, confirm the two agree:

    node -e "console.log('declared', require('./package.json').dependencies.expo, \
      '| installed', require('./node_modules/expo/package.json').version)"

`npx expo-doctor` (expect **18/18**) and `npx expo install --check` ("dependencies
are up to date") settle it properly. If they disagree, run `npm install` and
re-measure *before* changing a line of source.

Two corollaries:

- **VS Code caches the old types.** After an install that changes SDK, the TS
  server keeps serving the previous `.d.ts` files, so the editor shows errors
  `tsc` does not — `PROVIDER_GOOGLE`/`Region` "not exported" from
  react-native-maps and `absoluteFillObject` "does not exist" are the usual
  pair. Trust `npx tsc --noEmit`, then Ctrl+Shift+P → "TypeScript: Restart TS
  Server". Do not edit source to satisfy a stale server.
- **`expo-dev-client` pairs with the SDK but is not numbered like it.** On 54 it
  is `~6.0.21`; Expo only aligned package versions *to* the SDK number starting
  at 57. `expo@~54` with `expo-dev-client@~57` cannot resolve — that exact
  mismatch was sitting uncommitted in the tree on 2026-09-07.

Baseline on a settled 54 tree, for comparison: **expo-doctor 18/18**, `tsc` 25
errors (all pre-existing, test-only), **jest 31 suites / 410 tests green**.

# Expo Go cannot run this app

Not "is currently broken" — cannot, at any version. `react-native-maps`,
`@react-native-google-signin/google-signin` and `expo-dev-client` are not in the
Expo Go runtime, the New Architecture is on, and the `app.json` plugins only
apply at prebuild. (Nothing sets `newArchEnabled` in `app.json` — SDK 54
defaults it on, and prebuild writes `newArchEnabled=true` into
`android/gradle.properties`. Its absence from the config is not it being off.)
On top of that `app/_layout.tsx` bare-imports `@/services/backgroundLocation`,
which calls `TaskManager.defineTask()` at module scope — that throws before
first render, so the app closes instantly with no error screen. If you see "requires a newer version of Expo Go", updating Expo Go
is not the fix.

Use a development build:

    eas build --profile development --platform android   # profile is in eas.json
    npx expo start --dev-client

Rebuild only when native deps change; JS edits hot-reload. Native builds go
through EAS, not this machine.

**Triage tell:** instant close = native/module-init failure. Red error screen =
recoverable JS error.
