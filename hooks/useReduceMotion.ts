import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The OS "Reduce Motion" setting (iOS Settings → Accessibility → Motion,
 * Android Settings → Accessibility → Remove animations).
 *
 * Respecting it is not cosmetic: large sweeping or springy motion triggers
 * nausea and dizziness for people with vestibular disorders. Where motion
 * carries meaning, swap it for an instant state change rather than dropping
 * the feedback entirely.
 *
 * The value can change while the app is running, so this subscribes rather
 * than reading once.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let active = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduce(enabled);
      })
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  return reduce;
}

/**
 * Announce something to VoiceOver / TalkBack that has no visual focus change —
 * a message arriving, a list refreshing. Silent when no screen reader is on.
 */
export function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}
