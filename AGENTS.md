# AGENTS.md

## STOP — THIS REPOSITORY IS EXPO SDK 54

This project is currently and intentionally on:

* **Expo SDK 54**
* **React Native 0.81.5**
* **React 19.1.0**

Before writing Expo, React Native, Expo Router, navigation, native-tabs, filesystem, video, worklets, Jest, or native-platform code, consult the exact SDK 54 documentation:

https://docs.expo.dev/versions/v54.0.0/

Do **not** use current/latest Expo documentation as the primary source for APIs in this repository.

Do **not** assume SDK 56 or SDK 57 syntax is compatible.

Do **not** modernize working SDK 54 code merely because newer Expo or React Native documentation recommends a different API.

This repository has moved from SDK 54 to newer SDKs and back multiple times. Therefore both of these hazards are real:

1. SDK 57-era source may have survived a revert and be incorrect for this tree.
2. `node_modules` may still contain SDK 57 packages while `package.json` has been reverted to SDK 54.

Always establish the actual dependency state before debugging source code.

---

# Mandatory preflight before debugging

## DO NOT MODIFY SOURCE UNTIL DECLARED AND INSTALLED DEPENDENCIES AGREE

`git checkout`, `git switch`, `git reset`, and `git revert` can rewrite `package.json`.

They do **not** automatically rewrite `node_modules`.

This means the repository can contain:

* SDK 54 source
* SDK 54 `package.json`
* SDK 57 `node_modules`

at the same time.

In that state, compiler, Jest, Metro, Expo, and editor diagnostics are not trustworthy.

A real previous mismatch produced:

* `tsc`: 1427 errors
* Jest: 3 failing suites
* many apparently legitimate SDK/API errors

All of those disappeared after a plain:

```bash
npm install
```

Therefore, before believing any new build, TypeScript, Jest, Metro, Expo, React Native, or native-module error, run:

```bash
node -e "console.log('declared', require('./package.json').dependencies.expo, '| installed', require('./node_modules/expo/package.json').version)"
```

Then run:

```bash
npx expo-doctor
```

Expected healthy result:

```text
18/18 checks passed
```

Then run:

```bash
npx expo install --check
```

Expected healthy result:

```text
dependencies are up to date
```

If declared and installed Expo versions disagree, or Expo reports package-version mismatches:

```bash
npm install
```

Then rerun the failing command **before changing any source code**.

---

# Known healthy SDK 54 baseline

On a settled SDK 54 tree:

```text
expo-doctor:
18/18

TypeScript:
25 errors
all known, pre-existing, and test-only

Jest:
31 suites passed
410 tests passed
```

Treat this baseline as diagnostic evidence.

If a branch switch, revert, or dependency operation suddenly produces hundreds or thousands of TypeScript errors, native-module failures, or multiple Jest failures, suspect dependency/environment drift before assuming the source code is broken.

Do not attempt to reduce the known 25 TypeScript errors unless the task explicitly concerns them.

Do not fix unrelated pre-existing test-only TypeScript errors as part of another task.

---

# SDK history

This repository has been upgraded and reverted multiple times.

Relevant history:

```text
2026-08-20
SDK 54 → 56 → 57

2026-08-21
SDK 57 → 54

2026-09-04
SDK 54 → 57
commit: a7e645f

2026-09-07
SDK 57 → 54
commit: 633e2e1
reason: "iOS cannot build on it yet"
```

The tag:

```text
backup/pre-sdk57
```

points to a pre-upgrade `main`.

This history matters because stale SDK 57 syntax may exist in source, git history, patches, editor caches, or local dependency state.

Never infer the current SDK from a nearby commit or from installed package files without checking the current tree.

---

# Source-of-truth priority

When sources disagree about an Expo or React Native API, use this order:

1. The current repository's `package.json`
2. Installed package typings/source, **after dependency consistency has been verified**
3. Expo SDK 54 versioned documentation
4. Existing working SDK 54 patterns in this repository
5. React Native 0.81 documentation/source
6. General/current web documentation only as secondary context

