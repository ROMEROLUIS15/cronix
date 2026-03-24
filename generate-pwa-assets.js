#!/usr/bin/env node
/**
 * Generates PWA icon with layered structure:
 * - Outer background: #0066FF (blue)
 * - Inner rounded square: #0F0F12 (dark/black)
 * - Logo: centered inside inner square
 */

const sharp = require('sharp');
const path  = require('path');

const BLUE     = { r: 0,   g: 102, b: 255, alpha: 1 };
const DARK     = { r: 15,  g: 15,  b: 18,  alpha: 1 };
const PUBLIC   = path.join(__dirname, 'public');
const LOGO_SRC = path.join(PUBLIC, 'cronix-logo.jpg');

/**
 * Builds an SVG with:
 *  - Blue full background
 *  - Dark rounded rect centered (70% of size)
 *  - Transparent hole in center for the logo composite
 */
function buildOverlaySVG(size) {
  const innerSize   = Math.round(size * 0.70);
  const innerOffset = Math.round((size - innerSize) / 2);
  const radius      = Math.round(innerSize * 0.22);

  return Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <!-- Blue outer background -->
      <rect width="${size}" height="${size}" fill="#0066FF"/>
      <!-- Dark inner rounded square -->
      <rect
        x="${innerOffset}" y="${innerOffset}"
        width="${innerSize}" height="${innerSize}"
        rx="${radius}" ry="${radius}"
        fill="#0F0F12"
      />
    </svg>
  `);
}

async function buildIcon(size, outFile) {
  const logoSize    = Math.round(size * 0.42);  // logo takes 42% of total size
  const logoOffset  = Math.round((size - logoSize) / 2);

  // 1. Resize logo
  const logoBuffer = await sharp(LOGO_SRC)
    .resize(logoSize, logoSize, { fit: 'cover' })
    .png()
    .toBuffer();

  // 2. Compose: SVG overlay (blue bg + dark square) + logo centered
  await sharp(buildOverlaySVG(size))
    .composite([
      {
        input: logoBuffer,
        top:   logoOffset,
        left:  logoOffset,
      },
    ])
    .png()
    .toFile(outFile);

  console.log(`✓ ${path.basename(outFile)} (${size}x${size})`);
}

async function buildSplash(width, height, outFile) {
  // Splash: blue background, dark rounded square centered, logo inside
  const innerSize   = Math.round(Math.min(width, height) * 0.38);
  const innerX      = Math.round((width  - innerSize) / 2);
  const innerY      = Math.round((height - innerSize) / 2);
  const radius      = Math.round(innerSize * 0.22);
  const logoSize    = Math.round(innerSize * 0.60);
  const logoX       = Math.round((width  - logoSize) / 2);
  const logoY       = Math.round((height - logoSize) / 2);

  const svgBg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#0066FF"/>
      <rect
        x="${innerX}" y="${innerY}"
        width="${innerSize}" height="${innerSize}"
        rx="${radius}" ry="${radius}"
        fill="#0F0F12"
      />
    </svg>
  `);

  const logoBuffer = await sharp(LOGO_SRC)
    .resize(logoSize, logoSize, { fit: 'cover' })
    .png()
    .toBuffer();

  await sharp(svgBg)
    .composite([{ input: logoBuffer, top: logoY, left: logoX }])
    .png()
    .toFile(outFile);

  console.log(`✓ ${path.basename(outFile)} (${width}x${height})`);
}

async function main() {
  console.log('Generating PWA assets...\n');

  await buildIcon(192,  path.join(PUBLIC, 'icon-192x192.png'));
  await buildIcon(512,  path.join(PUBLIC, 'icon-512x512.png'));
  await buildSplash(540,  720,  path.join(PUBLIC, 'splash-540x720.png'));
  await buildSplash(1080, 1440, path.join(PUBLIC, 'splash-1080x1440.png'));

  console.log('\nDone. Deploy and reinstall the PWA to see changes.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
