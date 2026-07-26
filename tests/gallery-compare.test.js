import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodePng, encodePng } from '../visual/png.mjs';
import {
  compareGallery,
  GALLERY_DIMENSION_TOLERANCE_FRACTION,
  GALLERY_DIMENSION_TOLERANCE_FLOOR_PX,
  GALLERY_MAX_DIFF_PIXEL_RATIO
} from '../visual/gallery.mjs';

// Unit tests for the gallery comparator's dimension tolerance + the destructive-
// path containment of scripts/gallery-compare.mjs. These run as plain node tests
// (no browser), mirroring tests/visual-pixel.test.js.

const root = new URL('../', import.meta.url);

function solidPng(width, height, [r, g, b]) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return encodePng({ width, height, rgba });
}

// A baseline plus a capture that is identical except the bottom `extraRows` rows
// are appended (simulating cross-OS full-page height drift: same content, a few
// extra scanlines of background). Pixel content above the baseline height matches.
function tallerCopyPng(baseWidth, baseHeight, extraRows, bg) {
  const rgba = Buffer.alloc(baseWidth * (baseHeight + extraRows) * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = bg[0]; rgba[i + 1] = bg[1]; rgba[i + 2] = bg[2]; rgba[i + 3] = 255;
  }
  return encodePng({ width: baseWidth, height: baseHeight + extraRows, rgba });
}

test('compareGallery: identical images match', () => {
  const png = solidPng(100, 200, [10, 20, 30]);
  const result = compareGallery(png, png, { maxDiffPixelRatio: 0.15 });
  assert.equal(result.match, true);
  assert.equal(result.reason, null);
  assert.equal(result.diffPixelRatio, 0);
});

test('compareGallery: width mismatch always fails (viewport change is a regression)', () => {
  const a = solidPng(100, 200, [10, 20, 30]);
  const b = solidPng(101, 200, [10, 20, 30]);
  const result = compareGallery(a, b, { maxDiffPixelRatio: 0.15 });
  assert.equal(result.match, false);
  assert.equal(result.reason, 'width-mismatch');
});

test('compareGallery: a bounded height delta (cross-OS font drift) is absorbed', () => {
  // Baseline 1280x1189 (the macOS desktop gallery height). CI produced 1280x1190
  // (1px taller). A 1px delta on a ~1189px image is far inside the 40px floor —
  // must clamp to the common height and match (identical content above it).
  const baseline = solidPng(1280, 1189, [5, 6, 10]);
  const capture = tallerCopyPng(1280, 1189, 1, [5, 6, 10]);
  const result = compareGallery(capture, baseline, { maxDiffPixelRatio: 0.15 });
  assert.equal(result.match, true, `1px cross-OS height drift must be absorbed (reason=${result.reason})`);
});

test('compareGallery: the mobile CI height delta (8624 vs 8608) is absorbed', () => {
  // Baseline 780x8624 (macOS mobile gallery, 2x scale). CI produced 780x8608
  // (16px shorter). 16px < 40px floor → must match.
  const baseline = solidPng(780, 8624, [5, 6, 10]);
  const capture = solidPng(780, 8608, [5, 6, 10]);
  const result = compareGallery(capture, baseline, { maxDiffPixelRatio: 0.15 });
  assert.equal(result.match, true, `16px cross-OS height drift must be absorbed (reason=${result.reason})`);
});

test('compareGallery: a height delta beyond the tolerance fails (real layout regression)', () => {
  // A 200px delta on an 800px-tall baseline = 25% > 5% fraction AND > 40px floor.
  // That is a whole extra/missing card — must fail.
  const baseline = solidPng(800, 800, [5, 6, 10]);
  const capture = tallerCopyPng(800, 800, 200, [5, 6, 10]);
  const result = compareGallery(capture, baseline, { maxDiffPixelRatio: 0.15 });
  assert.equal(result.match, false);
  assert.equal(result.reason, 'height-delta');
});

test('compareGallery: a pixel-content change within tolerance dimensions still fails on content', () => {
  // Same dimensions, but half the pixels changed colour — exceeds the 15% ratio.
  const baseline = solidPng(40, 30, [0, 0, 0]);
  const decoded = decodePng(baseline);
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 40; x++) {
      const i = (y * 40 + x) * 4;
      decoded.rgba[i] = 255; decoded.rgba[i + 1] = 255; decoded.rgba[i + 2] = 255;
    }
  }
  const changed = encodePng({ width: 40, height: 30, rgba: decoded.rgba });
  const result = compareGallery(changed, baseline, { maxDiffPixelRatio: 0.15 });
  assert.equal(result.match, false);
  assert.equal(result.reason, 'pixel-diff');
});

