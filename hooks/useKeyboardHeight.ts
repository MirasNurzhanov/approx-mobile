import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, Platform, type KeyboardEvent } from 'react-native';

/**
 * How tall the software keyboard is right now, 0 while it is down.
 *
 * For views whose bottom edge is the screen's bottom edge, where the keyboard's
 * height is exactly how far they must lift — an iOS `pageSheet` is the case
 * this exists for; see components/swifts/SwiftCommentsSheet. Animated with the
 * keyboard on iOS, which announces the move before making it.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const set = (event: KeyboardEvent, next: number) => {
      if (ios && event.duration) {
        LayoutAnimation.configureNext({
          duration: event.duration,
          update: { type: LayoutAnimation.Types.keyboard },
        });
      }
      setHeight(next);
    };
    const subs = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => set(e, e.endCoordinates.height)),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => set(e, 0)),
    ];
    if (ios) {
      // Every move, not just show and hide. A keyboard raised by an autofocus
      // while a modal is still being presented can be shown, hidden and
      // brought back with only frame changes, and a tracker that missed the
      // return read 0 under a visible keyboard — the story sheet sat behind it.
      // Off-screen (its top at or below the screen's bottom) means down.
      subs.push(Keyboard.addListener('keyboardWillChangeFrame', (e) => {
        const down = e.endCoordinates.screenY >= Dimensions.get('screen').height;
        set(e, down ? 0 : e.endCoordinates.height);
      }));
    }
    return () => subs.forEach(sub => sub.remove());
  }, []);
  return height;
}
