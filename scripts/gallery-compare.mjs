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
// Output directories are HARDCODED (visual/captures/gallery,
// visual/baselines/gallery, visual/diffs/gallery). There is no --diffs /
// --captures / --baselines override: the only destructive step is `rm -rf
// visual/diffs/gallery`, and a caller-supplied path there could delete the
// checkout or a sibling worktree (e.g. `--diffs ..`). Hardcoding removes that
// vector entirely; the npm scripts never override these paths anyway.
//
// Full-page gallery screenshots are not byte-stable across OSes (the host font
// backend shifts line-wrap and thus page HEIGHT), so comparison uses the bounded
// dimension-tolerant comparator in visual/gallery.mjs (small height delta clamps
// to the common area + pixel ratio; width and large deltas still fail). The
// pixel ceiling is GALLERY_MAX_DIFF_PIXEL_RATIO (0.60): gallery pages render
// system text everywhere, whose cross-OS rasterisation drift (~48% desktop,
// ~19% mobile, measured macOS vs Linux on the same pinned chromium) far exceeds
// the effect harness's 0.15 vector ceiling. Structural regressions (a missing
// card, broken aspect, overflow) are caught by the dimension gate + the Node
// presentation test suite; this ceiling is the cross-OS rasterisation guard.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDiffImage, readPng } from '../visual/compare.mjs';
import { encodePng } from '../visual/png.mjs';
import {
  GALLERY_FILENAMES,
  GALLERY_DIMENSION_TOLERANCE_FRACTION,
  GALLERY_DIMENSION_TOLERANCE_FLOOR_PX,
  GALLERY_MAX_DIFF_PIXEL_RATIO,
  compareGallery
} from '../visual/gallery.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');

const CAPTURES_DIR = join(root, 'visual/captures/gallery');
const BASELINES_DIR = join(root, 'visual/baselines/gallery');
const DIFFS_DIR = join(root, 'visual/diffs/gallery');

function listPngs(dir) {
  return readdir(dir).then((files) => files.filter((f) => f.endsWith('.png')).sort());
}

async function main() {
  await rm(DIFFS_DIR, { recursive: true, force: true });
  await mkdir(DIFFS_DIR, { recursive: true });

  const expected = new Set(GALLERY_FILENAMES);

  const [captureFiles, baselineFiles] = await Promise.all([listPngs(CAPTURES_DIR), listPngs(BASELINES_DIR)]);
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

  // 3. Bounded-dimension + pixel comparison for each expected baseline on both sides.
  const comparison = [];
  for (const filename of [...expected].sort()) {
    if (!captureSet.has(filename) || !baselineSet.has(filename)) continue;
    const actual = readPng(join(CAPTURES_DIR, filename));
    const expectedPng = readPng(join(BASELINES_DIR, filename));
    const result = compareGallery(actual, expectedPng, { maxDiffPixelRatio: GALLERY_MAX_DIFF_PIXEL_RATIO });
    comparison.push({ filename, ...result });
    if (!result.match) {
      await writeFile(join(DIFFS_DIR, filename), encodePng(buildDiffImage(actual, expectedPng)));
    }
  }

  for (const c of comparison.filter((c) => !c.match)) {
    if (c.reason === 'width-mismatch') {
      errors.push(`width mismatch in ${c.filename}: actual ${c.actual.width}px vs expected ${c.expected.width}px (a viewport change is always a regression)`);
    } else if (c.reason === 'height-delta') {
      const tol = Math.max(GALLERY_DIMENSION_TOLERANCE_FRACTION * c.expected.height, GALLERY_DIMENSION_TOLERANCE_FLOOR_PX).toFixed(0);
      errors.push(`height delta in ${c.filename}: actual ${c.actual.height}px vs expected ${c.expected.height}px (Δ${c.heightDelta}px > ${tol}px tolerance — real layout regression)`);
    } else {
      errors.push(
        `${c.filename}: diff ${c.diffPixels}/${c.totalPixels} pixels `
        + `(${(c.diffPixelRatio * 100).toFixed(3)}% > ${(GALLERY_MAX_DIFF_PIXEL_RATIO * 100).toFixed(3)}% tolerance`
        + (c.comparedHeight && c.comparedHeight < c.actual.height ? `, compared common ${c.comparedHeight}px height` : '')
        + ')'
      );
    }
  }

  if (errors.length) {
    console.error(`gallery-compare: ${errors.length} failure(s).`);
    for (const e of errors) console.error(`  ✖ ${e}`);
    if (comparison.some((c) => !c.match)) console.error(`\nDiff images written to visual/diffs/gallery/. Review them, then run: npm run gallery:update`);
    process.exit(1);
  }

  console.log(`gallery-compare: all ${comparison.length} captures match their baselines (within ${GALLERY_MAX_DIFF_PIXEL_RATIO * 100}% tolerance, height-delta tolerant).`);
}

main().catch((error) => {
  console.error(`gallery-compare: ${error.message}`);
  process.exit(1);
});
