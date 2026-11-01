import { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform, type KeyboardEvent } from 'react-native';

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
    const follow = (next: number) => (event: KeyboardEvent) => {
      if (ios && event.duration) {
        LayoutAnimation.configureNext({
          duration: event.duration,
          update: { type: LayoutAnimation.Types.keyboard },
        });
      }
      setHeight(next < 0 ? event.endCoordinates.height : next);
    };
    const subs = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', follow(-1)),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', follow(0)),
    ];
    return () => subs.forEach(sub => sub.remove());
  }, []);
  return height;
}