Do not replace SDK 54 behavior with current Expo behavior just because the current documentation is newer.

When using web documentation, prefer explicitly versioned SDK 54 pages.

---

# SDK 54 compatibility rules

These differences have caused real regressions in this repository.

Treat them as hard constraints.

## React Navigation imports

### SDK 54 — correct

Import directly from:

```ts
import {
  NavigationContainer,
  useNavigation,
} from '@react-navigation/native';
```

`@react-navigation/native` is valid and correct on SDK 54.

### DO NOT use

```ts
expo-router/react-navigation
```

`expo-router/react-navigation` does not exist in the Expo Router version used by SDK 54 and will not resolve.

That import style belongs to newer SDKs.

Do not "fix" existing SDK 54 imports by moving them to `expo-router/react-navigation`.

---

# NativeTabs exports

On SDK 54, native-tabs components are standalone exports.

Correct:

```ts
import {
  NativeTabs,
  Label,
  Icon,
  Badge,
  VectorIcon,
} from 'expo-router/unstable-native-tabs';
```

Use standalone components such as:

```tsx
<Label>Home</Label>
```

and:

```tsx
<Icon sf="house" />
```

### DO NOT use SDK 56+ compound syntax

Do not write:

```tsx
<NativeTabs.Trigger.Label />
```

Do not write:

```tsx
<NativeTabs.Trigger.Icon />
```

Do not write:

```tsx
<NativeTabs.Trigger.Badge />
```

Those compound forms belong to newer Expo Router versions and do not resolve correctly here.

---

# NativeTabs icons

On SDK 54, `Icon` supports platform/image forms including:

```tsx
sf
drawable
androidSrc
src
```

There is **no `md` prop** on this SDK.

Do not introduce:

```tsx
<Icon md="map" />
```

That is newer-SDK syntax.

For Android using an `@expo/vector-icons` glyph, wrap the icon with `VectorIcon`.

Example:

```tsx
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  Icon,
  VectorIcon,
} from 'expo-router/unstable-native-tabs';

<Icon
  sf="map"
  androidSrc={
    <VectorIcon
      family={MaterialIcons}
      name="map"
    />
  }
/>
```

Use the existing project pattern when one exists nearby.

---

# StyleSheet absolute fill rules

This repository uses React Native 0.81.

On this version:

```ts
StyleSheet.absoluteFillObject
```

exists and is the correct plain object to spread.

Correct:

```ts
const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
});
```

`StyleSheet.absoluteFill` is a registered style / opaque style handle on this React Native version.

It is valid inside style arrays:

```tsx
<View
  style={[
    StyleSheet.absoluteFill,
    styles.overlay,
  ]}
/>
```

But do **not** spread it:

```ts
{
  ...StyleSheet.absoluteFill
}
```

Doing so can produce:

```text
TS2698: Spread types may only be created from object types
```

Newer React Native versions changed this behavior.

Do not apply RN 0.83+ advice to this SDK.

In particular, do **not** replace valid SDK 54 uses of:

```ts
StyleSheet.absoluteFillObject
```

with:

```ts
StyleSheet.absoluteFill
```

when spreading styles.

---

# ColorSchemeName

On React Native 0.81:

```ts
ColorSchemeName
```

is effectively:

```ts
'light' | 'dark' | null | undefined
```

There is no:

```ts
'unspecified'
```

member on this version.

Therefore this is valid:

```ts
const scheme = useColorScheme() ?? 'light';
```

Do not introduce an `unspecified` branch merely because newer React Native typings contain it.

That belongs to a later React Native version.

---

# APIs that are valid on both SDK 54 and SDK 57

Do not change these merely because this repository was previously upgraded.

## expo-file-system

`expo-file-system` exports `File` from its root on SDK 54.

Valid:

```ts
import { File } from 'expo-file-system';
```

