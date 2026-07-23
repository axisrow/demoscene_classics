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
// bounded tolerance to absorb cross-OS rasterisation variance. Both are bounded
// so unconstrained differences always fail.
//
// Why vector effects are NOT byte-comparable across machines: starfield,
// sineScroller, and feedback draw through the Canvas 2D stroke/fill/text APIs,
// whose rasterisation is done by the host's Skia + font backend. That path is
// platform-dependent (macOS CoreText vs Linux FreeType, different sub-pixel AA
// and hinting). Pixel-buffer effects (plasma/fire/metaballs/tunnel/mandelbrot/
// rotozoom/copperBars) write a Uint32Array directly and bypass rasterisation
// entirely — they are byte-identical across OSes for the same chromium build.
//
// This was measured, not guessed: capturing the full matrix under the SAME
// pinned chromium-1217 on macOS (arm64) and on CI Linux (x86_64) yields 0/12
// differing bytes for every pixel-buffer effect, but for the vector effects the
// cross-OS diff reaches ~9% (sineScroller text) and ~5% (feedback). starfield's
// geometry happens to land byte-identical on these tiles, but it draws through
// the same platform-dependent path, so it stays in VECTOR_EFFECTS.
//
// VECTOR_MAX_DIFF_PIXEL_RATIO is therefore sized with a safety margin above the
// largest measured cross-OS variance (≈9%): 15% absorbs OS/driver/chromium-patch
// AA drift while still bounded — a genuine vector regression (dropped scroller
// text, blank feedback, shifted layout) diffs well above 30% and still fails.
export const DEFAULT_MAX_DIFF_PIXEL_RATIO = 0;
export const VECTOR_MAX_DIFF_PIXEL_RATIO = 0.15;

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
