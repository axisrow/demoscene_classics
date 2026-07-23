#!/usr/bin/env node
// Compare fresh captures against committed baselines.
//
// Fails on: missing expected baseline, unexpected stale baseline, duplicate
// case ids, an incomplete matrix (not exactly EXPECTED_CAPTURE_COUNT files),
// or any capture whose diff pixel ratio exceeds its documented tolerance. Writes
// a red-on-grey diff PNG for each failing case into visual/diffs/.
//
// Usage: node scripts/visual-compare.mjs [--captures <dir>] [--baselines <dir>]
//   Defaults: visual/captures vs visual/baselines.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMatrix, EXPECTED_CAPTURE_COUNT, parseCaptureFilename } from '../visual/matrix.mjs';
import { VISUAL_DIRS, toleranceFor } from '../visual/pin.mjs';
import { comparePngBuffers, buildDiffImage, readPng } from '../visual/compare.mjs';
import { encodePng } from '../visual/png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { captures: VISUAL_DIRS.captures, baselines: VISUAL_DIRS.baselines };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--captures') args.captures = argv[++i];
    else if (argv[i] === '--baselines') args.baselines = argv[++i];
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
  const diffsDir = join(root, VISUAL_DIRS.diffs);
  await rm(diffsDir, { recursive: true, force: true });
  await mkdir(diffsDir, { recursive: true });

  const expectedFilenames = new Set(buildMatrix().captures.map((c) => c.filename));

  const [captureFiles, baselineFiles] = await Promise.all([listPngs(capturesDir), listPngs(baselinesDir)]);
  const captureSet = new Set(captureFiles);
  const baselineSet = new Set(baselineFiles);

  const errors = [];

  // 1. Duplicate / unparseable case ids in either set.
  for (const [label, files] of [['capture', captureFiles], ['baseline', baselineFiles]]) {
    const seen = new Set();
    for (const file of files) {
      const parsed = parseCaptureFilename(file);
      if (!parsed) {
        errors.push(`${label} file does not match the capture naming scheme: ${file}`);
        continue;
      }
      const id = `${parsed.effectName}__${parsed.profileId}__${parsed.timestampSeconds}`;
      if (seen.has(id)) errors.push(`duplicate ${label} case id: ${file}`);
      seen.add(id);
    }
  }

  // 2. Matrix completeness: every expected filename must be present in both dirs.
  const missingCaptures = [...expectedFilenames].filter((f) => !captureSet.has(f));
  const missingBaselines = [...expectedFilenames].filter((f) => !baselineSet.has(f));
  for (const f of missingCaptures) errors.push(`missing capture: ${f}`);
  for (const f of missingBaselines) errors.push(`missing expected baseline: ${f}`);

  // 3. Unexpected stale captures/baselines not in the matrix.
  const staleCaptures = captureFiles.filter((f) => !expectedFilenames.has(f));
  const staleBaselines = baselineFiles.filter((f) => !expectedFilenames.has(f));
  for (const f of staleCaptures) errors.push(`unexpected stale capture: ${f}`);
  for (const f of staleBaselines) errors.push(`unexpected stale baseline: ${f}`);

  if (baselineFiles.length !== EXPECTED_CAPTURE_COUNT) {
    errors.push(`baseline matrix is incomplete: expected ${EXPECTED_CAPTURE_COUNT}, found ${baselineFiles.length}.`);
  }

  // 4. Pixel comparison for every expected baseline that exists on both sides.
  const comparison = [];
  for (const filename of [...expectedFilenames].sort()) {
    if (!captureSet.has(filename) || !baselineSet.has(filename)) continue;
    const parsed = parseCaptureFilename(filename);
    const actual = readPng(join(capturesDir, filename));
    const expected = readPng(join(baselinesDir, filename));
    const tolerance = toleranceFor(parsed.effectName);
    const result = comparePngBuffers(actual, expected, { maxDiffPixelRatio: tolerance });
    comparison.push({ filename, tolerance, ...result });
    if (!result.match) {
      const diff = buildDiffImage(actual, expected);
      await writeFile(join(diffsDir, filename), encodePng(diff));
    }
  }

  const failed = comparison.filter((c) => !c.match);
  for (const c of failed) {
    if (c.dimensionMismatch) {
      errors.push(`dimension mismatch in ${c.filename}: actual ${c.actual.width}x${c.actual.height} vs expected ${c.expected.width}x${c.expected.height}`);
    } else {
      errors.push(
        `${c.filename}: diff ${c.diffPixels}/${c.totalPixels} pixels `
        + `(${(c.diffPixelRatio * 100).toFixed(3)}% > ${(c.tolerance * 100).toFixed(3)}% tolerance)`
      );
    }
  }

  if (errors.length) {
    console.error(`visual-compare: ${errors.length} failure(s).`);
    for (const e of errors) console.error(`  ✖ ${e}`);
    if (failed.length) console.error(`\nDiff images written to ${VISUAL_DIRS.diffs}/. Review them, then run: npm run visual:update`);
    process.exit(1);
  }

  console.log(`visual-compare: all ${comparison.length} captures match their baselines (within tolerance).`);
}

main().catch((error) => {
  console.error(`visual-compare: ${error.message}`);
  process.exit(1);
});
