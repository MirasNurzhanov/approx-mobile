/**
 * Whether another app is playing audio right now.
 *
 * Zone music gives way to the listener's own music: a friend's 30-second
 * preview must not pause or talk over Apple Music, Spotify or a podcast that
 * somebody chose to play. See services/zoneMusicAuto.ts.
 *
 * Optional, like approx-app-icon: a binary built before this module existed
 * (an older development build, Expo Go) has no native side, and answers false,
 * which is the behaviour before this module.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

interface NativeAudioSession {
  isOtherAudioPlaying(): boolean;
}

const native =
  Platform.OS === 'ios' || Platform.OS === 'android'
    ? requireOptionalNativeModule<NativeAudioSession>('ApproxAudioSession')
    : null;

export function isOtherAudioPlaying(): boolean {
  try {
    return native?.isOtherAudioPlaying() ?? false;
  } catch {
    return false;
  }
}
