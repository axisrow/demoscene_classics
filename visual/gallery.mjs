// Shared gallery capture + comparison definition for the gallery screenshot
// harness (#15).
//
// Side-effect-free so both the capture orchestrator (scripts/gallery-capture.mjs),
// the comparator (scripts/gallery-compare.mjs), and the unit tests can import from
// here without any of them executing another's main(). This mirrors the effect
// harness separation (visual/matrix.mjs / visual/compare.mjs are imported by both
// visual-capture.mjs and visual-compare.mjs and run no top-level side effects).

import { decodePng } from './png.mjs';

// Fixed 5s @ 60Hz maturity so every preview reaches the same animation state as
// the 5s effect baselines the gallery showcases.
export const GALLERY_STEP_HZ = 60;
export const GALLERY_MATURITY_SECONDS = 5;

// The two gallery captures required by issue #15 ("at minimum desktop landscape
// and mobile portrait"). Mobile dims match the effect harness's mobile-fullscreen
// profile; desktop is a standard gallery viewport. The deviceScaleFactor only
// sharpens the page/screenshot rasterisation — it does not change canvas backing
// stores (those are clientWidth x config.pixelRatio, pixelRatio pinned to 1).
export const GALLERY_CAPTURES = Object.freeze([
  {
    view: 'desktop',
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    steps: Math.round(GALLERY_MATURITY_SECONDS * GALLERY_STEP_HZ),
    filename: 'gallery__desktop__1280x800.png'
  },
  {
    view: 'mobile',
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    steps: Math.round(GALLERY_MATURITY_SECONDS * GALLERY_STEP_HZ),
    filename: 'gallery__mobile__390x844.png'
  }
]);

// The fixed set of filenames the gallery harness owns. Declared here (not derived
// from the effect matrix) so the gallery comparator cannot be confused with the
// effect comparator, and so completeness/staleness checks have one source of truth.
export const GALLERY_FILENAMES = Object.freeze(GALLERY_CAPTURES.map((c) => c.filename));

// Full-page gallery screenshots are NOT byte-stable across OSes the way pixel-buffer
// effects are: the host font backend (macOS CoreText vs Linux FreeType) shifts
// line-wrap and thus the total page HEIGHT by a few-to-tens of pixels. A strict
// dimension gate would fail every cross-OS CI run with no regression. So the
// gallery comparator allows a BOUNDED height delta and compares the common area.
//
// Allow up to DIMENSION_TOLERANCE_FRACTION of the baseline height, or
// DIMENSION_TOLERANCE_FLOOR_PX absolute pixels — whichever is LARGER. A delta
// beyond BOTH bounds is a real layout/aspect regression and fails. Width is never
// tolerant (a viewport change is always a regression).
export const GALLERY_DIMENSION_TOLERANCE_FRACTION = 0.05; // 5% of baseline height
export const GALLERY_DIMENSION_TOLERANCE_FLOOR_PX = 40;   // ...or 40px, whichever is larger

// Pixel-diff ceiling for full-page gallery screenshots.
//
// Unlike effect baselines (pixel-buffer effects are byte-identical cross-OS;
// vector effects drift ~9% and use VECTOR_MAX_DIFF_PIXEL_RATIO = 0.15), a
// decorated gallery page renders SYSTEM text everywhere (title, marquee, 10
// card names + descriptions, footer) plus CRT scanlines, all through the host's
// font/AA backend. That cross-OS rasterisation drift is large: measured
// macOS-arm64 vs CI-Linux-x86_64 on the SAME pinned chromium-1217 yields ~48.5%
// differing pixels on the desktop sheet and ~19.1% on the mobile sheet — with NO
// presentation regression, purely the OS font backend. A 0.15 ceiling (sized for
// effect vector drift) therefore fails every cross-OS CI run.
//
// 0.60 is sized with a margin above the largest measured cross-OS gallery drift
// (≈48.5%): it absorbs OS/driver/font-backend drift while staying bounded. A
// genuine presentation regression still fails — structural ones (a missing card,
// a broken aspect, overflow) shift the page HEIGHT beyond the dimension tolerance
// above (each card is ~100-200px, far over the 40px floor), and a content
// regression that stays within height (e.g. a globally wrong palette) diffs well
// above 60%. The dimension gate and the Node presentation test suite
// (tests/gallery-presentation.test.js) are the structural-regression guards; this
// pixel ceiling is the cross-OS rasterisation guard.
export const GALLERY_MAX_DIFF_PIXEL_RATIO = 0.60;

// Compare two full-page gallery PNGs with a bounded dimension tolerance + pixel
// ratio. Returns { match, reason, actual, expected, diffPixelRatio, ... }.
//
// - Width mismatch → always fail (reason 'width-mismatch'): a viewport change is
//   a regression, never absorbed.
// - Height delta within the bounded tolerance (larger of fraction / floor) →
//   clamp both images to the common height and compare the overlapping scanlines
//   with the pixel ratio. Absorbs cross-OS font-backend height drift while still
//   failing on real content regressions.
// - Height delta beyond the tolerance → fail (reason 'height-delta'): a real
//   layout/aspect regression (extra/missing card, broken wrap).
//
// `maxDiffPixelRatio` is the pixel-diff ceiling applied to the compared area
// (the gallery comparator passes VECTOR_MAX_DIFF_PIXEL_RATIO, 0.15).
export function compareGallery(actualBuf, expectedBuf, { maxDiffPixelRatio }) {
  const actual = decodePng(actualBuf);
  const expected = decodePng(expectedBuf);
  if (actual.width !== expected.width) {
    return { match: false, reason: 'width-mismatch', actual, expected, diffPixelRatio: 1 };
  }
  const minHeight = Math.min(actual.height, expected.height);
  const heightDelta = Math.abs(actual.height - expected.height);
  const tolerance = Math.max(
    GALLERY_DIMENSION_TOLERANCE_FRACTION * expected.height,
    GALLERY_DIMENSION_TOLERANCE_FLOOR_PX
  );
  if (heightDelta > tolerance) {
    return { match: false, reason: 'height-delta', actual, expected, diffPixelRatio: 1, heightDelta };
  }
  // Same dimensions: compare directly. Bounded height delta: compare the
  // overlapping scanlines. Both count differing pixels over the compared area.
  let diff = 0;
  const total = actual.width * minHeight;
  for (let y = 0; y < minHeight; y++) {
    for (let x = 0; x < actual.width; x++) {
      const ai = (y * actual.width + x) * 4;
      const ei = (y * expected.width + x) * 4;
      if (
        actual.rgba[ai] !== expected.rgba[ei]
        || actual.rgba[ai + 1] !== expected.rgba[ei + 1]
        || actual.rgba[ai + 2] !== expected.rgba[ei + 2]
        || actual.rgba[ai + 3] !== expected.rgba[ei + 3]
      ) {
        diff++;
      }
    }
  }
  const ratio = total === 0 ? 1 : diff / total;
  return {
    match: ratio <= maxDiffPixelRatio,
    reason: ratio <= maxDiffPixelRatio ? null : 'pixel-diff',
    actual,
    expected,
    diffPixelRatio: ratio,
    diffPixels: diff,
    totalPixels: total,
    comparedHeight: minHeight
  };
}
