import { buildProfiles } from '../profiles.js';

// Responsive profiles for mandelbrot. Four explicit, effect-owned slots — one
// per (surface × device) combination. The fractal identity (camera target and
// zoom range, iteration budgets, escape radius) is owned by config.js; profiles
// only tune execution budgets. Fullscreen slots keep the classic composition
// (render.resolution stays at the 0.2 default); preview slots lower the
// sampling cost and enable smoothing to the values the gallery previously used,
// so the card shows the same auto-zooming fractal at a coarser, softened
// buffer.
//
// Initial runtime budgets (#3): preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere until the mandelbrot tuning
// issue (#10) revisits them.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

const PREVIEW_RENDER = { render: { resolution: 0.15, smoothing: true } };

export const MANDELBROT_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...PREVIEW_RENDER },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...PREVIEW_RENDER }
});
