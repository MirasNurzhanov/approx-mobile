// Generates assets/images/icon.png and assets/images/adaptive-icon.png
// Run: node scripts/generate-icon.js

const sharp = require('sharp');
const path  = require('path');

const SIZE = 1024;
const CX   = SIZE / 2;
const CY   = SIZE / 2;

const TEAL   = '#00b4a6';
const BG     = '#0a0a0a';
const WHITE  = '#ffffff';

// ─── SVG definitions ──────────────────────────────────────────────────────────
function buildSvg({ background }) {
  const bgRect = background
    ? `<rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- White core glow -->
    <filter id="coreGlow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="22" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <!-- Teal ring glow -->
    <filter id="ringGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <!-- Soft teal halo -->
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="${TEAL}" stop-opacity="0.18"/>
      <stop offset="60%"  stop-color="${TEAL}" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="${TEAL}" stop-opacity="0"/>
    </radialGradient>
    <!-- White core radial -->
    <radialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="${WHITE}" stop-opacity="1"/>
      <stop offset="55%"  stop-color="${WHITE}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="${WHITE}" stop-opacity="0.7"/>
    </radialGradient>
  </defs>

  ${bgRect}

  <!-- ── Proximity rings (outermost → innermost) ── -->
  <!-- Ring 3 — faintest, widest -->
  <circle cx="${CX}" cy="${CY}" r="410"
    fill="none" stroke="${TEAL}" stroke-width="1.8" opacity="0.12"
    filter="url(#ringGlow)"/>

  <!-- Ring 2 -->
  <circle cx="${CX}" cy="${CY}" r="295"
    fill="none" stroke="${TEAL}" stroke-width="2.5" opacity="0.28"
    filter="url(#ringGlow)"/>

  <!-- Ring 1 — brightest, thickest -->
  <circle cx="${CX}" cy="${CY}" r="172"
    fill="none" stroke="${TEAL}" stroke-width="4.5" opacity="0.72"
    filter="url(#ringGlow)"/>

  <!-- ── Teal halo fill ── -->
  <circle cx="${CX}" cy="${CY}" r="172" fill="url(#halo)"/>

  <!-- ── Outer white glow (large soft bloom) ── -->
  <circle cx="${CX}" cy="${CY}" r="68"
    fill="${WHITE}" opacity="0.08" filter="url(#coreGlow)"/>

  <!-- ── Core dot ── -->
  <circle cx="${CX}" cy="${CY}" r="38"
    fill="url(#coreGrad)" filter="url(#coreGlow)"/>

  <!-- ── Crisp white center ── -->
  <circle cx="${CX}" cy="${CY}" r="26" fill="${WHITE}"/>
</svg>`;
}

// ─── Runner ───────────────────────────────────────────────────────────────────
async function main() {
  const imagesDir = path.join(__dirname, '..', 'assets', 'images');

  // icon.png — full icon with dark background
  await sharp(Buffer.from(buildSvg({ background: true })))
    .png()
    .toFile(path.join(imagesDir, 'icon.png'));
  console.log('✓  assets/images/icon.png');

  // adaptive-icon.png — transparent background (Android adaptive foreground)
  await sharp(Buffer.from(buildSvg({ background: false })))
    .png()
    .toFile(path.join(imagesDir, 'adaptive-icon.png'));
  console.log('✓  assets/images/adaptive-icon.png');

  // android-icon-foreground.png — same transparent version
  await sharp(Buffer.from(buildSvg({ background: false })))
    .png()
    .toFile(path.join(imagesDir, 'android-icon-foreground.png'));
  console.log('✓  assets/images/android-icon-foreground.png');

  // splash-icon.png — icon on dark bg, used by expo-splash-screen
  await sharp(Buffer.from(buildSvg({ background: true })))
    .resize(512, 512)
    .png()
    .toFile(path.join(imagesDir, 'splash-icon.png'));
  console.log('✓  assets/images/splash-icon.png');

  console.log('\nAll icons generated.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
