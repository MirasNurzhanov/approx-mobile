// Sizes shared by the map screen, its markers and their styles.
// Moved out of app/(tabs)/map.tsx unchanged.

/** Matches APPROX_GRID_M on the server. */
export const APPROX_RADIUS_M = 500;

/** Stranger marker: a point of light, not a pin. Small on purpose — a stranger
 *  is a dot with no name and no face, so the marker should not imply it is
 *  hiding a card behind it. */
export const DOT_CORE = 14;
export const DOT_HALO = 30;
/** Halo for a dot carrying an interest glyph. Bigger than DOT_HALO because the
 *  core has to hold a 13pt icon and its ring, not a 14pt point. */
export const DOT_HALO_ICON = 38;

// ── Locate control ──
// FOCUS_DELTA, RECENTER_MS and STALE_FIX_MS moved with the camera they drive,
// into hooks/useMapLocation. What is left here is what the button *looks* like.
export const LOCATE_SIZE = 48;   // ≥ 44pt target
/** Edge inset, used on the wheel. On the tab bar the button tracks the last
 *  tab instead — see `useNavAlignedRight`. Matches the top bar's padding. */
export const LOCATE_INSET = 20;
