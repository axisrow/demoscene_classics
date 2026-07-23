import { buildProfiles } from '../profiles.js';

// Responsive profiles for sine-scroller. Four explicit, effect-owned slots —
// one per (surface × device) combination. The scroller identity (text content,
// wave shape, typography ratios) is owned by config.js; profiles only tune
// execution budgets and the starfield budget. Fullscreen slots keep the
// classic composition (render.resolution stays at the 1.0 vector default, star
// count stays at 220); preview slots lower the sampling cost and the star
// budget to the values the gallery previously used, so the card shows the same
// wavy greets banner over a sparser, cheaper starfield.
//
// Initial runtime budgets (#3): preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere until the sine-scroller
// tuning issue (#11) revisits them.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

const PREVIEW_BUDGET = { render: { resolution: 0.7 }, stars: { count: 60 } };

export const SINE_SCROLLER_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...PREVIEW_BUDGET },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...PREVIEW_BUDGET }
});