Do not rewrite this solely for SDK compatibility.

---

# expo useEventListener

`expo` exports:

```ts
useEventListener
```

on SDK 54.

Valid:

```ts
import { useEventListener } from 'expo';
```

Do not rewrite this solely because newer SDK examples look different.

---

# expo-video events

The following `expo-video` events exist on SDK 54:

```text
sourceLoad
statusChange
timeUpdate
```

Do not remove or rename them merely because of the repository's SDK upgrade history.

---

# Known bad fixes — DO NOT APPLY ON SDK 54

The following changes may look like sensible modernization or hardening but are incorrect or unnecessary for this repository.

## Do not use newer React Navigation imports

Do not replace:

```ts
@react-navigation/native
```

with:

```ts
expo-router/react-navigation
```

---

## Do not use compound NativeTabs parts

Do not replace standalone:

```tsx
<Label />
<Icon />
<Badge />
<VectorIcon />
```

with SDK 56+ compound members such as:

```tsx
<NativeTabs.Trigger.Label />
```

---

## Do not add `md` to NativeTabs Icon

Do not introduce:

```tsx
<Icon md="..." />
```

Use the SDK 54-supported Android icon mechanisms.

---

## Do not replace `absoluteFillObject` with `absoluteFill` when spreading

Correct:

```ts
{
  ...StyleSheet.absoluteFillObject
}
```

Incorrect on this version:

```ts
{
  ...StyleSheet.absoluteFill
}
```

---

## Do not add `ColorSchemeName === 'unspecified'`

React Native 0.81 does not contain that member.

---

## Do not add tsconfig types merely for SDK 54

Do not add:

```json
{
  "compilerOptions": {
    "types": ["jest", "node"]
  }
}
```

merely to address SDK/version-related TypeScript diagnostics.

That became relevant during the SDK 57 / TypeScript 6 path.

SDK 54 uses TypeScript 5.9, which auto-includes installed `@types/*` packages.

In this repository, adding those `types` entries does not improve the known TypeScript baseline.

The error count remains:

```text
25
```

with or without them.

Do not introduce this configuration unless a separate, concrete task requires it.

---

# Do not add a react-native-worklets Jest mock

Do not add a global Jest mock for:

```text
react-native-worklets
```

solely because newer SDKs require one.

The newer Worklets version used during SDK 57 initializes its native module at import time and can fail under Jest.

The SDK 54 version used here:

```text
react-native-worklets 0.5.1
```

imports cleanly in the current Jest setup.

Healthy SDK 54 baseline:

```text
31 suites passed
410 tests passed
```

No `react-native-worklets` mock is required.

---

# expo-dev-client versioning

Do not assume every Expo package's major version should equal the Expo SDK number.

On SDK 54, the expected `expo-dev-client` line is approximately:

```text
~6.0.21
```

Expo package versions were not universally aligned numerically with the SDK number at this point.

A configuration such as:

```text
expo@~54
expo-dev-client@~57
```

is invalid.

That exact mismatch has previously existed in this repository.

Use:

```bash
npx expo install <package>
```

when possible so Expo chooses an SDK-compatible package version.

Never manually "align" package majors to SDK 54 by number alone.

---

# VS Code TypeScript cache after SDK changes

After dependencies change between SDKs, VS Code may continue serving old `.d.ts` files from the TypeScript language server.

This can produce editor-only errors that do not exist in the actual compiler.

Known examples include false reports that:

```text
PROVIDER_GOOGLE
Region
```

are not exported from `react-native-maps`.

Another known false report is:

```text
StyleSheet.absoluteFillObject does not exist
```

If VS Code and the CLI disagree, trust:

```bash
npx tsc --noEmit
```

after dependencies have been verified.

Then restart the TypeScript server:

```text
Ctrl+Shift+P
→ TypeScript: Restart TS Server
```

Do not edit working source code merely to satisfy stale editor diagnostics.

---

# Expo Go cannot run this application

