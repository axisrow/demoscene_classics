import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePngBuffers, buildDiffImage, foregroundRatio } from '../visual/compare.mjs';
import { decodePng, encodePng } from '../visual/png.mjs';

// Self-contained pixel-comparison tests. These exercise the bounded-tolerance
// comparator used by the visual suite without launching a browser, so they run
// as plain unit tests. The end-to-end "two captures are byte-identical" /
// "a deliberate fixture change fails" guarantees are demonstrated by running
// `npm run test:visual` against the committed baselines (see visual/README.md).

function solidPng(width, height, [r, g, b]) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return encodePng({ width, height, rgba });
}

function gradientPng(width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = x % 256; rgba[i + 1] = y % 256; rgba[i + 2] = (x + y) % 256; rgba[i + 3] = 255;
    }
  }
  return encodePng({ width, height, rgba });
}

test('identical images match with zero tolerance', () => {
  const png = gradientPng(40, 30);
  const result = comparePngBuffers(png, png, { maxDiffPixelRatio: 0 });
  assert.equal(result.match, true);
  assert.equal(result.diffPixels, 0);
  assert.equal(result.diffPixelRatio, 0);
  assert.equal(result.dimensionMismatch, false);
});

test('a single changed pixel fails at zero tolerance but passes with a tiny tolerance', () => {
  const base = gradientPng(40, 30);
  const decoded = decodePng(base);
  decoded.rgba[0] = (decoded.rgba[0] + 40) % 256;
  const changed = encodePng({ width: decoded.width, height: decoded.height, rgba: decoded.rgba });

  const strict = comparePngBuffers(base, changed, { maxDiffPixelRatio: 0 });
  assert.equal(strict.match, false);
  assert.equal(strict.diffPixels, 1);
  assert.equal(strict.totalPixels, 40 * 30);
  assert.ok(strict.diffPixelRatio > 0);

  // 1 pixel out of 1200 = ~0.083%, under a 1% tolerance.
  const lenient = comparePngBuffers(base, changed, { maxDiffPixelRatio: 0.01 });
  assert.equal(lenient.match, true);
});

test('a deliberate visible change fails and reports the diff ratio', () => {
  // Mandelbrot-style "palette change": swap the blue channel of a gradient,
  // simulating the documented deliberate-fixture-change acceptance test.
  const before = gradientPng(60, 40);
  const decoded = decodePng(before);
  for (let i = 0; i < decoded.rgba.length; i += 4) {
    decoded.rgba[i + 2] = 255 - decoded.rgba[i + 2];
  }
  const after = encodePng({ width: decoded.width, height: decoded.height, rgba: decoded.rgba });

  const result = comparePngBuffers(before, after, { maxDiffPixelRatio: 0 });
  assert.equal(result.match, false);
  assert.equal(result.diffPixels, result.totalPixels);
  assert.equal(result.diffPixelRatio, 1);
  assert.match(`${result.diffPixels}/${result.totalPixels}`, /\d+\/\d+/);

  // The diff image must be producible and have the expected dimensions.
  const diff = buildDiffImage(before, after);
  assert.equal(diff.width, 60);
  assert.equal(diff.height, 40);
  assert.equal(diff.rgba.length, 60 * 40 * 4);
  // A fully-different image yields all-red diff tiles.
  assert.equal(diff.rgba[0], 255);
  assert.equal(diff.rgba[1], 0);
  assert.equal(diff.rgba[2], 0);
});

test('dimension mismatch fails with ratio 1', () => {
  const a = solidPng(20, 10, [10, 20, 30]);
  const b = solidPng(20, 12, [10, 20, 30]);
  const result = comparePngBuffers(a, b, { maxDiffPixelRatio: 0.5 });
  assert.equal(result.match, false);
  assert.equal(result.dimensionMismatch, true);
  assert.equal(result.diffPixelRatio, 1);
});

test('channel tolerance absorbs small numerical drift', () => {
  const base = solidPng(8, 8, [100, 100, 100]);
  const decoded = decodePng(base);
  for (let i = 0; i < decoded.rgba.length; i += 4) decoded.rgba[i] = 103;
  const drift = encodePng({ width: decoded.width, height: decoded.height, rgba: decoded.rgba });
  // Exact (tolerance 0): differs. With channelTolerance 5: matches.
  assert.equal(comparePngBuffers(base, drift, { maxDiffPixelRatio: 0 }).match, false);
  assert.equal(comparePngBuffers(base, drift, { maxDiffPixelRatio: 0, channelTolerance: 5 }).match, true);
});

