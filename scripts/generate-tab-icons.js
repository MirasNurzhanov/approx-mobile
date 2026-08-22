// Rasterises the app's own icon glyphs for the native tab bar.
//
//   node scripts/generate-tab-icons.js
//
// The native tab bar takes an image, not a component: expo-router's `Icon`
// accepts an SF Symbol, an Android drawable, or an image source, and rejects
// any React element that is not its own `VectorIcon` helper. Four of the five
// tabs come from @expo/vector-icons through that helper; the Swifts glyph is
// the app's own drawing and has no vector-icon equivalent, so it is baked here.
//
// The path data is copied from `IconSwift` in components/ui/icons.tsx. If that
// drawing changes, re-run this.
//
// White on transparent, deliberately: expo-router hands an image source to
// react-native-screens as a `templateSource`, so iOS re-renders it with
// `UIImageRenderingModeAlwaysTemplate` and tints it with the tab bar's icon
// colour. The white never reaches the screen — it is a mask. This is the same
// convention `VectorIcon` follows, which bakes its glyphs at 'white' too.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'images');

/** Point size of a tab bar icon. @2x and @3x are derived from it. */
const PT = 28;

// The swift, from components/ui/icons.tsx — scythe wings swept hard back, and
// the forked tail the bird is named for.
const SWIFT_PATHS = [
  'M11.3 9.8C8.2 10.1 5.1 12.1 2.2 16c4-1.6 7-2.6 9.3-3Z',
  'M12.7 9.8c3.1.3 6.2 2.3 9.1 6.2-4-1.6-7-2.6-9.3-3Z',
  'M12 8.6c.95 0 1.6.8 1.48 1.75l-.88 6.9-.6-1.15-.6 1.15-.88-6.9C10.4 9.4 11.05 8.6 12 8.6Z',
];

/**
 * A square viewBox centred on the glyph rather than the original 24x24 canvas.
 *
 * The swift is wide and shallow — it spans x 2.2→21.8 but only y 8.6→17.6 — so
 * drawn in the source canvas it sits as a thin band through the middle and
 * reads far smaller than the Ionicons beside it. (components/Speedometer.tsx
 * compensates with a 1.3 `glyphScale` for the same reason.) Framing it square
 * on its own centre lets it fill the tab item the way the others do.
 */
const GLYPH = { minX: 2.2, minY: 8.6, maxX: 21.8, maxY: 17.6 };
const cx = (GLYPH.minX + GLYPH.maxX) / 2;
const cy = (GLYPH.minY + GLYPH.maxY) / 2;
const half = Math.max(GLYPH.maxX - GLYPH.minX, GLYPH.maxY - GLYPH.minY) / 2;
const viewBox = `${cx - half} ${cy - half} ${half * 2} ${half * 2}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`
  + SWIFT_PATHS.map((d) => `<path d="${d}" fill="#FFFFFF"/>`).join('')
  + '</svg>';

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // React Native resolves `name.png` / `name@2x.png` / `name@3x.png` off the
  // device's scale, so all three ship and only one is decoded.
  for (const [suffix, scale] of [['', 1], ['@2x', 2], ['@3x', 3]]) {
    const size = PT * scale;
    const file = path.join(OUT_DIR, `tab-swift${suffix}.png`);
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);
    console.log(`  ${path.relative(process.cwd(), file)}  ${size}x${size}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
