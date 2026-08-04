// Palette colour → translucent rgba, for map overlays.
//
// Small, but it replaced a set of hand-written rgba literals that had all been
// pinned to the dark theme — including the ring around other people's music
// zones, which stayed a pale teal on the near-white light basemap and was
// effectively invisible. If this returns something a native map cannot parse,
// that ring silently disappears rather than erroring, so the parsing is worth
// pinning.

import {
  colors,
  lightColors,
  withAlpha,
  zoneRingColor,
  ZONE_RING_COLORS,
} from '../../constants/theme';

describe('withAlpha', () => {
  it('converts a six-digit hex', () => {
    expect(withAlpha('#1FC7B6', 0.55)).toBe('rgba(31,199,182,0.55)');
  });

  it('converts a three-digit hex by doubling each channel', () => {
    expect(withAlpha('#0F8', 1)).toBe('rgba(0,255,136,1)');
  });

  it('does not care about the leading hash', () => {
    expect(withAlpha('8B5CF6', 0.4)).toBe('rgba(139,92,246,0.4)');
  });

  it('is case insensitive', () => {
    expect(withAlpha('#8b5cf6', 0.4)).toBe(withAlpha('#8B5CF6', 0.4));
  });

  it('passes an unparseable colour straight through', () => {
    // Better a fully opaque ring than a malformed string the native map drops
    // on the floor — a visible wrong alpha is debuggable, an absent ring is not.
    expect(withAlpha('not-a-colour', 0.5)).toBe('not-a-colour');
    expect(withAlpha('#12345', 0.5)).toBe('#12345');
  });

  it('produces different rings for the two themes', () => {
    // The whole point. `teal` is a green in dark and an orange in light, so a
    // literal baked from one is wrong on the other — which is exactly how the
    // invisible ring got shipped.
    expect(withAlpha(colors.teal, 0.55)).not.toBe(withAlpha(lightColors.teal, 0.55));
  });

  it('gives the light theme a ring with real contrast on a white map', () => {
    // Not a precise perceptual measure — just enough to catch a palette edit
    // that quietly puts a near-white colour back on a near-white basemap.
    const hex = lightColors.teal.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    expect(luminance).toBeLessThan(0.72);
  });
});

/** Perceived brightness, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

describe('zoneRingColor', () => {
  it('gives the same person the same colour every time', () => {
    // Stability is the point: a ring that was blue an hour ago has to still be
    // blue, or the colour tells you nothing.
    expect(zoneRingColor('miras')).toBe(zoneRingColor('miras'));
  });

  it('is unaffected by how many other people have been coloured', () => {
    // Rules out the obvious wrong implementation — handing out the next colour
    // in the list as each person appears. That would give the same friend a
    // different ring depending on poll order, so two phones looking at the same
    // street would disagree about whose zone is whose.
    const before = zoneRingColor('miras');
    for (let i = 0; i < 500; i++) zoneRingColor(`someone-${i}`);
    expect(zoneRingColor('miras')).toBe(before);
  });

  it('spreads a handful of neighbours across different colours', () => {
    // Not a guarantee — a hash can collide — but a realistic group should not
    // all land on one colour, which would put the feature back where it was.
    const names = ['miras', 'aisha', 'nurdaulet', 'dana', 'timur', 'alina'];
    const used = new Set(names.map(zoneRingColor));
    expect(used.size).toBeGreaterThanOrEqual(3);
  });

  it('only ever returns a colour from the palette', () => {
    for (const name of ['a', 'zz', 'Пользователь', '@@@', 'x'.repeat(200)]) {
      expect(ZONE_RING_COLORS).toContain(zoneRingColor(name));
    }
  });

  it('survives an empty name', () => {
    expect(ZONE_RING_COLORS).toContain(zoneRingColor(''));
  });

  it('holds every ring colour to a luminance that reads on both maps', () => {
    // The invisible-teal bug, generalised. Too light disappears on the white
    // basemap, too dark disappears on the near-black one. This is the band that
    // survives both, and it is why AVATAR_COLORS could not be reused — those
    // are pale backgrounds for dark text.
    for (const hex of ZONE_RING_COLORS) {
      expect(luminance(hex)).toBeGreaterThan(0.4);
      expect(luminance(hex)).toBeLessThan(0.68);
    }
  });

  it('never hands out the colour that means "yours"', () => {
    // Purple is the owner's, on every surface of the map.
    for (const hex of ZONE_RING_COLORS) {
      expect(hex.toLowerCase()).not.toBe(colors.purple.toLowerCase());
      expect(hex.toLowerCase()).not.toBe(lightColors.purple.toLowerCase());
    }
  });
});