test('png encode/decode round-trips arbitrary pixel data', () => {
  const original = gradientPng(33, 17);
  const decoded = decodePng(original);
  const reencoded = encodePng({ width: 33, height: 17, rgba: decoded.rgba });
  assert.deepEqual(decodePng(reencoded).rgba, decoded.rgba);
});

// A sparse-foreground image (stars on black): most pixels are the background
// colour, only a few are foreground. Used to exercise the blank guard.
function sparseForegroundPng(width, height, bg, fg, starCount) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = bg[0]; rgba[i + 1] = bg[1]; rgba[i + 2] = bg[2]; rgba[i + 3] = 255;
  }
  // Deterministic star placement (no Math.random — tests must be reproducible).
  for (let s = 0; s < starCount; s++) {
    const x = (s * 97) % width;
    const y = (s * 61) % height;
    const i = (y * width + x) * 4;
    rgba[i] = fg[0]; rgba[i + 1] = fg[1]; rgba[i + 2] = fg[2];
  }
  return encodePng({ width, height, rgba });
}

test('foreground ratio is ~0 for a solid image and >0 for a sparse one', () => {
  const solid = decodePng(solidPng(40, 30, [0, 0, 0]));
  const sparse = decodePng(sparseForegroundPng(40, 30, [0, 0, 0], [255, 255, 255], 12));
  assert.equal(foregroundRatio(solid), 0);
  assert.ok(foregroundRatio(sparse) > 0);
  assert.ok(foregroundRatio(sparse) < 0.05, '12 stars on 1200px is well under 5%');
});

test('a blank capture fails the foreground floor even when its diff ratio is tiny', () => {
  // Baseline: 12 bright stars on a black canvas (~1% foreground). Blank capture:
  // an opaque all-black canvas. Their diff-pixel ratio is ~1% (only the stars
  // differ), which passes a permissive 15% vector tolerance — but the blank
  // capture has ~0 foreground, so a baseline-derived foreground floor must fail
  // it. This is the regression a pure diff-ratio check would green-light.
  const baseline = sparseForegroundPng(40, 30, [0, 0, 0], [255, 255, 255], 12);
  const blank = solidPng(40, 30, [0, 0, 0]);
  const baselineForeground = foregroundRatio(decodePng(baseline));
  assert.ok(baselineForeground > 0, 'baseline must have intended foreground');
  const floor = Math.max(0.0001, baselineForeground * 0.5);

  // Same diff a permissive tolerance would accept...
  const permissive = comparePngBuffers(blank, baseline, { maxDiffPixelRatio: 0.15 });
  assert.equal(permissive.match, true, 'precondition: blank passes the diff tolerance alone');
  // ...but the foreground floor catches the empty render.
  const guarded = comparePngBuffers(blank, baseline, { maxDiffPixelRatio: 0.15, minForegroundRatio: floor });
  assert.equal(guarded.match, false);
  assert.ok(guarded.foregroundActual < floor);
});

test('a foreground floor derived from a legitimately-empty baseline does not false-fail', () => {
  // A baseline that is itself intentionally empty at t=0 (e.g. starfield before
  // any stars appear) has ~0 foreground. Its derived floor collapses to 0, so an
  // equally-empty capture must still match — the guard must not invent content
  // the baseline never had. This mirrors how visual-compare.mjs derives the
  // floor (0 when baseline foreground is below the meaningful threshold).
  const emptyBaseline = solidPng(40, 30, [5, 5, 10]);
  const emptyCapture = solidPng(40, 30, [5, 5, 10]);
  assert.ok(foregroundRatio(decodePng(emptyBaseline)) < 0.0001);
  const floor = 0; // derived floor for a sub-threshold baseline
  const result = comparePngBuffers(emptyCapture, emptyBaseline, { maxDiffPixelRatio: 0.15, minForegroundRatio: floor });
  assert.equal(result.match, true);
});
