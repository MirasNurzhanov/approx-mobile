// Google basemap styling, shared by every map surface in the app.
//
// Lives here rather than beside the map screen because there is more than one
// map — the main one and the zone-size preview — and a basemap that shows
// different things on each is a bug waiting to be reported as "the preview
// doesn't look like the map".

/** Points of interest, hidden.
 *
 * Google's default basemap prints every shop, café, salon and takeaway over
 * the map as a badge: an icon, a name, and often a rating. On a map whose
 * entire job is showing *people*, those compete with the markers and win —
 * they are denser, they never move, and they are drawn by the basemap
 * underneath everything Aura puts on top, so no amount of z-index reaches
 * them. The only way to remove them is to style them out.
 *
 * `poi` covers parks, schools and hospitals as well as businesses. Hiding the
 * lot is deliberate: the dark map has done exactly this since the redesign,
 * and hiding only `poi.business` would have left light and dark showing
 * different maps.
 *
 * Labels only. The geometry underneath — a park's green, a building's
 * footprint — is useful orientation and carries no badge.
 */
export const HIDE_POI_LABELS = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

/** The light map.
 *
 * Google's own colours, minus the POI badges. This used to be an empty array
 * passed straight to `customMapStyle`, which means "no styling", which means
 * the defaults — so every business badge the dark map had removed came
 * straight back the moment anyone switched to light.
 */
export const LIGHT_MAP_STYLE = [...HIDE_POI_LABELS];

/** The dark map: neutral tonal greys, muted labels, no accent colour. */
export const DARK_MAP_STYLE = [
  { elementType: 'geometry',                    stylers: [{ color: '#0E0E11' }] },
  { elementType: 'labels.text.fill',            stylers: [{ color: '#5E5E68' }] },
  { elementType: 'labels.text.stroke',          stylers: [{ color: '#0A0A0B' }] },
  { featureType: 'road', elementType: 'geometry',              stylers: [{ color: '#1A1A20' }] },
  { featureType: 'road', elementType: 'geometry.stroke',       stylers: [{ color: '#16161B' }] },
  { featureType: 'road', elementType: 'labels.text.fill',      stylers: [{ color: '#5E5E68' }] },
  { featureType: 'road.highway', elementType: 'geometry',      stylers: [{ color: '#1A1A20' }] },
  { featureType: 'water', elementType: 'geometry',             stylers: [{ color: '#0A0A0D' }] },
  { featureType: 'water', elementType: 'labels.text.fill',     stylers: [{ color: '#5E5E68' }] },
  { featureType: 'poi', elementType: 'geometry',               stylers: [{ color: '#101312' }] },
  { featureType: 'transit', elementType: 'geometry',           stylers: [{ color: '#16161B' }] },
  { featureType: 'administrative', elementType: 'geometry',         stylers: [{ color: '#1A1A20' }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#5E5E68' }] },
  ...HIDE_POI_LABELS,
];

/** The style for a theme. The one place a map surface should ask. */
export function mapStyleFor(themeMode: string) {
  return themeMode === 'dark' ? DARK_MAP_STYLE : LIGHT_MAP_STYLE;
}
