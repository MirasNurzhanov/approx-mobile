import { Easing, SlideInDown } from 'react-native-reanimated';

/**
 * How a bottom sheet presented in a `Modal` arrives.
 *
 * The Modal itself fades, and only the sheet rises with this. Sliding the whole
 * Modal (`animationType="slide"`) carried the dimmed backdrop up with the sheet,
 * so a block of black visibly rose from the bottom of the screen behind it.
 * Same length as the map's own cards (components/map/MapSheets). Honours Reduce
 * Motion, like every Reanimated layout animation by default.
 */
export const SHEET_RISE = SlideInDown.duration(260).easing(Easing.out(Easing.cubic));
