// Pinned browser/runtime versions for the visual-QA harness.
//
// The harness is only reproducible against the exact Playwright/Chromium pair
// below. Playwright 1.59.0's bundled driver resolves chromium build 1217
// (see .../playwright/driver/package/browsers.json). If a future Playwright
// upgrade re-pins a different chromium build, baselines MUST be regenerated and
// reviewed deliberately — capture_runner.py asserts this same value at runtime.

export const PINNED_PLAYWRIGHT_VERSION = '1.59.0';
export const PINNED_CHROMIUM_BUILD = '1217';

export const VISUAL_DIRS = Object.freeze({
  baselines: 'visual/baselines',
  captures: 'visual/captures',
  diffs: 'visual/diffs',
  sheets: 'visual/sheets'
});

// Documented, bounded screenshot tolerance. Pixel-baseline effects (Canvas 2D
// Mandelbrot etc.) target byte-identical reproduction; vector effects target a
// small tolerance to absorb sub-pixel rasterisation variance. Both are bounded
// so unconstrained differences always fail.
export const DEFAULT_MAX_DIFF_PIXEL_RATIO = 0;
export const VECTOR_MAX_DIFF_PIXEL_RATIO = 0.01;

// Effects rendered with the Canvas 2D stroke/fill/text APIs (vs. raw pixel
// buffers). These compare against a small tolerance rather than byte-identical.
export const VECTOR_EFFECTS = Object.freeze(new Set([
  'starfield',
  'sineScroller',
  'feedback'
]));

export function toleranceFor(effectName) {
  return VECTOR_EFFECTS.has(effectName) ? VECTOR_MAX_DIFF_PIXEL_RATIO : DEFAULT_MAX_DIFF_PIXEL_RATIO;
}
