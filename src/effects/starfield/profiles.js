import { buildProfiles } from '../profiles.js';

// Responsive profiles for starfield (issue #7). Four explicit, effect-owned
// slots — one per (surface × device) combination. The projection identity
// (nearZ, fov, depth, travelSpeed, centre) and the skin (background, star
// colours, trail appearance) are owned by config.js / skins.js; profiles only
// tune EXECUTION budgets (maxFps, render resolution) and the PARTICLE BUDGET.
//
// Particle budgets (issue #7 acceptance: "every profile has an explicit,
// benchmarked particle budget"):
//
//   - fullscreen.desktop: explicit particleCount 600. This is the dense, dense
//     baseline; it stays on the 'explicit' density mode so the budget is a
//     literal, auditable number (not an area derivation).
//   - fullscreen.mobile: 'area' density mode, clamped to [200, 450]. A phone
//     screen is smaller, so an area-derived count keeps it populated without
//     the per-pixel cost of the 600-star desktop field — lighter but not empty,
//     preserving the apparent flow corridor.
//   - preview.desktop / preview.mobile: explicit lower counts (120 / 90) and a
//     coarser buffer, so gallery cards spend far less per tile while still
//     reading as a warp-speed field.
//
// Initial runtime budgets (#3): preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

// Fullscreen desktop: explicit 600-star budget, classic vector resolution.
const FULLSCREEN_DESKTOP_BUDGET = {
  particles: { densityMode: 'explicit', particleCount: 600 }
};

// Fullscreen mobile: area-derived density, clamped so a small screen stays
// populated but never hits the desktop cost.
const FULLSCREEN_MOBILE_BUDGET = {
  particles: { densityMode: 'area', densityPerUnitArea: 0.55, densityMin: 200, densityMax: 450 }
};

// Preview cards: explicit low counts and a coarser buffer.
const PREVIEW_DESKTOP_BUDGET = {
  render: { resolution: 0.7 },
  particles: { densityMode: 'explicit', particleCount: 120 }
};
const PREVIEW_MOBILE_BUDGET = {
  render: { resolution: 0.7 },
  particles: { densityMode: 'explicit', particleCount: 90 }
};

export const STARFIELD_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP, ...FULLSCREEN_DESKTOP_BUDGET },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE, ...FULLSCREEN_MOBILE_BUDGET },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...PREVIEW_DESKTOP_BUDGET },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...PREVIEW_MOBILE_BUDGET }
});