Expo Go is **not a supported runtime for this project**.

This is not a temporary Expo Go bug.

This application requires a development build.

Relevant native dependencies include:

```text
react-native-maps
@react-native-google-signin/google-signin
expo-dev-client
```

The app also depends on native configuration generated by Expo plugins.

These requirements cannot be satisfied by Expo Go.

Do not attempt to solve runtime failures by upgrading or reinstalling Expo Go.

---

# New Architecture

The application uses the New Architecture.

There may be no explicit:

```json
"newArchEnabled": true
```

entry in `app.json`.

That does **not** mean the New Architecture is disabled.

SDK 54 defaults the New Architecture on.

Prebuild writes:

```text
newArchEnabled=true
```

into:

```text
android/gradle.properties
```

Do not add or remove configuration solely because `newArchEnabled` is absent from `app.json`.

---

# Background location initialization

`app/_layout.tsx` bare-imports:

```ts
@/services/backgroundLocation
```

That module calls:

```ts
TaskManager.defineTask()
```

at module scope.

This is important during startup debugging.

When the required native module/runtime is unavailable, the failure can occur before the application's first render.

That means Expo Go may close immediately without rendering a recoverable React error screen.

Do not misdiagnose that behavior as a normal screen/component bug.

---

# Runtime triage rule

Use this distinction during debugging:

```text
Instant application close
→ suspect native module initialization, startup import, or native runtime failure

Red React Native error screen
→ suspect recoverable JavaScript/runtime error
```

This is a triage heuristic, not an absolute guarantee, but it has been useful in this repository.

---

# Correct development workflow

Use a development build.

Android:

```bash
eas build --profile development --platform android
```

The development profile already exists in:

```text
eas.json
```

Then start Metro with:

```bash
npx expo start --dev-client
```

Use the installed development client to run the application.

JavaScript and TypeScript changes can hot reload / fast refresh.

Do not rebuild a native binary for ordinary JS/TS edits.

---

# When a native rebuild is required

Rebuild the development client when a change affects native code or native configuration.

Examples include:

* adding/removing a native dependency
* changing native package versions
* changing Expo config plugins
* changing plugin configuration
* changing Android native files
* changing iOS native files
* changing build properties that affect native compilation
* changing permissions/configuration requiring native regeneration

Ordinary JS/TS component, hook, store, service, or styling changes generally do not require a new native build.

Native builds for this repository go through EAS.

Do not assume this machine is the native build environment.

---

# Debugging protocol

When an error appears, follow this order.

## 1. Establish the environment

Verify:

```text
package.json
node_modules
Expo SDK
package compatibility
```

Run the dependency preflight described above.

Do not skip this step after:

* checkout
* branch switch
* revert
* reset
* merge
* dependency change
* SDK work

---

## 2. Reproduce the problem

Do not modify code based solely on:

* a screenshot
* stale VS Code diagnostics
* an old CI log
* an error copied from a different SDK state
* an assumption about the cause

Run the failing command or reproduce the failing runtime behavior when possible.

---

## 3. Inspect relevant code before editing

Read:

* the failing file
* its imports
* nearby call sites
* relevant tests
* existing project patterns
* dependency typings when useful

Prefer the repository's existing working pattern over introducing a new abstraction without reason.

---

## 4. Consult SDK 54 documentation

For Expo APIs use:

```text
https://docs.expo.dev/versions/v54.0.0/
```

Do not rely on unversioned/current Expo docs when behavior differs by SDK.

For React Native behavior, remember that this repository uses:

```text
React Native 0.81.5
```

Do not apply behavior from RN 0.83, 0.86, or later without verifying compatibility.

---

## 5. Form a root-cause hypothesis

Before editing, determine what evidence supports the proposed fix.

Avoid:

```text
error → search error text → copy newest documented fix
```

Prefer:

```text
error
→ verify environment
→ reproduce
→ inspect source
→ inspect types/docs
→ determine root cause
→ patch
```

---

