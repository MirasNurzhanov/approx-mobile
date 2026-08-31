// Generates every variant of the Approx app icon, in both themes.
//
//   node scripts/generate-app-icons.js
//
// The mark is a pointy-top hexagon outline with a filled dot at its centre —
// the same "a person, and the area around them" idea the map draws, at icon
// scale. Two themes, and the colours are lifted straight from constants/theme.ts
// rather than re-picked here, so the icon on the home screen is the same orange
// or the same teal as the accent inside the app. If the palette moves, re-run
// this and the icons move with it.
//
// Geometry is expressed as fractions of the canvas so every output — 1024px
// store icon, Android foreground, splash — is the identical drawing at a
// different size, rather than a bitmap someone scaled.

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;

// ── Themes ────────────────────────────────────────────────────────────────────
// Kept in step with `colors` / `lightColors` in constants/theme.ts. `mark` is
// that palette's primary accent (teal in dark, coral in light); `bg` is its
// canvas colour.
const THEMES = {
  light: { bg: '#FAF9F5', mark: '#E8714A' },
  dark: { bg: '#0A0A0B', mark: '#1FC7B6' },
};

// ── The mark ──────────────────────────────────────────────────────────────────
// Fractions of the canvas. `RADIUS` is the hexagon's circumradius measured to
// the *centre* of the stroke, so the outer edge sits at RADIUS + STROKE / 2.
const RADIUS = 0.383;
const STROKE = 0.073;
const DOT = 0.108;

/** Full extent of the mark, as a fraction of the canvas — used to scale it
 *  down into Android's adaptive-icon safe zone. */
const EXTENT = 2 * (RADIUS + STROKE / 2);

function hexagonPoints(cx, cy, r) {
  // Pointy-top: a vertex at 12 and 6 o'clock, flat sides left and right.
  return [90, 150, 210, 270, 330, 30]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy - r * Math.sin(a)).toFixed(2)}`;
    })
    .join(' ');
}

/**
 * @param {object}  options
 * @param {string}  options.mark        Colour of the hexagon and the dot.
 * @param {?string} options.bg          Canvas fill, or null for transparency.
 * @param {number}  options.scale       Shrinks the mark within the canvas.
 */
function buildSvg({ mark, bg, scale = 1 }) {
  const c = SIZE / 2;
  const r = RADIUS * SIZE * scale;
  const stroke = STROKE * SIZE * scale;
  const dot = DOT * SIZE * scale;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"
     xmlns="http://www.w3.org/2000/svg">
  ${bg ? `<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>` : ''}
  <polygon points="${hexagonPoints(c, c, r)}"
           fill="none" stroke="${mark}" stroke-width="${stroke.toFixed(2)}"
           stroke-linejoin="miter"/>
  <circle cx="${c}" cy="${c}" r="${dot.toFixed(2)}" fill="${mark}"/>
</svg>`;
}

// ── Outputs ───────────────────────────────────────────────────────────────────
// Android masks an adaptive foreground to roughly the middle 72/108 of the
// canvas and animates it beyond that, so the mark has to sit well inside. 0.62
// of the canvas keeps every corner of the hexagon clear of the mask on a circle,
// a squircle and a rounded square alike.
const ADAPTIVE_SCALE = 0.62 / EXTENT;

async function write(file, svg, size = SIZE) {
  const out = path.join(__dirname, '..', 'assets', 'images', file);
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);
  console.log(`  ✓ assets/images/${file}`);
}

async function main() {
  const dir = path.join(__dirname, '..', 'assets', 'images');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  for (const [name, theme] of Object.entries(THEMES)) {
    console.log(`${name}:`);

    // Store / home-screen icon. Opaque and full-bleed: iOS rejects
    // transparency and rounds the corners itself.
    await write(`icon-${name}.png`, buildSvg({ mark: theme.mark, bg: theme.bg }));

    // Android adaptive foreground — transparent, mark inside the safe zone.
    // The matching background is a flat colour set in app.json.
    await write(
      `adaptive-icon-${name}.png`,
      buildSvg({ mark: theme.mark, bg: null, scale: ADAPTIVE_SCALE }),
    );

    // Android legacy / alternate-icon square. The dynamic-icon plugin wants one
    // flat image per icon, not adaptive layers, so this one keeps its
    // background.
    await write(
      `icon-android-${name}.png`,
      buildSvg({ mark: theme.mark, bg: theme.bg }),
    );

    await write(
      `splash-icon-${name}.png`,
      buildSvg({ mark: theme.mark, bg: null, scale: ADAPTIVE_SCALE }),
      512,
    );
  }

  // Android 13+ themed icons: one silhouette, tinted by the launcher from the
  // user's wallpaper. Drawn white on transparent — the system decides the
  // colour, and anything else here would be ignored or muddied.
  console.log('themed:');
  await write(
    'adaptive-icon-monochrome.png',
    buildSvg({ mark: '#FFFFFF', bg: null, scale: ADAPTIVE_SCALE }),
  );

  // Web favicon. Light only: a browser tab is not something the app's own
  // theme setting reaches.
  await write(
    'favicon.png',
    buildSvg({ mark: THEMES.light.mark, bg: THEMES.light.bg }),
    48,
  );

  console.log('\nDone. Re-run after changing the palette in constants/theme.ts.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
