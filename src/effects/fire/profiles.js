import { buildProfiles } from '../profiles.js';

// Responsive profiles for fire. Four explicit, effect-owned slots — one per
// (surface × device) combination. The heat-simulation identity (seed, cooling,
// source width/depth, intensity) is owned by config.js and is
// resolution-NORMALIZED: cooling is a height-fraction per step, so the flame
// occupies the same vertical fraction of the grid at every resolution. A slot's
// `render.resolution` therefore changes only the sampling COST (the number of
// grid cells), never the apparent flame height, cooling speed, or silhouette.
//
// Each slot tunes its own grid resolution and runtime budget independently:
// fullscreen slots sample finely for a detailed flame; preview and mobile slots
// use a coarser grid to hit their frame budget. Because the simulation is
// resolution-independent, the coarser mobile grid (0.15) still produces a tall,
// coherent rising flame rather than sparse noise or a short strip.
//
// Runtime budgets (#3): preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere. stepHz (sim steps/sec) is a
// config value, identical across profiles, so every profile advances the same
// number of heat steps per second and matures identically.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

const RENDER_FULLSCREEN_DESKTOP = { render: { resolution: 0.25 } };
const RENDER_FULLSCREEN_MOBILE = { render: { resolution: 0.2 } };
const RENDER_PREVIEW_DESKTOP = { render: { resolution: 0.2 } };
const RENDER_PREVIEW_MOBILE = { render: { resolution: 0.15 } };

export const FIRE_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP, ...RENDER_FULLSCREEN_DESKTOP },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE, ...RENDER_FULLSCREEN_MOBILE },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...RENDER_PREVIEW_DESKTOP },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...RENDER_PREVIEW_MOBILE }
});
