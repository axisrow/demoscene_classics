import { buildProfiles } from '../profiles.js';

// Responsive profiles for copper-bars (issue #14). Four explicit, effect-owned
// slots — one per (surface × device) combination. Each slot declares its own bar
// layout so the bar COUNT and placement are profile-owned: desktop slots keep
// the full 5-bar classic stack; mobile slots drop to 4 bars (the issue allows
// mobile fewer bars) but preserve the same stacked/overlapping hierarchy and
// span ~0.16–0.84 of the height so a portrait canvas (390×844) fills its height
// instead of crowding one band. The shading model (config.js) and the copper
// palette (skins.js) are identical across slots; only placement/execution differ.
//
// render.resolution stays a sampling budget: fullscreen slots keep the 0.5
// default, preview slots lower it to 0.3 (the gallery sampling budget). Lowering
// resolution resamples the SAME composition into fewer rows — it never changes
// apparent bar thickness or placement (see renderer.js).
//
// Initial runtime budgets (#3): preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

// DESKTOP layout — 5 overlapping bars spanning ~0.18–0.86 of the height. Matches
// COPPER_BARS_DEFAULTS.bars; re-declared here so each slot is self-describing.
const BARS_DESKTOP = {
  bars: [
    { yBase: 0.18, amplitude: 0.055, frequency: 0.7, phase: 0.0, height: 0.062, colorOffset: 0.00 },
    { yBase: 0.34, amplitude: 0.070, frequency: 0.9, phase: 1.1, height: 0.078, colorOffset: 0.18 },
    { yBase: 0.52, amplitude: 0.050, frequency: 0.6, phase: 2.2, height: 0.054, colorOffset: 0.40 },
    { yBase: 0.70, amplitude: 0.065, frequency: 1.0, phase: 3.3, height: 0.072, colorOffset: 0.62 },
    { yBase: 0.86, amplitude: 0.045, frequency: 0.8, phase: 4.4, height: 0.058, colorOffset: 0.85 }
  ]
};

// MOBILE layout — 4 bars, same stacked/overlapping hierarchy, spanning
// ~0.16–0.84 of the height. Slightly smaller amplitudes keep bars on-screen on
// narrow preview cards (360×180). colorOffset is spread ~1/N so every bar gets
// a distinct copper hue.
const BARS_MOBILE = {
  bars: [
    { yBase: 0.16, amplitude: 0.050, frequency: 0.7, phase: 0.0, height: 0.058, colorOffset: 0.00 },
    { yBase: 0.38, amplitude: 0.060, frequency: 0.9, phase: 1.3, height: 0.072, colorOffset: 0.22 },
    { yBase: 0.62, amplitude: 0.055, frequency: 0.6, phase: 2.6, height: 0.066, colorOffset: 0.50 },
    { yBase: 0.84, amplitude: 0.045, frequency: 0.8, phase: 3.9, height: 0.060, colorOffset: 0.78 }
  ]
};

const PREVIEW_RENDER = { render: { resolution: 0.3 } };

export const COPPER_BARS_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP, ...BARS_DESKTOP },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE, ...BARS_MOBILE },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...BARS_DESKTOP, ...PREVIEW_RENDER },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...BARS_MOBILE, ...PREVIEW_RENDER }
});
