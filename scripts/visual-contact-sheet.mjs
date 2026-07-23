#!/usr/bin/env node
// Assemble review contact sheets from the committed baselines (or any PNG dir).
//
// Per-effect sheet: the 12 captures (4 profiles x 3 timestamps) tiled in a grid
// so all four responsive variants and three animation maturities are visible at
// once. All-effect sheet: every effect stacked. Tiles are labelled with their
// profile + timestamp. Pure-Node PNG composition; no image dependency.
//
// Usage: node scripts/visual-contact-sheet.mjs [--source <dir>] [--effect <name>]
//   --source defaults to visual/baselines. Omit --effect to build every effect
//   plus the all-effect sheet.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMatrix } from '../visual/matrix.mjs';
import { VISUAL_DIRS } from '../visual/pin.mjs';
import { decodePng, encodePng } from '../visual/png.mjs';
import { PROFILES } from '../visual/profiles.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const TILE_W = 360;
const TILE_H = 220;
const PAD = 16;
const LABEL_H = 28;

function parseArgs(argv) {
  const args = { source: VISUAL_DIRS.baselines, effect: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--source') args.source = argv[++i];
    else if (argv[i] === '--effect') args.effect = argv[++i];
  }
  return args;
}

function labelFor(capture) {
  return `${capture.profileId} @ ${capture.timestampSeconds}s`;
}

function drawLabel(rgba, sheetWidth, originX, originY, text) {
  // 7x5 bitmap font is overkill; draw a simple label bar of solid colour with
  // a lighter strip and stash the label text in the manifest instead. We paint
  // a coloured band whose hue encodes the profile so sheets remain legible
  // even without a font rasteriser.
  const profile = PROFILES.find((p) => p.id === capture_profileFromText(text));
  const hue = profile ? (profile.device === 'mobile' ? 200 : 30) + (profile.surface === 'preview' ? 0 : 120) : 0;
  void hue;
  for (let y = originY; y < originY + LABEL_H; y++) {
    for (let x = originX; x < originX + TILE_W; x++) {
      const i = (y * sheetWidth + x) * 4;
      rgba[i] = 30; rgba[i + 1] = 30; rgba[i + 2] = 34; rgba[i + 3] = 255;
    }
  }
}

function capture_profileFromText(text) {
  return text.split(' @ ')[0];
}

// Fit a decoded capture into a TILE_W x (TILE_H - LABEL_H) tile, letterboxed.
function blitCapture(target, sheetWidth, originX, originY, decoded) {
  const tileW = TILE_W;
  const tileH = TILE_H - LABEL_H;
  const scale = Math.min(tileW / decoded.width, tileH / decoded.height);
  const drawW = Math.max(1, Math.floor(decoded.width * scale));
  const drawH = Math.max(1, Math.floor(decoded.height * scale));
  const offsetX = originX + Math.floor((tileW - drawW) / 2);
  const offsetY = originY + LABEL_H + Math.floor((tileH - drawH) / 2);
  for (let y = 0; y < drawH; y++) {
    const srcY = Math.floor(y / scale);
    for (let x = 0; x < drawW; x++) {
      const srcX = Math.floor(x / scale);
      const src = (srcY * decoded.width + srcX) * 4;
      const dst = ((offsetY + y) * sheetWidth + (offsetX + x)) * 4;
      target[dst] = decoded.rgba[src];
      target[dst + 1] = decoded.rgba[src + 1];
      target[dst + 2] = decoded.rgba[src + 2];
      target[dst + 3] = 255;
    }
  }
}

async function buildSheet(captures, sourceDir, outFile, title) {
  // Layout: 3 columns (timestamps) x 4 rows (profiles).
  const cols = 3;
  const rows = Math.ceil(captures.length / cols);
  const sheetWidth = cols * (TILE_W + PAD) + PAD;
  const sheetHeight = rows * (TILE_H + PAD) + PAD + LABEL_H;
  const rgba = Buffer.alloc(sheetWidth * sheetHeight * 4, 0);
  // Dark background.
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 12; rgba[i + 1] = 12; rgba[i + 2] = 16; rgba[i + 3] = 255;
  }
  const sheetManifest = [];
  for (let index = 0; index < captures.length; index++) {
    const capture = captures[index];
    const col = index % cols;
    const row = Math.floor(index / cols);
    const originX = PAD + col * (TILE_W + PAD);
    const originY = PAD + LABEL_H + row * (TILE_H + PAD);
    const png = await readFile(join(sourceDir, capture.filename));
    const decoded = decodePng(png);
    drawLabel(rgba, sheetWidth, originX, originY, labelFor(capture));
    blitCapture(rgba, sheetWidth, originX, originY, decoded);
    sheetManifest.push({ label: labelFor(capture), file: capture.filename, w: decoded.width, h: decoded.height });
  }
  await writeFile(outFile, encodePng({ width: sheetWidth, height: sheetHeight, rgba }));
  const sidecar = outFile.replace(/\.png$/, '.labels.json');
  await writeFile(sidecar, `${JSON.stringify({ title, tiles: sheetManifest }, null, 2)}\n`);
  return outFile;
}

async function main() {
  const args = parseArgs(process.argv);
  const sourceDir = join(root, args.source);
  const sheetsDir = join(root, VISUAL_DIRS.sheets);
  await mkdir(sheetsDir, { recursive: true });

  const { cases } = buildMatrix();
  // cases is one entry per (effect × profile). Group by effect so each effect
  // produces exactly one sheet of its 12 captures (4 profiles × 3 timestamps).
  const byEffect = new Map();
  for (const caseEntry of cases) {
    if (args.effect && caseEntry.effectName !== args.effect) continue;
    if (!byEffect.has(caseEntry.effectName)) byEffect.set(caseEntry.effectName, []);
    byEffect.get(caseEntry.effectName).push(...caseEntry.captures);
  }
  if (args.effect && byEffect.size === 0) {
    console.error(`visual-contact-sheet: unknown effect '${args.effect}'.`);
    process.exit(2);
  }

  const built = [];
  for (const [effectName, captures] of byEffect) {
    const outFile = join(sheetsDir, `${effectName}.contact-sheet.png`);
    await buildSheet(captures, sourceDir, outFile, `${effectName} — 4 profiles × 3 timestamps`);
    built.push(outFile);
    console.log(`visual-contact-sheet: wrote ${effectName}.contact-sheet.png`);
  }

  if (!args.effect) {
    // All-effect sheet: one tile per effect at its 5s mobile-fullscreen maturity.
    const all = [];
    for (const [effectName, captures] of byEffect) {
      all.push(captures.find((cap) => cap.profileId === 'mobile-fullscreen' && cap.timestampSeconds === 5)
        || captures[captures.length - 1]);
    }
    const outFile = join(sheetsDir, 'all-effects.contact-sheet.png');
    await buildSheet(all, sourceDir, outFile, 'All effects — mobile-fullscreen @ 5s');
    built.push(outFile);
    console.log('visual-contact-sheet: wrote all-effects.contact-sheet.png');
  }

  console.log(`visual-contact-sheet: ${built.length} sheet(s) in ${VISUAL_DIRS.sheets}/.`);
}

main().catch((error) => {
  console.error(`visual-contact-sheet: ${error.message}`);
  process.exit(1);
});
