#!/usr/bin/env node
// Compare fresh gallery captures against committed gallery baselines (issue #15).
//
// This is the gallery counterpart of scripts/visual-compare.mjs. It compares the
// two full-page gallery screenshots (desktop landscape + mobile portrait) against
// visual/baselines/gallery/, INDEPENDENTLY of the 120 effect baselines — a gallery
// presentation regression (broken aspect, horizontal overflow, hover transform on
// a coarse-pointer screenshot, CRT overlay crushing contrast) fails here without
// touching effect-only baselines.
//
// Tolerance: gallery screenshots are full-page decorated PNGs (CRT scanlines,
// gradients, AA text, canvas imagery), so they are inherently vector/AA-heavy.
// We reuse the documented vector ceiling (VECTOR_MAX_DIFF_PIXEL_RATIO, 0.15) from
// visual/pin.mjs. A genuine presentation regression diffs well above 30%; the
// 0.15 ceiling absorbs bounded rasterisation drift while still failing on real
// changes. There is no foreground floor: the gallery page is mostly background by
// design, so the runner's >=1000-byte blank guard is the semantic-blank check.
//
// Usage: node scripts/gallery-compare.mjs [--captures <dir>] [--baselines <dir>]
//   Defaults: visual/captures/gallery vs visual/baselines/gallery.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VECTOR_MAX_DIFF_PIXEL_RATIO } from '../visual/pin.mjs';
import { comparePngBuffers, buildDiffImage, readPng } from '../visual/compare.mjs';
import { encodePng } from '../visual/png.mjs';
import { GALLERY_FILENAMES } from '../visual/gallery.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  captures: 'visual/captures/gallery',
  baselines: 'visual/baselines/gallery',
  diffs: 'visual/diffs/gallery'
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--captures') args.captures = argv[++i];
    else if (argv[i] === '--baselines') args.baselines = argv[++i];
    else if (argv[i] === '--diffs') args.diffs = argv[++i];
  }
  return args;
}

function listPngs(dir) {
  return readdir(dir).then((files) => files.filter((f) => f.endsWith('.png')).sort());
}

async function main() {
  const args = parseArgs(process.argv);
  const capturesDir = join(root, args.captures);
  const baselinesDir = join(root, args.baselines);
  const diffsDir = join(root, args.diffs);
  await rm(diffsDir, { recursive: true, force: true });
  await mkdir(diffsDir, { recursive: true });

  const expected = new Set(GALLERY_FILENAMES);

  const [captureFiles, baselineFiles] = await Promise.all([listPngs(capturesDir), listPngs(baselinesDir)]);
  const captureSet = new Set(captureFiles);
  const baselineSet = new Set(baselineFiles);

  const errors = [];

  // 1. Matrix completeness: both gallery captures must be present on both sides.
  for (const f of expected) {
    if (!captureSet.has(f)) errors.push(`missing capture: ${f}`);
    if (!baselineSet.has(f)) errors.push(`missing expected baseline: ${f}`);
  }
  // 2. No stale / unexpected captures outside the declared gallery set.
  for (const f of captureFiles) if (!expected.has(f)) errors.push(`unexpected stale capture: ${f}`);
  for (const f of baselineFiles) if (!expected.has(f)) errors.push(`unexpected stale baseline: ${f}`);

  // 3. Pixel comparison for each expected baseline present on both sides.
  const comparison = [];
  for (const filename of [...expected].sort()) {
    if (!captureSet.has(filename) || !baselineSet.has(filename)) continue;
    const actual = readPng(join(capturesDir, filename));
    const expectedPng = readPng(join(baselinesDir, filename));
    const result = comparePngBuffers(actual, expectedPng, {
      maxDiffPixelRatio: VECTOR_MAX_DIFF_PIXEL_RATIO,
      minForegroundRatio: 0
    });
    comparison.push({ filename, ...result });
    if (!result.match) {
      const diff = buildDiffImage(actual, expectedPng);
      await writeFile(join(diffsDir, filename), encodeDiff(diff));
    }
  }

  for (const c of comparison.filter((c) => !c.match)) {
    if (c.dimensionMismatch) {
      errors.push(`dimension mismatch in ${c.filename}: actual ${c.actual.width}x${c.actual.height} vs expected ${c.expected.width}x${c.expected.height}`);
    } else {
      errors.push(
        `${c.filename}: diff ${c.diffPixels}/${c.totalPixels} pixels `
        + `(${(c.diffPixelRatio * 100).toFixed(3)}% > ${(VECTOR_MAX_DIFF_PIXEL_RATIO * 100).toFixed(3)}% tolerance)`
      );
    }
  }

  if (errors.length) {
    console.error(`gallery-compare: ${errors.length} failure(s).`);
    for (const e of errors) console.error(`  ✖ ${e}`);
    if (comparison.some((c) => !c.match)) console.error(`\nDiff images written to ${args.diffs}/. Review them, then run: npm run gallery:update`);
    process.exit(1);
  }

  console.log(`gallery-compare: all ${comparison.length} captures match their baselines (within ${VECTOR_MAX_DIFF_PIXEL_RATIO * 100}% tolerance).`);
}

// compare.mjs's buildDiffImage returns a raw { width, height, rgba }; gallery-compare
// needs a PNG. Reuse the project's dependency-free encoder.
function encodeDiff(diff) {
  return encodePng(diff);
}

main().catch((error) => {
  console.error(`gallery-compare: ${error.message}`);
  process.exit(1);
});
