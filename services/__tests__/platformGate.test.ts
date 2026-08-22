// The iOS 26 capability gate.
//
// This decides, for every screen in the app, whether UIKit draws the navigation
// bar or the app draws its own. Two ways to get it wrong are worth pinning:
//
// 1. `Platform.Version` is a *string* on iOS ("26.0") and a *number* on Android
//    — the API level. Android 14 reports 34. A check that parses the version
//    before checking the OS turns iOS-only behaviour on for most of the Android
//    install base, and nothing about that failure is obvious from the code.
// 2. An unrecognised version must not throw. This runs at module load, on the
//    launch path, so an exception here is a white screen rather than a bug.

import { Platform } from 'react-native';

import {
  BAR_STYLE_IS_NATIVE,
  IOS_MAJOR_VERSION,
  isIOS26OrNewer,
  resolveIOSMajorVersion,
  resolvesToNativeBar,
} from '../../constants/platform';

const gate = (os: string, version: unknown) => resolveIOSMajorVersion(os, version) >= 26;

describe('resolveIOSMajorVersion', () => {
  it('reads the major version from the iOS format', () => {
    expect(resolveIOSMajorVersion('ios', '26.0')).toBe(26);
    expect(resolveIOSMajorVersion('ios', '26.1.2')).toBe(26);
    expect(resolveIOSMajorVersion('ios', '18.5')).toBe(18);
  });

  it('accepts a bare major version', () => {
    expect(resolveIOSMajorVersion('ios', '26')).toBe(26);
    expect(resolveIOSMajorVersion('ios', 26)).toBe(26);
  });

  it('answers 0 on every platform that is not iOS', () => {
    // The Android numbers here are real API levels, which is the whole point:
    // all of them are >= 26 as integers.
    expect(resolveIOSMajorVersion('android', 34)).toBe(0);
    expect(resolveIOSMajorVersion('android', 28)).toBe(0);
    expect(resolveIOSMajorVersion('android', '34')).toBe(0);
    expect(resolveIOSMajorVersion('web', undefined)).toBe(0);
    expect(resolveIOSMajorVersion('macos', '26.0')).toBe(0);
  });

  it('answers 0 rather than throwing on a version it cannot parse', () => {
    expect(resolveIOSMajorVersion('ios', undefined)).toBe(0);
    expect(resolveIOSMajorVersion('ios', null)).toBe(0);
    expect(resolveIOSMajorVersion('ios', '')).toBe(0);
    expect(resolveIOSMajorVersion('ios', 'unknown')).toBe(0);
    expect(resolveIOSMajorVersion('ios', {})).toBe(0);
    expect(resolveIOSMajorVersion('ios', NaN)).toBe(0);
    expect(resolveIOSMajorVersion('ios', -1)).toBe(0);
  });
});

describe('the iOS 26 gate', () => {
  it('selects native navigation on iOS 26 and newer', () => {
    expect(gate('ios', '26.0')).toBe(true);
    expect(gate('ios', '26.4')).toBe(true);
    expect(gate('ios', '27.0')).toBe(true);
  });

  it('selects the app’s own navigation bar on iOS 25 and older', () => {
    expect(gate('ios', '25.0')).toBe(false);
    expect(gate('ios', '18.5')).toBe(false);
    expect(gate('ios', '17.0')).toBe(false);
  });

  it('selects the app’s own navigation bar on Android, whatever the API level', () => {
    expect(gate('android', 26)).toBe(false);
    expect(gate('android', 34)).toBe(false);
    expect(gate('android', 99)).toBe(false);
  });

  it('selects the app’s own navigation bar everywhere else', () => {
    expect(gate('web', undefined)).toBe(false);
    expect(gate('windows', '26.0')).toBe(false);
  });
});

describe('the exported constants', () => {
  // The tests above exercise the logic; this one proves the shipped constants
  // are actually wired to the running platform rather than to a literal.
  it('derive from the running platform', () => {
    expect(IOS_MAJOR_VERSION).toBe(resolveIOSMajorVersion(Platform.OS, Platform.Version));
    expect(isIOS26OrNewer).toBe(IOS_MAJOR_VERSION >= 26);
    expect(BAR_STYLE_IS_NATIVE).toBe(resolvesToNativeBar(Platform.OS));
  });
});

describe('resolvesToNativeBar', () => {
  it('is true only on iOS', () => {
    expect(resolvesToNativeBar('ios')).toBe(true);
  });

  it('is false on Android, whose Material 3 bar this app cannot fully control', () => {
    expect(resolvesToNativeBar('android')).toBe(false);
  });

  it('is false everywhere else too', () => {
    expect(resolvesToNativeBar('web')).toBe(false);
    expect(resolvesToNativeBar('windows')).toBe(false);
  });
});
