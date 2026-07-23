import { buildProfiles } from '../profiles.js';

// Responsive profiles for metaballs. Four explicit, effect-owned slots — one
// per (surface × device) combination. The scalar-field identity (field
// strength, threshold, scales) is owned by config.js; profiles only tune
// execution budgets and the point budget. Fullscreen slots keep the classic
// composition (render.resolution stays at the 1/3 default, pointCount stays at
// 5); preview slots lower the sampling cost and the point budget to the values
// the gallery previously used, so the card shows the same gooey blobs with
// fewer, cheaper metaballs.
//
// Initial runtime budgets (#3): preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere until the metaballs tuning
// issue (#8) revisits them.

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
