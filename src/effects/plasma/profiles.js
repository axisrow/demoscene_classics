import { buildProfiles } from '../profiles.js';

// Responsive profiles for plasma. Four explicit, effect-owned slots — one per
// (surface × device) combination. The pixel field's composition (frequencies,
// centres, amplitudes) is algorithmic identity and is owned by config.js, not
// here; profiles only tune execution budgets. Fullscreen slots keep the
// classic composition (render.resolution stays at the 0.25 default); preview
// slots lower the sampling cost to the value the gallery previously used, so
// the card output is recognisably the same field at a coarser buffer.
//
// Initial runtime budgets (#3): preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere; these are the conservative
// defaults until the plasma tuning issue (#5) revisits them.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

// Preview cards render at a coarser buffer than the fullscreen page. This is
// the resolution the gallery preview used before the profile migration; it
// preserves the visible plasma composition while spending less per card.
const PREVIEW_RENDER = { render: { resolution: 0.2 } };

export const PLASMA_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...PREVIEW_RENDER },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...PREVIEW_RENDER }
});
