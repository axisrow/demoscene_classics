import { buildProfiles } from '../profiles.js';

// Responsive profiles for metaballs (issue #8). Four explicit, effect-owned
// slots — one per (surface × device) combination. The normalized scalar-field
// IDENTITY (radius, strength, threshold, mergeBand) and the skin (colour ramp,
// shading) are owned by config.js / skins.js; profiles only tune EXECUTION
// budgets (maxFps, render resolution) and the POINT BUDGET.
//
// Because geometry is normalized, relative blob radius and the trajectory
// envelope are IDENTICAL across all four slots — a profile change never
// compensates for poor normalization with per-resolution radii. Preview slots
// use fewer metaballs and coarser field sampling, but the Lissajous paths still
// bring at least one pair close enough to merge by the 1.5 s / 5 s capture
// (verified by the regenerated baselines).
//
// Fullscreen slots keep the classic composition (render.resolution stays at the
// 1/3 default, pointCount stays at 5); preview slots lower the sampling cost
// and the point budget to the values the gallery previously used, so the card
// shows the same gooey blobs with fewer, cheaper metaballs.
//
// Initial runtime budgets (#3): preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

const PREVIEW_BUDGET = { render: { resolution: 0.2 }, field: { pointCount: 3 } };

export const METABALLS_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...PREVIEW_BUDGET },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...PREVIEW_BUDGET }
});