test('compareGallery: production tolerance absorbs the measured cross-OS gallery drift but fails a near-total change', () => {
  // The production gallery ceiling (GALLERY_MAX_DIFF_PIXEL_RATIO) must sit ABOVE
  // the measured macOS↔Linux full-page drift (~48.5% desktop) so a clean cross-OS
  // run passes, but BELOW a near-total content change so a real regression fails.
  assert.ok(GALLERY_MAX_DIFF_PIXEL_RATIO > 0.485,
    `production gallery tolerance ${GALLERY_MAX_DIFF_PIXEL_RATIO} must exceed the measured ~48.5% cross-OS desktop drift`);

  // Simulate the measured cross-OS drift: ~48% of pixels differ (font backend).
  const baseline = solidPng(100, 100, [0, 0, 0]);
  const drift = decodePng(solidPng(100, 100, [0, 0, 0]));
  for (let i = 0, n = 0; i < drift.rgba.length; i += 4, n++) {
    if (n % 2 === 0) { drift.rgba[i] = 200; drift.rgba[i + 1] = 200; drift.rgba[i + 2] = 200; }
  }
  const driftPng = encodePng({ width: 100, height: 100, rgba: drift.rgba });
  assert.equal(compareGallery(driftPng, baseline, { maxDiffPixelRatio: GALLERY_MAX_DIFF_PIXEL_RATIO }).match, true,
    '~50% cross-OS drift must be absorbed by the production tolerance');

  // A near-total content change (90% — a real regression like a wrong palette)
  // still fails even at the production tolerance.
  const worst = decodePng(solidPng(100, 100, [0, 0, 0]));
  for (let i = 0; i < worst.rgba.length; i += 4) {
    worst.rgba[i] = 255; worst.rgba[i + 1] = 255; worst.rgba[i + 2] = 255;
  }
  const worstPng = encodePng({ width: 100, height: 100, rgba: worst.rgba });
  assert.equal(compareGallery(worstPng, baseline, { maxDiffPixelRatio: GALLERY_MAX_DIFF_PIXEL_RATIO }).match, false,
    'a 100% content change must fail the production tolerance');
});

test('compareGallery: tolerance floor is the larger of fraction and absolute floor', () => {
  // On a short baseline (e.g. 100px) the 5% fraction is only 5px, but the 40px
  // absolute floor governs — so a 40px delta matches and a 41px delta fails.
  const base = solidPng(50, 100, [5, 6, 10]);
  assert.equal(compareGallery(tallerCopyPng(50, 100, 40, [5, 6, 10]), base, { maxDiffPixelRatio: 0.15 }).match, true);
  assert.equal(compareGallery(tallerCopyPng(50, 100, 41, [5, 6, 10]), base, { maxDiffPixelRatio: 0.15 }).match, false);
  // On a tall baseline (e.g. 2000px) the 5% fraction (100px) governs over the 40px floor.
  const tall = solidPng(50, 2000, [5, 6, 10]);
  const govFraction = GALLERY_DIMENSION_TOLERANCE_FRACTION * 2000;
  assert.ok(govFraction > GALLERY_DIMENSION_TOLERANCE_FLOOR_PX, 'precondition: fraction governs on tall baselines');
  assert.equal(compareGallery(tallerCopyPng(50, 2000, Math.floor(govFraction), [5, 6, 10]), tall, { maxDiffPixelRatio: 0.15 }).match, true);
});

// Destructive-path containment (Codex review finding): gallery-compare must NOT
// expose a --diffs / --captures / --baselines override, because the only
// destructive step is `rm -rf` on the diffs dir and a caller path there could
// delete the checkout or a sibling worktree. All three dirs are hardcoded.
test('gallery-compare.mjs: no destructive --diffs/--captures/--baselines path override', async () => {
  const src = await readFile(new URL('scripts/gallery-compare.mjs', root), 'utf8');
  assert.doesNotMatch(src, /['"]--diffs['"]/, 'gallery-compare must not accept a --diffs override (rm -rf vector)');
  assert.doesNotMatch(src, /['"]--captures['"]/, 'gallery-compare must not accept a --captures override');
  assert.doesNotMatch(src, /['"]--baselines['"]/, 'gallery-compare must not accept a --baselines override');
  // The three directories are hardcoded relative to the repo root.
  assert.match(src, /visual\/diffs\/gallery/, 'diffs dir must be hardcoded under visual/diffs/gallery');
  assert.match(src, /visual\/captures\/gallery/, 'captures dir must be hardcoded');
  assert.match(src, /visual\/baselines\/gallery/, 'baselines dir must be hardcoded');
});
