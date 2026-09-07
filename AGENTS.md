# Which Expo this is

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

This project is on **SDK 54** (React Native 0.81.5, React 19.1.0).

It briefly ran on SDK 57 — the tree went 54 → 56 → 57 on 2026-08-20 and was
deliberately brought back to 54 on 2026-08-21. So there is a real hazard in
both directions here: answers written against 56/57 are two majors *ahead* of
this code and will not compile, and any 57-era source that survives the revert
is a bug. The three places the versions genuinely differ, all of which bit
during the downgrade:

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
