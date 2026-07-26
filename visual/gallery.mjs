// Shared gallery capture definition for the gallery screenshot harness (#15).
//
// Declared in a side-effect-free module so both the capture orchestrator
// (scripts/gallery-capture.mjs) and the comparator (scripts/gallery-compare.mjs)
// can import the capture set and expected filename list without either script
// executing the other's main() at import time. This mirrors the separation in
// the effect harness (visual/matrix.mjs is imported by both visual-capture.mjs
// and visual-compare.mjs and runs no top-level side effects).

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