## 6. Make the smallest correct change

Do not:

* perform unrelated cleanup
* modernize surrounding code
* upgrade dependencies unless asked
* change APIs merely because newer syntax exists
* fix unrelated baseline TypeScript errors
* rewrite entire modules when a narrow fix is sufficient

Preserve public behavior unless the task explicitly requires changing it.

---

## 7. Validate the narrowest relevant surface

After a change, run the most relevant validation first.

Examples:

```bash
npx tsc --noEmit
```

Relevant Jest test:

```bash
npx jest path/to/test
```

Relevant test suite:

```bash
npm test -- <pattern>
```

Lint if configured and relevant.

Do not treat the known 25 baseline TypeScript errors as regressions unless the count or affected files change.

---

## 8. Run broader validation when warranted

For cross-cutting or dependency-sensitive changes, validate more broadly.

Useful commands include:

```bash
npx expo-doctor
```

```bash
npx expo install --check
```

```bash
npx tsc --noEmit
```

```bash
npm test
```

Compare results against the known SDK 54 baseline.

---

# Investigation before implementation

For non-trivial tasks:

1. inspect the relevant implementation
2. inspect related tests
3. inspect dependency/API behavior
4. determine the root cause
5. explain or internally establish the plan
6. implement
7. test
8. review the resulting diff

Do not start large edits while still uncertain which SDK/API behavior applies.

---

# Self-review requirements

Before considering a non-trivial change complete, inspect the diff as if reviewing another engineer's work.

Check for:

* accidental SDK 56/57 syntax
* incorrect imports
* stale package assumptions
* API incompatibilities
* regressions
* edge cases
* native/runtime implications
* missing tests
* unnecessary changes
* unrelated formatting churn
* incorrect TypeScript narrowing
* changed behavior outside task scope

If a change touches an SDK-sensitive area, compare it against the compatibility rules in this file before finalizing.

---

# Dependency changes

Prefer:

```bash
npx expo install <package>
```

over arbitrary:

```bash
npm install <package>@latest
```

for Expo/React Native packages.

Do not upgrade the Expo SDK unless the task explicitly requests an SDK upgrade.

Do not silently upgrade dependencies while fixing an unrelated issue.

If a dependency must change, verify that the chosen version is compatible with SDK 54.

After dependency changes, run:

```bash
npm install
```

if needed, followed by:

```bash
npx expo-doctor
npx expo install --check
```

and appropriate TypeScript/tests.

---

# Git discipline

Do not undo unrelated user changes.

Do not reset files merely because they differ from `main`.

This repository has intentionally moved between SDK versions multiple times, so unusual-looking code may have history that matters.

Before reverting an SDK-sensitive line, verify:

* current package version
* current API support
* git history when useful
* whether the line is actually stale SDK 57 code

Use git history as evidence, not as the primary API source.

---

# Generated native files

Be cautious when editing generated native files.

Expo config plugins and prebuild may regenerate:

```text
android/
ios/
```

Understand whether the source of truth is:

* `app.json`
* `app.config.*`
* a config plugin
* a dependency
* an intentionally committed native modification

Do not patch generated output when the real fix belongs in Expo configuration.

Conversely, do not assume every native-file change is disposable if this repository intentionally maintains native changes.

Inspect surrounding project conventions first.

---

# Testing philosophy

Tests should protect the behavior changed by the task.

For bug fixes:

1. reproduce the bug when practical
2. add or update a regression test when appropriate
3. implement the smallest fix
4. verify the regression test passes
5. ensure unrelated tests remain green

Do not add compatibility mocks, polyfills, or configuration solely to imitate SDK 57 behavior.

---

# TypeScript philosophy

Do not weaken types merely to silence diagnostics.

Avoid introducing:

```ts
any
```

type assertions, ignores, or suppression comments unless they are genuinely justified.

Before treating a type error as real:

1. verify dependencies
2. run CLI TypeScript
3. compare with the known baseline
4. restart the VS Code TS server if only the editor disagrees

