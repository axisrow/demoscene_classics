import { buildProfiles } from '../profiles.js';

// Responsive profiles for mandelbrot (issue #10). Four explicit, effect-owned
// slots — one per (surface × device) combination.
//
// What each slot owns here:
//   - RUNTIME budgets (maxFps/pixelRatio/pauseWhenHidden) — carried over from #3.
//   - PREVIEW sampling (render.resolution + smoothing) — raised from the old
//     0.15 (visibly blurred) to 0.19, the highest value that still satisfies the
//     preview < fullscreen (0.2) contact-sheet invariant AND stays inside the
//     benchmark frame budget (portfolio 1456×902 ≈ <30ms median / <41ms p95).
//     0.19 is a genuine +27% sampling increase over 0.15, not an upscale.
//   - CAMERA overrides — explicit portrait vs landscape framing (issue #10).
//
// Camera / orientation: the visual-harness matrix renders desktop slots at
// 1280×720 (landscape) and mobile slots at 390×844 (portrait). A portrait
// canvas has aspect < 1, so the vertical complex-plane extent (`span / aspect`)
// is *larger* than the horizontal one; at the classic wide minZoom a tall
// canvas showed the set as a small horizontal sliver with huge empty vertical
// bands. The portrait slots therefore RAISE the zoom floor so the set body and
// its boundary stay composed in a tall frame. Both orientations keep the SAME
// Seahorse-Valley centre, so landscape and portrait point at the identical
// feature — only the zoom window differs.
//
// Resolution-independence (issue #10): complex-plane bounds come from
// `zoom + centre + buffer-aspect` ONLY (see mandelbrot-core.js). Changing
// render.resolution scales the backing buffer and its sampling cost; it does
// not move the complex-plane window. The cameras below therefore hold for any
// buffer size.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

// Preview sampling raised 0.15 → 0.19 (issue #10). Kept below the 0.2 fullscreen
// default so the shared contact-sheet invariant (preview < fullscreen) holds,
// and benchmark-verified to stay inside the #3 frame budget. Smoothing stays on
// for the softened preview look.
const PREVIEW_RENDER = { render: { resolution: 0.19, smoothing: true } };

// Landscape cameras (desktop slots, 1280×720): the classic composition. These
// values are byte-identical to MANDELBROT_DEFAULTS.camera, so the default
// descriptor {} (which resolves to fullscreen.desktop) keeps the unchanged
// classic framing — the only delta vs the pre-#10 baseline is the continuous
// colouring, not the camera.
const CAMERA_LANDSCAPE = {
  camera: {
    centerX: -0.7436438870371587,
    centerY: 0.1318259042053119,
    minZoom: 1,
    maxZoom: 1_000_000
  }
};

// Portrait cameras (mobile slots, 390×844): same Seahorse-Valley centre, but the
// zoom floor is raised to 2.4 so the full set body stays framed in a tall
// canvas (at zoom 2.4 the real-axis window is ≈ [-1.99, 0.51] — the whole main
// body). maxZoom is capped lower to keep the mobile iteration budget sane (the
// iteration ceiling scales with log10(zoom)).
const CAMERA_PORTRAIT = {
  camera: {
    centerX: -0.7436438870371587,
    centerY: 0.1318259042053119,
    minZoom: 2.4,
    maxZoom: 800_000
  }
};

export const MANDELBROT_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP, ...CAMERA_LANDSCAPE },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE, ...CAMERA_PORTRAIT },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...PREVIEW_RENDER, ...CAMERA_LANDSCAPE },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...PREVIEW_RENDER, ...CAMERA_PORTRAIT }
});
