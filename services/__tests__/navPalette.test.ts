// The bottom nav's colour contract.
//
// The nav is five tokens that have to hold up against each other in every
// theme, and the numbers are easy to break by eye: the light theme's selected
// colour is an orange, and the obvious "make it more orange" edit — the
// palette's own `#F97316` — lands at 2.80:1 and fails even the 3:1 graphical
// floor, never mind the 4.5:1 the 11pt tab label needs. The theme file says so
// in a comment; this makes the comment enforceable.
//
// `navActive` has to clear the bar in both directions at once. It is the tab
// label and tint *on* `navBg`, and it is the pill and wedge fill *under*
// `navOnActive` — and since contrast is symmetric, one number settles both.

import { lightColors, THEMES } from '../../constants/theme';

/** WCAG 2.1 relative luminance, sRGB. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const chan = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** AA for body text. The tab label is 11pt semibold — under the 14pt-bold
 *  threshold, so it gets no large-text exemption. */
const AA = 4.5;

// Every theme, from the registry, so a palette added there is held to the same
// contract without anybody having to remember this file exists.
const PALETTES = THEMES.map((theme) => [theme.id, theme.colors] as const);

describe.each(PALETTES)('%s nav palette', (_name, palette) => {
  it('reads the selected item against the bar it sits on', () => {
    expect(contrast(palette.navActive, palette.navBg)).toBeGreaterThanOrEqual(AA);
  });

  it('reads the glyph sitting on top of the selected fill', () => {
    expect(contrast(palette.navOnActive, palette.navActive)).toBeGreaterThanOrEqual(AA);
  });

  it('reads the unselected items too — they are the other four labels', () => {
    expect(contrast(palette.navInactive, palette.navBg)).toBeGreaterThanOrEqual(AA);
  });

  it('shows selection with a fill, not with the label colour alone', () => {
    // Light mode's two label colours are 1.10:1 apart — the orange #C75000 and
    // the grey #6E6E76 are very nearly the same brightness, so what separates
    // them is hue and nothing else. That is not a bug that can be tuned away:
    // every colour that clears 4.5:1 on white sits in the same narrow band of
    // darkness, so any AA-passing selected/unselected pair collides tonally.
    //
    // Selection therefore has to be carried by something a greyscale or
    // colour-blind reader can still see — the filled pill behind the selected
    // glyph in `ApproxTabBar`, the filled wedge in `Speedometer`, the platform's
    // own indicator in the native bar, and the heavier label weight. This is
    // the ratio that makes that fill visible against the bar it sits on.
    expect(contrast(palette.navActive, palette.navBg)).toBeGreaterThanOrEqual(3);
  });

  it('keeps every nav token opaque', () => {
    // The wheel stacks SVG paths straight onto the arc's own background, so an
    // `#RRGGBBAA` or `rgba()` value here is a grey wash over the whole dial
    // rather than a fill — which is what `navWedge` exists to have replaced.
    for (const token of ['navBg', 'navActive', 'navOnActive', 'navInactive', 'navWedge'] as const) {
      expect(palette[token]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('light theme, specifically', () => {
  it('selects in orange', () => {
    // Hue in the orange band, and saturated — a check that this is still the
    // orange the design asks for and not a grey that happens to pass the
    // ratios above, which is what it was before.
    const [r, g, b] = [1, 3, 5].map((i) =>
      parseInt(lightColors.navActive.slice(i, i + 2), 16),
    );
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r - b).toBeGreaterThan(100);
  });

  it('leaves the unselected items grey', () => {
    const [r, g, b] = [1, 3, 5].map((i) =>
      parseInt(lightColors.navInactive.slice(i, i + 2), 16),
    );
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(12);
  });

  it('gives the wheel a white dial', () => {
    expect(lightColors.navWedge).toBe('#FFFFFF');
    expect(lightColors.navWedge).toBe(lightColors.navBg);
  });
});