Remember:

```text
CLI compiler after a verified install > stale editor diagnostics
```

---

# Do not speculate about unavailable native modules

When running in an unsupported environment such as Expo Go, errors caused by absent native modules are not evidence that the source implementation is incorrect.

First ask:

```text
Is this code running inside the development build it requires?
```

For this repository, the expected answer during normal app testing is yes.

---

# Quick compatibility reference

| Area                           | SDK 54 — use                                      | Do not use here                                  |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------ |
| React Navigation               | `@react-navigation/native`                        | `expo-router/react-navigation`                   |
| NativeTabs components          | standalone `Label`, `Icon`, `Badge`, `VectorIcon` | `NativeTabs.Trigger.Label` etc.                  |
| NativeTabs Android vector icon | `androidSrc={<VectorIcon ... />}`                 | `md=`                                            |
| Spread absolute-fill styles    | `StyleSheet.absoluteFillObject`                   | spread `StyleSheet.absoluteFill`                 |
| Style array absolute fill      | `StyleSheet.absoluteFill`                         | unnecessary replacement                          |
| `ColorSchemeName`              | `light`, `dark`, `null`, `undefined`              | `unspecified`                                    |
| `expo-file-system`             | root `File` export valid                          | unnecessary compatibility rewrite                |
| `expo`                         | `useEventListener` valid                          | unnecessary rewrite                              |
| `expo-video`                   | `sourceLoad`, `statusChange`, `timeUpdate`        | unnecessary rewrite                              |
| `tsconfig`                     | existing SDK 54 config                            | adding `types: ["jest","node"]` for SDK mismatch |
| Jest worklets                  | no special mock needed                            | SDK 57-style worklets mock                       |
| Runtime                        | development build                                 | Expo Go                                          |

---

# Quick preflight checklist

Before debugging any strange SDK/API error:

```text
[ ] Confirm package.json says Expo SDK 54
[ ] Confirm installed Expo version matches
[ ] Run npm install if they disagree
[ ] Run expo-doctor
[ ] Expect 18/18
[ ] Run expo install --check
[ ] Confirm dependencies are up to date
[ ] Run the actual failing command again
[ ] Trust CLI tsc over stale VS Code diagnostics
[ ] Restart VS Code TS server if necessary
[ ] Read SDK 54 docs
[ ] Only then change source
```

---

# Quick implementation checklist

Before finishing a change:

```text
[ ] No SDK 56/57-only API was introduced
[ ] Existing project patterns were checked
[ ] Change is scoped to the requested task
[ ] Relevant TypeScript/test validation was run
[ ] Results were compared against known baseline
[ ] Diff was reviewed for unrelated changes
[ ] Native rebuild requirements were considered
```

---

# Core rules to remember

If only a few rules survive context compression, preserve these:

1. **This repository is Expo SDK 54, React Native 0.81.5, React 19.1.0.**
2. **Use the Expo SDK 54 versioned documentation.**
3. **Verify `package.json` and `node_modules` agree before debugging.**
4. **Never modify source to fix errors caused by an SDK-mismatched install.**
5. **Do not introduce SDK 56/57 syntax into SDK 54 code.**
6. **`@react-navigation/native` is correct here.**
7. **NativeTabs parts are standalone exports here.**
8. **NativeTabs `Icon` has no `md` prop here.**
9. **Spread `StyleSheet.absoluteFillObject`, not `StyleSheet.absoluteFill`.**
10. **`ColorSchemeName` has no `unspecified` member here.**
11. **Do not add SDK 57-only tsconfig or Worklets Jest fixes.**
12. **Expo Go cannot run this application. Use the development build.**
13. **Known healthy baseline: Expo Doctor 18/18, Jest 31/31 suites and 410 tests, TypeScript 25 known test-only errors.**
14. **Investigate and prove the root cause before editing.**
15. **Do not modernize working SDK 54 code without an explicit reason.**
